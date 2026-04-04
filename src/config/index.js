import 'dotenv/config';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
export const ROOT_DIR = path.join(__dirname, '..', '..');
export const JSON_DIR = path.join(ROOT_DIR, 'json');

// Server config
export const PORT = parseInt(process.env.PORT) || 3000;
export const NODE_ENV = process.env.NODE_ENV || 'development';

// PikaMC config
export const PANEL_URL = process.env.PIKAMC_PANEL_URL || 'https://cp.pikamc.vn';
export const API_KEY = process.env.PIKAMC_API_KEY;
export const SERVER_ID = process.env.PIKAMC_SERVER_ID || 'e417ea4b';
export const SECONDARY_PTERODACTYL_PANEL_URL = process.env.SECONDARY_PTERODACTYL_PANEL_URL || '';
export const SECONDARY_PTERODACTYL_API_KEY = process.env.SECONDARY_PTERODACTYL_API_KEY || '';
export const SECONDARY_PTERODACTYL_SERVER_ID = process.env.SECONDARY_PTERODACTYL_SERVER_ID || '';
export const WHITELIST_COMMAND_TEMPLATE = process.env.WHITELIST_COMMAND_TEMPLATE || 'whitelist add "{gamertag}"';
export const WHITELIST_REMOVE_COMMAND_TEMPLATE = process.env.WHITELIST_REMOVE_COMMAND_TEMPLATE || 'whitelist remove "{gamertag}"';

// Discord config
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
export const DISCORD_CHANNEL_ID_1 = process.env.DISCORD_CHANNEL_ID_1;
export const DISCORD_CHANNEL_ID_2 = process.env.DISCORD_CHANNEL_ID_2;
export const DISCORD_DONATE_CHANNEL_ID = process.env.DISCORD_DONATE_CHANNEL_ID || '';

// Chat config
export const MAX_CHAT_HISTORY = parseInt(process.env.MAX_CHAT_HISTORY) || 100;
export const CHAT_HISTORY_FILE = path.join(JSON_DIR, 'chat_history.json');

// Session config
const sessionSecretFromEnv = String(process.env.SESSION_SECRET || '').trim();
if (!sessionSecretFromEnv && NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
}
export const SESSION_SECRET = sessionSecretFromEnv || randomBytes(32).toString('hex');
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'sessionId';
const rawSessionCookieSameSite = String(process.env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase();
export const SESSION_COOKIE_SAME_SITE = ['lax', 'strict', 'none'].includes(rawSessionCookieSameSite)
    ? rawSessionCookieSameSite
    : 'lax';
export const SESSION_COOKIE_SECURE = String(process.env.SESSION_COOKIE_SECURE || '')
    ? String(process.env.SESSION_COOKIE_SECURE).toLowerCase() === 'true'
    : NODE_ENV === 'production';
export const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;

// XRay filter patterns
export const BLOCKED_MESSAGE_PATTERNS = [
    /\[XRay\]/i,
    /\[LOG\].*Hệ thống.*XRay/i,
    /mined.*Ore.*at.*\[\d+,/i,
    /\[AntiXRay\]/i,
    /\[OreAnnouncer\]/i,
];

// Rate limiting config
export const RATE_LIMIT_CONFIG = {
    general: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    },
    strict: { windowMs: 15 * 60 * 1000, max: 10 },
    pikamc: { windowMs: 1 * 60 * 1000, max: 30 },
};

// Validation function - does NOT exit on error, just logs warnings
export function validateConfig() {
    const required = [
        { key: 'PIKAMC_API_KEY', value: API_KEY },
        { key: 'DISCORD_BOT_TOKEN', value: DISCORD_BOT_TOKEN },
    ];

    const missing = required.filter(item => !item.value);

    if (missing.length > 0) {
        console.warn('⚠️  Missing optional environment variables:');
        missing.forEach(item => console.warn(`   - ${item.key}`));
        console.warn('Some features may not work without these variables.\n');
        // Don't exit - just warn
        return false;
    }

    console.log('✅ Configuration validated successfully');
    return true;
}

// Check config on import (but don't crash)
const isValid = validateConfig();
if (!isValid) {
    console.log('ℹ️  Server will continue but some features may be disabled.');
}
