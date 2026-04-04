import { createClient } from 'redis';

const CACHE_TTL = 300; // 5 minutes
const CONNECT_TIMEOUT_MS = 1500;
const memoryCache = new Map();
let client = null;
let redisEnabled = true;
let redisReady = false;
let warned = false;

function now() {
    return Date.now();
}

function logFallbackOnce(error) {
    if (warned) return;
    warned = true;
    console.warn('⚠️  Redis không khả dụng, chuyển sang cache RAM. ', error?.message || '');
}

function memoryGet(key) {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= now()) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}

function memorySet(key, value, ttlSeconds = CACHE_TTL) {
    memoryCache.set(key, {
        value,
        expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : null
    });
}

function memoryDelete(key) {
    memoryCache.delete(key);
}

async function initRedis() {
    const disabled = String(process.env.DISABLE_REDIS || '').toLowerCase() === 'true';
    if (disabled) {
        redisEnabled = false;
        return;
    }

    client = createClient();

    client.on('error', (err) => {
        if (redisEnabled) {
            redisEnabled = false;
            redisReady = false;
            logFallbackOnce(err);
        }
    });

    try {
        await Promise.race([
            client.connect(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), CONNECT_TIMEOUT_MS))
        ]);
        redisReady = true;
    } catch (error) {
        redisEnabled = false;
        redisReady = false;
        logFallbackOnce(error);
        try {
            await client.disconnect();
        } catch (_err) {
            // Ignore disconnect errors
        }
        client = null;
    }
}

void initRedis().catch((error) => {
    redisEnabled = false;
    redisReady = false;
    logFallbackOnce(error);
});

export async function getCache(key) {
    if (redisEnabled && redisReady && client) {
        try {
            const data = await client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error('Error getting cache:', error);
            return memoryGet(key);
        }
    }
    return memoryGet(key);
}

export async function setCache(key, data) {
    if (redisEnabled && redisReady && client) {
        try {
            await client.setEx(key, CACHE_TTL, JSON.stringify(data));
            return;
        } catch (error) {
            console.error('Error setting cache:', error);
        }
    }
    memorySet(key, data, CACHE_TTL);
}

export async function deleteCache(key) {
    if (redisEnabled && redisReady && client) {
        try {
            await client.del(key);
            return;
        } catch (error) {
            console.error('Error deleting cache:', error);
        }
    }
    memoryDelete(key);
}

export default client;
