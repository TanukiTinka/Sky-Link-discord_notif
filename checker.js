// checker.js

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// --- KONSTANTY A KONFIGURACE ---

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const STATUS_CACHE_PATH = 'status_cache.json';

try {
    const SITES = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (e) {
    console.error("Chyba při čtení config.json. Ujistěte se, že soubor existuje a je platný JSON.");
    process.exit(1);
}
const SITES = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Nastavení globálního User-Agent pro obcházení blokování robotů
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (compatible; DiscordUptimeChecker/1.0; +https://your-monitoring-domain.com)';

// --- FUNKCE PRO SPRÁVU CACHE ---

/**
 * Načte poslední známý stav webů z lokálního souboru.
 * @returns {object} Cache s posledními stavy
 */
function loadStatusCache() {
    try {
        if (fs.existsSync(STATUS_CACHE_PATH)) {
            // Kontrola, zda soubor není prázdný
            const content = fs.readFileSync(STATUS_CACHE_PATH, 'utf8');
            if (content) {
                return JSON.parse(content);
            }
        }
    } catch (e) {
        console.error("Chyba při čtení nebo parsování status_cache.json. Začínám s prázdnou cache.", e);
        // Soubor bude přepsán při prvním uložení
    }
    return {};
}

/**
 * Uloží aktuální stav webů do status_cache.json.
 * @param {object} cache - Aktuální cache stavů
 */
function saveStatusCache(cache) {
    try {
        console.log("Ukládám novou status cache.");
        fs.writeFileSync(STATUS_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
    } catch (e) {
        console.error("Chyba při ukládání status_cache.json:", e);
    }
}

let statusCache = loadStatusCache();

// --- POMOCNÉ FUNKCE ---

/**
 * Odešle notifikaci na Discord pomocí Webhooku.
 * @param {object} embed - Discord Embed objekt
 */
async function sendDiscordNotification(embed) {
    if (!WEBHOOK_URL) {
        console.error("Chybí DISCORD_WEBHOOK_URL v .env souboru.");
        return;
    }
    
    try {
        await axios.post(WEBHOOK_URL, {
            embeds: [embed]
        });
    } catch (error) {
        console.error("Chyba při odesílání Discord notifikace:", error.response ? error.response.data : error.message);
    }
}

// --- HLAVNÍ LOGIKA KONTROLY ---

async function checkUptime() {
    console.log(`Spouštím cyklus monitorování pro ${SITES.length} webů.`);

    for (const site of SITES) {
        const { name, url, expectedStatus } = site;
        const siteKey = url; // Klíč pro uložení stavu v cache
        
        let status = 'UP';
        let color = 5763719; // Zelená
        let description = `✅ Web je dostupný a vrátil očekávaný stav ${expectedStatus}.`;
        let sendNotification = false; 

        // Získání předchozího stavu
        const previousStatus = statusCache[siteKey] || 'UNKNOWN';
        
        try {
            const response = await axios.get(url, {
                timeout: 15000, 
                validateStatus: function (status) {
                    return status >= 200 && status < 600; 
                },
            });

            if (response.status !== expectedStatus) {
                status = 'POTENCIÁLNÍ PROBLÉM';
                color = 16776960; // Žlutá
                description = `⚠️ Web je dostupný, ale vrátil neočekávaný stav.`;
                description += `\n**Kód:** ${response.status} (Očekáváno: ${expectedStatus})`;
            }

        } catch (error) {
            status = 'DOWN';
            color = 15158332; // Červená
            description = `❌ Web je nedostupný nebo vypršel časový limit (timeout).`;
            
            if (error.code) {
                description += `\n**Chybový kód:** ${error.code}`;
            } else {
                description += `\n**Chyba:** ${error.message}`;
            }
        }
        
        // --- LOGIKA PRO DETEKCI ZMĚNY STAVU ---
        
        // Změna: UP (nyní) na DOWN (dříve)
        if (status === 'DOWN' && previousStatus !== 'DOWN' && previousStatus !== 'UNKNOWN') {
            description = `🚨 **VÝPADEK SLUŽBY:** Web je nyní nedostupný.`;
            sendNotification = true;
            color = 15158332; // Červená
        }
        
        // Změna: DOWN (nyní) na UP (dříve) – Obnova
        else if (status === 'UP' && (previousStatus === 'DOWN' || previousStatus === 'POTENCIÁLNÍ PROBLÉM')) {
            description = `✅ **OBNOVA SLUŽBY:** Po výpadku je web opět dostupný.`;
            sendNotification = true;
            color = 3066993; // Tyrkysová/Modrá pro zotavení
        }
        
        // Změna: UP (nyní) na POTENCIÁLNÍ PROBLÉM (dříve UP)
        else if (status === 'POTENCIÁLNÍ PROBLÉM' && previousStatus === 'UP') {
            description = `⚠️ **ZJIŠTĚNÝ PROBLÉM:** Web vrátil neočekávaný stavový kód.`;
            sendNotification = true;
        }

        // Změna: Vyřešení POTENCIÁLNÍHO PROBLÉMU na UP
        else if (status === 'UP' && previousStatus === 'POTENCIÁLNÍ PROBLÉM') {
            description = `✅ **PROBLÉM VYŘEŠEN:** Web nyní vrací očekávaný stavový kód.`;
            sendNotification = true;
            color = 3066993; // Tyrkysová pro zotavení
        }
        
        // --- ODESLÁNÍ A ULOŽENÍ STAVU ---

        if (sendNotification) {
             const embed = {
                title: `🌐 STAV MONITOROVÁNÍ: ${name} [${status}]`,
                description: description,
                url: url,
                color: color,
                timestamp: new Date(),
                footer: {
                    text: 'Notifikace pouze při změně stavu'
                }
            };
             await sendDiscordNotification(embed);
        } else {
            console.log(`[OK] ${name} (${status}). Není potřeba notifikovat.`);
        } 
        
        // Aktualizace cache pro další spuštění
        statusCache[siteKey] = status;
    }
    
    // Uložení aktuální cache po dokončení všech kontrol
    saveStatusCache(statusCache);
}

checkUptime();