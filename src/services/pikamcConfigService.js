import { promises as fs } from 'fs';
import path from 'path';
import {
    JSON_DIR,
    PANEL_URL,
    API_KEY,
    SERVER_ID,
    WHITELIST_COMMAND_TEMPLATE,
    WHITELIST_REMOVE_COMMAND_TEMPLATE
} from '../config/index.js';

const CONFIG_FILE = path.join(JSON_DIR, 'pikamc-config.json');
const CACHE_TTL = 5000;

let cachedConfig = null;
let cachedAt = 0;
let inFlight = null;

function sanitizeText(value, maxLen = 500) {
    return String(value ?? '').trim().slice(0, maxLen);
}

function sanitizeUrl(value) {
    const text = sanitizeText(value, 500);
    if (!text) return '';
    if (!/^https?:\/\//i.test(text)) return '';
    return text.replace(/\/+$/, '');
}

function sanitizeServerId(value) {
    return sanitizeText(value, 80);
}

function sanitizeCommandTemplate(value) {
    return sanitizeText(value, 160);
}

function sanitizeApiKey(value) {
    return sanitizeText(value, 200);
}

function normalizeConfig(raw) {
    const panelUrl = sanitizeUrl(raw?.panelUrl);
    const serverId = sanitizeServerId(raw?.serverId);
    const apiKey = sanitizeApiKey(raw?.apiKey);
    const whitelistCommandTemplate = sanitizeCommandTemplate(raw?.whitelistCommandTemplate);
    const whitelistRemoveCommandTemplate = sanitizeCommandTemplate(raw?.whitelistRemoveCommandTemplate);

    return {
        panelUrl,
        serverId,
        apiKey,
        whitelistCommandTemplate,
        whitelistRemoveCommandTemplate
    };
}

async function readConfigFile() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return normalizeConfig(parsed);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        console.error('[PikaMC Config] Read error:', error.message);
        return null;
    }
}

function mergeWithEnv(fileConfig) {
    const envConfig = normalizeConfig({
        panelUrl: PANEL_URL,
        serverId: SERVER_ID,
        apiKey: API_KEY,
        whitelistCommandTemplate: WHITELIST_COMMAND_TEMPLATE,
        whitelistRemoveCommandTemplate: WHITELIST_REMOVE_COMMAND_TEMPLATE
    });

    const merged = {
        panelUrl: fileConfig?.panelUrl || envConfig.panelUrl,
        serverId: fileConfig?.serverId || envConfig.serverId,
        apiKey: fileConfig?.apiKey || envConfig.apiKey,
        whitelistCommandTemplate: fileConfig?.whitelistCommandTemplate || envConfig.whitelistCommandTemplate,
        whitelistRemoveCommandTemplate: fileConfig?.whitelistRemoveCommandTemplate || envConfig.whitelistRemoveCommandTemplate
    };

    return merged;
}

export async function getPikamcConfig() {
    const now = Date.now();
    if (cachedConfig && now - cachedAt < CACHE_TTL) {
        return cachedConfig;
    }

    if (inFlight) {
        return inFlight;
    }

    inFlight = (async () => {
        const fileConfig = await readConfigFile();
        const merged = mergeWithEnv(fileConfig);
        cachedConfig = merged;
        cachedAt = Date.now();
        inFlight = null;
        return merged;
    })();

    return inFlight;
}

export async function savePikamcConfig(nextConfig) {
    const sanitized = normalizeConfig(nextConfig);

    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(sanitized, null, 2), 'utf8');

    cachedConfig = sanitized;
    cachedAt = Date.now();

    return sanitized;
}

export function toPublicConfig(config) {
    const apiKey = sanitizeApiKey(config?.apiKey);
    return {
        panelUrl: sanitizeUrl(config?.panelUrl),
        serverId: sanitizeServerId(config?.serverId),
        whitelistCommandTemplate: sanitizeCommandTemplate(config?.whitelistCommandTemplate),
        whitelistRemoveCommandTemplate: sanitizeCommandTemplate(config?.whitelistRemoveCommandTemplate),
        hasApiKey: Boolean(apiKey),
        apiKeyMasked: apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : ''
    };
}

export function applyConfigOverrides(currentConfig, overrides) {
    const next = { ...currentConfig };
    
    // Always apply overrides if they are provided (can be empty string to clear)
    if (overrides?.panelUrl !== undefined) next.panelUrl = sanitizeUrl(overrides.panelUrl);
    if (overrides?.serverId !== undefined) next.serverId = sanitizeServerId(overrides.serverId);
    if (overrides?.apiKey !== undefined) next.apiKey = sanitizeApiKey(overrides.apiKey);
    if (overrides?.whitelistCommandTemplate !== undefined) {
        next.whitelistCommandTemplate = sanitizeCommandTemplate(overrides.whitelistCommandTemplate);
    }
    if (overrides?.whitelistRemoveCommandTemplate !== undefined) {
        next.whitelistRemoveCommandTemplate = sanitizeCommandTemplate(overrides.whitelistRemoveCommandTemplate);
    }

    return next;
}
