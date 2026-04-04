import path from 'path';
import { promises as fsp } from 'fs';
import { JSON_DIR } from '../config/index.js';

const TOOL_USAGE_FILE = path.join(JSON_DIR, 'tool-usage.json');
const TOOL_USAGE_LOCK_FILE = path.join(JSON_DIR, '.tool-usage.lock');
const LOCK_TIMEOUT_MS = 4000;
const LOCK_STALE_MS = 15000;
const LOCK_RETRY_MS = 40;

const TOOL_META = {
    tiktok: { label: 'TikTok', icon: 'fab fa-tiktok' },
    youtube: { label: 'YouTube', icon: 'fab fa-youtube' },
    x: { label: 'X', icon: 'fab fa-twitter' },
    soundcloud: { label: 'SoundCloud', icon: 'fab fa-soundcloud' },
    facebook: { label: 'Facebook', icon: 'fab fa-facebook-f' }
};

function defaultToolData() {
    return {
        downloads: 0,
        lastDownloadedAt: null
    };
}

function createDefaultState() {
    const tools = {};
    for (const toolName of Object.keys(TOOL_META)) {
        tools[toolName] = defaultToolData();
    }
    return {
        updatedAt: null,
        tools
    };
}

function toInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
}

function toIsoOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function normalizeState(raw) {
    const base = createDefaultState();
    if (!raw || typeof raw !== 'object') return base;

    base.updatedAt = toIsoOrNull(raw.updatedAt);

    const sourceTools = raw.tools && typeof raw.tools === 'object' ? raw.tools : {};
    for (const toolName of Object.keys(TOOL_META)) {
        const source = sourceTools[toolName] && typeof sourceTools[toolName] === 'object'
            ? sourceTools[toolName]
            : {};
        const downloads = toInt(source.downloads);
        const lastDownloadedAt = toIsoOrNull(source.lastDownloadedAt) || toIsoOrNull(source.lastUsedAt);
        base.tools[toolName] = {
            downloads,
            lastDownloadedAt: downloads > 0 ? lastDownloadedAt : null
        };
    }

    return base;
}

async function ensureStatsFile() {
    await fsp.mkdir(JSON_DIR, { recursive: true });
    try {
        await fsp.access(TOOL_USAGE_FILE);
    } catch (_err) {
        await fsp.writeFile(TOOL_USAGE_FILE, JSON.stringify(createDefaultState(), null, 2), 'utf8');
    }
}

async function readStateNoLock() {
    try {
        const raw = await fsp.readFile(TOOL_USAGE_FILE, 'utf8');
        return normalizeState(JSON.parse(raw));
    } catch (_err) {
        return createDefaultState();
    }
}

async function writeStateNoLock(state) {
    await fsp.writeFile(TOOL_USAGE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock(work) {
    await ensureStatsFile();
    const start = Date.now();
    let lockHandle = null;

    while (!lockHandle) {
        try {
            lockHandle = await fsp.open(TOOL_USAGE_LOCK_FILE, 'wx');
            await lockHandle.writeFile(String(process.pid));
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const stat = await fsp.stat(TOOL_USAGE_LOCK_FILE).catch(() => null);
            if (stat && (Date.now() - stat.mtimeMs) > LOCK_STALE_MS) {
                await fsp.rm(TOOL_USAGE_LOCK_FILE, { force: true }).catch(() => {});
                continue;
            }

            if ((Date.now() - start) > LOCK_TIMEOUT_MS) {
                throw new Error('TOOL_USAGE_LOCK_TIMEOUT');
            }
            await sleep(LOCK_RETRY_MS);
        }
    }

    try {
        return await work();
    } finally {
        try {
            await lockHandle.close();
        } catch (_err) {
            // Ignore lock-handle cleanup errors.
        }
        await fsp.rm(TOOL_USAGE_LOCK_FILE, { force: true }).catch(() => {});
    }
}

function buildSummary(state) {
    const ranking = Object.entries(TOOL_META)
        .map(([tool, meta]) => {
            const current = state.tools[tool] || defaultToolData();
            const downloads = toInt(current.downloads);

            return {
                tool,
                label: meta.label,
                icon: meta.icon,
                downloads,
                lastDownloadedAt: toIsoOrNull(current.lastDownloadedAt)
            };
        })
        .sort((a, b) => (b.downloads - a.downloads) || a.label.localeCompare(b.label));

    const totals = ranking.reduce((acc, item) => {
        acc.downloads += item.downloads;
        return acc;
    }, { downloads: 0 });

    return {
        updatedAt: toIsoOrNull(state.updatedAt),
        totals,
        ranking
    };
}

export async function getToolUsageSummary() {
    await ensureStatsFile();
    const state = await readStateNoLock();
    return buildSummary(state);
}

export async function incrementToolUsage(tool, options = {}) {
    const toolName = String(tool || '').trim().toLowerCase();
    if (!TOOL_META[toolName]) {
        return null;
    }

    const amount = Math.max(1, toInt(options.amount || 1));
    const nowIso = new Date().toISOString();

    const summary = await withFileLock(async () => {
        const state = await readStateNoLock();
        const current = state.tools[toolName] || defaultToolData();

        current.downloads = toInt(current.downloads) + amount;
        current.lastDownloadedAt = nowIso;
        state.tools[toolName] = current;
        state.updatedAt = nowIso;

        await writeStateNoLock(state);
        return buildSummary(state);
    });

    return summary;
}

export function resolveToolFromPlatform(input) {
    const value = String(input || '').trim().toLowerCase();
    if (!TOOL_META[value]) return null;
    return value;
}
