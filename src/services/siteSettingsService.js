import { promises as fs } from 'fs';
import path from 'path';
import {
    JSON_DIR,
    PIKAMC_IP,
    PIKAMC_PORT,
    PANEL_URL,
    SERVER_ID
} from '../config/index.js';

const SETTINGS_FILE = path.join(JSON_DIR, 'site-settings.json');
const CACHE_TTL = 5000;
const SETTING_KEY_PATTERN = /^[a-z0-9._-]{2,64}$/;
const DEFAULT_TIMESTAMP = new Date().toISOString();

const DEFAULT_SITE_SETTINGS = [
    {
        key: 'server_display_name',
        label: 'Ten hien thi server',
        value: 'VNA Server',
        description: 'Ten hien thi cong khai tren website.',
        visibility: 'public',
        type: 'text',
        category: 'minecraft',
        updatedAt: DEFAULT_TIMESTAMP
    },
    {
        key: 'minecraft_ip',
        label: 'IP Minecraft',
        value: PIKAMC_IP,
        description: 'Dia chi vao Minecraft Bedrock.',
        visibility: 'public',
        type: 'text',
        category: 'minecraft',
        updatedAt: DEFAULT_TIMESTAMP
    },
    {
        key: 'minecraft_port',
        label: 'Port Minecraft',
        value: PIKAMC_PORT,
        description: 'Cong vao Minecraft Bedrock.',
        visibility: 'public',
        type: 'number',
        category: 'minecraft',
        updatedAt: DEFAULT_TIMESTAMP
    },
    {
        key: 'hosting_panel_url',
        label: 'Panel hosting',
        value: PANEL_URL,
        description: 'Link panel hosting dang duoc su dung.',
        visibility: 'private',
        type: 'url',
        category: 'hosting',
        updatedAt: DEFAULT_TIMESTAMP
    },
    {
        key: 'hosting_api_url',
        label: 'API hosting',
        value: PANEL_URL ? `${PANEL_URL}/api/client` : '',
        description: 'Endpoint API hosting neu can goi tu server.',
        visibility: 'private',
        type: 'url',
        category: 'hosting',
        updatedAt: DEFAULT_TIMESTAMP
    },
    {
        key: 'hosting_server_id',
        label: 'Server ID hosting',
        value: SERVER_ID,
        description: 'Ma server dang duoc quan ly tren hosting.',
        visibility: 'private',
        type: 'text',
        category: 'hosting',
        updatedAt: DEFAULT_TIMESTAMP
    }
];

const DEFAULT_SETTING_MAP = new Map(DEFAULT_SITE_SETTINGS.map((item) => [item.key, item]));
const DEFAULT_SETTING_ORDER = new Map(DEFAULT_SITE_SETTINGS.map((item, index) => [item.key, index]));

let cachedItems = null;
let cachedAt = 0;
let inFlight = null;

function sanitizeText(value, maxLen = 500) {
    return String(value ?? '').trim().slice(0, maxLen);
}

function sanitizeSettingKey(value) {
    const key = sanitizeText(value, 64).toLowerCase();
    if (!SETTING_KEY_PATTERN.test(key)) {
        throw new Error('Key khong hop le. Chi dung chu thuong, so, dau cham, gach ngang va gach duoi.');
    }
    return key;
}

function sanitizeVisibility(value) {
    return String(value || '').trim().toLowerCase() === 'private' ? 'private' : 'public';
}

function sanitizeType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type === 'url' || type === 'number') return type;
    return 'text';
}

function sanitizeTimestamp(value) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return DEFAULT_TIMESTAMP;
    return time.toISOString();
}

function sanitizeValueByType(value, type, key) {
    const text = sanitizeText(value, 500);

    if (type === 'url') {
        if (!text) return '';
        
        // Relax validation for hosting keys to allow clearing them
        if (key.startsWith('hosting_') && !text) {
            return '';
        }

        if (!/^https?:\/\//i.test(text)) {
            throw new Error(`Gia tri cua "${key}" phai la URL hop le.`);
        }
        return text.replace(/\/+$/, '');
    }

    if (type === 'number') {
        if (!text) return '';
        if (!/^\d+$/.test(text)) {
            throw new Error(`Gia tri cua "${key}" phai la so hop le.`);
        }

        const numeric = Number.parseInt(text, 10);
        if (!Number.isFinite(numeric)) {
            throw new Error(`Gia tri cua "${key}" phai la so hop le.`);
        }
        if (key === 'minecraft_port' && (numeric < 1 || numeric > 65535)) {
            throw new Error('Port Minecraft phai nam trong khoang 1-65535.');
        }

        return String(numeric);
    }

    if (key === 'minecraft_ip') {
        if (!text) {
            throw new Error('IP Minecraft khong duoc de trong.');
        }
        if (/^https?:\/\//i.test(text) || /\s/.test(text)) {
            throw new Error('IP Minecraft khong hop le.');
        }
    }

    return text;
}

function sortSettings(items) {
    return [...items].sort((a, b) => {
        const aIsSystem = DEFAULT_SETTING_ORDER.has(a.key);
        const bIsSystem = DEFAULT_SETTING_ORDER.has(b.key);

        if (aIsSystem !== bIsSystem) {
            return aIsSystem ? -1 : 1;
        }

        const aOrder = DEFAULT_SETTING_ORDER.get(a.key) ?? Number.MAX_SAFE_INTEGER;
        const bOrder = DEFAULT_SETTING_ORDER.get(b.key) ?? Number.MAX_SAFE_INTEGER;

        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }

        return a.key.localeCompare(b.key, 'vi');
    });
}

function normalizeSetting(raw, fallback = {}) {
    const key = sanitizeSettingKey(raw?.key ?? fallback?.key);
    const type = sanitizeType(raw?.type ?? fallback?.type);
    const label = sanitizeText(raw?.label ?? fallback?.label, 80) || key;
    const description = sanitizeText(raw?.description ?? fallback?.description, 220);
    const category = sanitizeText(raw?.category ?? fallback?.category, 60) || 'general';
    const visibility = sanitizeVisibility(raw?.visibility ?? fallback?.visibility);
    const value = sanitizeValueByType(raw?.value ?? fallback?.value, type, key);
    const updatedAt = sanitizeTimestamp(raw?.updatedAt ?? fallback?.updatedAt ?? DEFAULT_TIMESTAMP);

    return {
        key,
        label,
        value,
        description,
        visibility,
        type,
        category,
        updatedAt
    };
}

function decorateSetting(setting) {
    const isSystem = DEFAULT_SETTING_MAP.has(setting.key);
    return {
        ...setting,
        system: isSystem,
        deletable: !isSystem
    };
}

function stripSettingMeta(setting) {
    const plain = { ...setting };
    delete plain.system;
    delete plain.deletable;
    return plain;
}

function cloneItems(items) {
    return items.map((item) => ({ ...item }));
}

function setCache(items) {
    cachedItems = sortSettings(items.map((item) => decorateSetting(stripSettingMeta(item))));
    cachedAt = Date.now();
    inFlight = null;
    return cloneItems(cachedItems);
}

async function readSettingsFile() {
    try {
        const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.items)
                ? parsed.items
                : [];

        const map = new Map(DEFAULT_SITE_SETTINGS.map((item) => [item.key, normalizeSetting(item)]));

        for (const item of items) {
            try {
                const key = sanitizeSettingKey(item?.key);
                const fallback = map.get(key) || {};
                map.set(key, normalizeSetting(item, fallback));
            } catch (error) {
                console.warn('[Site Settings] Skip invalid item:', error.message);
            }
        }

        return sortSettings(Array.from(map.values()));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return DEFAULT_SITE_SETTINGS.map((item) => normalizeSetting(item));
        }
        console.error('[Site Settings] Read error:', error.message);
        return DEFAULT_SITE_SETTINGS.map((item) => normalizeSetting(item));
    }
}

async function writeSettingsFile(items) {
    const payload = {
        updatedAt: new Date().toISOString(),
        items: sortSettings(items).map((item) => stripSettingMeta(item))
    };

    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

export async function getSiteSettings(force = false) {
    const now = Date.now();
    if (!force && cachedItems && now - cachedAt < CACHE_TTL) {
        return cloneItems(cachedItems);
    }

    if (!force && inFlight) {
        return inFlight;
    }

    inFlight = (async () => {
        const items = await readSettingsFile();
        return setCache(items);
    })();

    return inFlight;
}

export async function upsertSiteSettings(inputItems) {
    const items = Array.isArray(inputItems) ? inputItems : [];
    if (items.length === 0) {
        throw new Error('Khong co thong so nao de luu.');
    }

    const current = await getSiteSettings(true);
    const map = new Map(current.map((item) => [item.key, stripSettingMeta(item)]));
    const timestamp = new Date().toISOString();

    for (const item of items) {
        const rawKey = sanitizeSettingKey(item?.key);
        const fallback = map.get(rawKey) || DEFAULT_SETTING_MAP.get(rawKey) || { key: rawKey };
        const next = normalizeSetting({ ...item, updatedAt: timestamp }, fallback);
        map.set(rawKey, next);
    }

    const nextItems = sortSettings(Array.from(map.values()));
    await writeSettingsFile(nextItems);
    return setCache(nextItems);
}

export async function deleteSiteSetting(settingKey) {
    const key = sanitizeSettingKey(settingKey);
    const current = await getSiteSettings(true);
    const map = new Map(current.map((item) => [item.key, stripSettingMeta(item)]));
    const existing = map.get(key);

    if (!existing) {
        throw new Error('Khong tim thay thong so can xoa.');
    }

    const defaultSetting = DEFAULT_SETTING_MAP.get(key);
    let resetToDefault = false;

    if (defaultSetting) {
        map.set(key, normalizeSetting({
            ...defaultSetting,
            updatedAt: new Date().toISOString()
        }));
        resetToDefault = true;
    } else {
        map.delete(key);
    }

    const nextItems = sortSettings(Array.from(map.values()));
    await writeSettingsFile(nextItems);
    const updatedItems = setCache(nextItems);

    return {
        resetToDefault,
        items: updatedItems,
        item: updatedItems.find((item) => item.key === key) || null
    };
}

export async function getPublicSiteSettings() {
    const items = await getSiteSettings();
    const settings = {};

    for (const item of items) {
        if (item.visibility === 'public') {
            settings[item.key] = item.value;
        }
    }

    const ip = settings.minecraft_ip || PIKAMC_IP;
    const port = settings.minecraft_port || PIKAMC_PORT;
    const displayName = settings.server_display_name || 'VNA Server';

    return {
        settings,
        minecraft: {
            ip,
            port,
            address: `${ip}:${port}`,
            displayName
        }
    };
}
