import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { fork } from 'child_process';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { statfs, mkdir, readFile, writeFile, readdir, stat } from 'fs/promises';

// Import internal modules
import { setupMiddleware, setupRateLimiters } from './src/middleware/setup.js';

import { setupRoutes } from './src/routes/index.js';
import { loadChatHistory, addChatMessage, shouldBlockMessage } from './src/services/chatService.js';
import { sendConsoleCommand } from './src/services/pikamcService.js';
import {
    PORT,
    ROOT_DIR,
    WHITELIST_COMMAND_TEMPLATE,
    WHITELIST_REMOVE_COMMAND_TEMPLATE
} from './src/config/index.js';
import {
    getPikamcConfig,
    savePikamcConfig,
    toPublicConfig,
    applyConfigOverrides
} from './src/services/pikamcConfigService.js';
import db from './src/modules/database.js';

// Import existing modules
import statusRoute, { setSocketIO, getNetworkHistory } from './src/modules/status/status.js';
import snapsaveRoute from './src/modules/downloader/facebook.js';

import authRoutes from './src/modules/auth/oauth.js';
import { handleYoutubeDownload, getYoutubeInfo } from './src/modules/downloader/youtube.js';
import { handleSoundCloudDownload, getSoundCloudInfo } from './src/modules/downloader/soundcloud.js';
import downloaderRoutes from './src/routes/downloaderRoutes.js';
import { proxyDownload as proxyDownloadUnified } from './src/controllers/downloaderController.js';
import {
    getToolUsageSummary,
    incrementToolUsage,
    resolveToolFromPlatform
} from './src/services/toolUsageService.js';

import { startBot2, BOT2_TOKEN, sendEmbed, isBotReady, sendDirectMessage, buildStreakReminderPayload, setSocketIO as setBot2SocketIO } from './bot/bot2.js';
import { loadStreaks as loadStreaksService, isCheckedInToday, getStartOfDay, getLocalDateString } from './src/services/streakService.js';
import { getDonations } from './src/services/donateService.js';

import binhchonRoute from './bot/binhchon.js';
import albumRoutes from './src/routes/albumRoutes.js';
import streakRoutes from './src/routes/streakRoutes.js';
import cloudRoutes from './src/routes/cloudRoutes.js';
import ssrRoutes from './src/routes/ssrRoutes.js';
import forumRoutes from './src/routes/forumRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECENT_USERS_FILE = path.join(ROOT_DIR, 'json', 'recent-users.json');
const FURINA_QUOTES_FILE = path.join(ROOT_DIR, 'json', 'furina_quotes.json');
const SERVER_STATUS_FILE = path.join(ROOT_DIR, 'json', 'server_status.json');
const COUNTDOWN_SETTINGS_FILE = path.join(ROOT_DIR, 'json', 'countdown_settings.json');
const DOWNLOADS_JSON_FILE = path.join(ROOT_DIR, 'json', 'minecraft_downloads.json');
const STREAK_REMINDER_FILE = path.join(ROOT_DIR, 'json', 'streak-reminder.json');
const STREAK_REMINDER_MESSAGES_FILE = path.join(ROOT_DIR, 'json', 'streak-reminders.json');
const RECENT_USERS_MAX = 30;
const RECENT_USERS_DEFAULT_LIMIT = 8;
const STREAK_REMINDER_HOUR = 20;
const STREAK_REMINDER_MINUTE = 0;
const STREAK_REMINDER_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STREAK_REMINDER_MAX_DAYS_INACTIVE = 30;

function parseIdSet(rawValue) {
    return new Set(
        String(rawValue || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
    );
}

const ADMIN_IDS = parseIdSet(process.env.ADMIN_ID || process.env.DISCORD_ADMIN_ID || '');
const EMBED_ALLOWED_IDS = parseIdSet(process.env.DISCORD_EMBED_ALLOWED_IDS || '');

function isAdminUserId(userId) {
    const normalizedId = String(userId || '').trim();
    return Boolean(normalizedId) && ADMIN_IDS.has(normalizedId);
}

function getAllowedEmbedIds() {
    if (EMBED_ALLOWED_IDS.size > 0) return EMBED_ALLOWED_IDS;
    return ADMIN_IDS;
}

const STATIC_PUBLIC_OPTIONS = {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
};

function requireEmbedAuthorization(req, res, next) {
    const userId = String(req.session?.user?.id || '').trim();
    if (!userId) {
        return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để gửi embed.' });
    }

    const allowedIds = getAllowedEmbedIds();

    if (allowedIds.size === 0) {
        return res.status(503).json({
            success: false,
            error: 'Server chưa cấu hình quyền gửi embed (DISCORD_EMBED_ALLOWED_IDS hoặc ADMIN_ID).'
        });
    }

    if (!allowedIds.has(userId)) {
        return res.status(403).json({ success: false, error: 'Bạn không có quyền gửi embed.' });
    }

    return next();
}

function requireAdminPageAccess(req, res, next) {
    const userId = String(req.session?.user?.id || '').trim();
    if (!userId) {
        return res.status(401).send('Vui lòng đăng nhập để truy cập trang admin.');
    }
    if (!isAdminUserId(userId)) {
        return res.status(403).send('Bạn không có quyền truy cập trang admin.');
    }
    return next();
}

function sanitizeRecentText(value, maxLen = 120, fallback = '') {
    const text = String(value ?? '').trim().slice(0, maxLen);
    return text || fallback;
}

function sanitizeAdminText(value, maxLen = 120) {
    return String(value ?? '').trim().slice(0, maxLen);
}

function sanitizePanelUrl(value, maxLen = 500) {
    const text = String(value ?? '').trim().slice(0, maxLen);
    if (!text || !/^https?:\/\//i.test(text)) return '';
    return text.replace(/\/+$/, '');
}

function sanitizeServerId(value, maxLen = 80) {
    return String(value ?? '').trim().slice(0, maxLen);
}

function sanitizeCommandTemplate(value, maxLen = 160) {
    return String(value ?? '').trim().slice(0, maxLen);
}

const WHITELIST_KEY_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
const GAMERTAG_PATTERN = /^[A-Za-z0-9 _-]{2,32}$/;

function sanitizeWhitelistKey(value, maxLen = 64) {
    const text = String(value ?? '').trim().slice(0, maxLen);
    if (!text || !WHITELIST_KEY_PATTERN.test(text)) return '';
    return text;
}

function sanitizeGamertag(value, maxLen = 32) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    if (!text || !GAMERTAG_PATTERN.test(text)) return '';
    return text;
}

function normalizeGamertag(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildWhitelistCommand(gamertag, templateOverride = '') {
    const safeGamertag = String(gamertag ?? '').replace(/["\r\n]/g, '').trim();
    const template = String(templateOverride || WHITELIST_COMMAND_TEMPLATE || '').trim();
    if (!safeGamertag) return null;
    if (template.includes('{gamertag}')) {
        return template.replace('{gamertag}', safeGamertag);
    }
    if (template) {
        return `${template} ${safeGamertag}`;
    }
    return `whitelist add "${safeGamertag}"`;
}

function buildWhitelistRemoveCommand(gamertag, templateOverride = '', addTemplateOverride = '') {
    const safeGamertag = String(gamertag ?? '').replace(/["\r\n]/g, '').trim();
    const template = String(templateOverride || WHITELIST_REMOVE_COMMAND_TEMPLATE || '').trim();
    if (!safeGamertag) return null;

    if (template) {
        if (template.includes('{gamertag}')) {
            return template.replace('{gamertag}', safeGamertag);
        }

        return `${template} ${safeGamertag}`;
    }

    const addTemplate = String(addTemplateOverride || WHITELIST_COMMAND_TEMPLATE || '').trim();
    if (addTemplate) {
        const inferredRemoveTemplate = addTemplate.replace(/\badd\b/i, 'remove');
        if (inferredRemoveTemplate.includes('{gamertag}')) {
            return inferredRemoveTemplate.replace('{gamertag}', safeGamertag);
        }
        if (inferredRemoveTemplate !== addTemplate) {
            return `${inferredRemoveTemplate} ${safeGamertag}`;
        }
    }

    return `whitelist remove "${safeGamertag}"`;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let reminderMessagesCache = null;

async function loadReminderMessages() {
    if (reminderMessagesCache) return reminderMessagesCache;
    try {
        const raw = await readFile(STREAK_REMINDER_MESSAGES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()) : [];
        reminderMessagesCache = list;
        return list;
    } catch (_error) {
        reminderMessagesCache = [];
        return [];
    }
}

function pickRandomReminder(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const idx = Math.floor(Math.random() * messages.length);
    return messages[idx];
}

async function loadReminderState() {
    try {
        const raw = await readFile(STREAK_REMINDER_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const lastSentDate = String(parsed?.lastSentDate || '').trim();
        const lastSentAt = String(parsed?.lastSentAt || '').trim();
        const lastSentTotal = Number.isFinite(Number(parsed?.lastSentTotal))
            ? Math.max(0, Math.floor(Number(parsed.lastSentTotal)))
            : 0;
        const lastSentSuccess = Number.isFinite(Number(parsed?.lastSentSuccess))
            ? Math.max(0, Math.floor(Number(parsed.lastSentSuccess)))
            : 0;
        const lastSentFailed = Number.isFinite(Number(parsed?.lastSentFailed))
            ? Math.max(0, Math.floor(Number(parsed.lastSentFailed)))
            : 0;
        return {
            lastSentDate: lastSentDate || null,
            lastSentAt: lastSentAt || null,
            lastSentTotal,
            lastSentSuccess,
            lastSentFailed
        };
    } catch (_error) {
        return {
            lastSentDate: null,
            lastSentAt: null,
            lastSentTotal: 0,
            lastSentSuccess: 0,
            lastSentFailed: 0
        };
    }
}

async function saveReminderState(dateStr, summary = {}) {
    const total = Number.isFinite(Number(summary?.total)) ? Math.max(0, Math.floor(Number(summary.total))) : 0;
    const success = Number.isFinite(Number(summary?.success)) ? Math.max(0, Math.floor(Number(summary.success))) : 0;
    const failed = Number.isFinite(Number(summary?.failed)) ? Math.max(0, Math.floor(Number(summary.failed))) : 0;
    const sentAt = String(summary?.sentAt || '').trim() || new Date().toISOString();
    await mkdir(path.dirname(STREAK_REMINDER_FILE), { recursive: true });
    const payload = {
        lastSentDate: dateStr,
        lastSentAt: sentAt,
        lastSentTotal: total,
        lastSentSuccess: success,
        lastSentFailed: failed,
        updatedAt: new Date().toISOString()
    };
    await writeFile(STREAK_REMINDER_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

async function runStreakReminder() {
    const now = new Date();
    const isAfterReminderTime = now.getHours() > STREAK_REMINDER_HOUR
        || (now.getHours() === STREAK_REMINDER_HOUR && now.getMinutes() >= STREAK_REMINDER_MINUTE);
    if (!isAfterReminderTime) return;

    const todayStr = getLocalDateString(now);
    const reminderState = await loadReminderState();
    if (reminderState.lastSentDate === todayStr) return;

    if (!BOT2_TOKEN || BOT2_TOKEN.includes('PASTE_YOUR_BOT_TOKEN_HERE')) {
        console.warn('[Streak Reminder] BOT2_TOKEN chưa cấu hình, bỏ qua nhắc nhở.');
        return;
    }

    const ok = await startBot2();
    if (!ok) {
        console.warn('[Streak Reminder] Bot chưa sẵn sàng để gửi nhắc nhở.');
        return;
    }

    const data = await loadStreaksService(now, STREAK_REMINDER_MAX_DAYS_INACTIVE);
    const today = getStartOfDay(now);
    const targets = data.streaks.filter((streak) => (
        streak?.userId
        && streak?.lastCheckIn
        && !isCheckedInToday(streak, today)
    ));

    if (targets.length === 0) {
        const finishedAt = new Date().toISOString();
        await saveReminderState(todayStr, { total: 0, success: 0, failed: 0, sentAt: finishedAt });
        console.log('[Streak Reminder] Không có ai cần nhắc hôm nay.');
        return;
    }

    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://vanhmcpe.top';
    const reminders = await loadReminderMessages();
    const reminderLine = pickRandomReminder(reminders);
    const reminderPayload = buildStreakReminderPayload(baseUrl, { reminderLine });

    let success = 0;
    let failed = 0;

    for (const streak of targets) {
        const result = await sendDirectMessage(streak.userId, reminderPayload);
        if (result.success) {
            success += 1;
        } else {
            failed += 1;
            console.warn(`[Streak Reminder] DM failed for ${streak.userId}: ${result.error}`);
        }
        await delay(350);
    }

    const finishedAt = new Date().toISOString();
    await saveReminderState(todayStr, { total: targets.length, success, failed, sentAt: finishedAt });
    console.log(`[Streak Reminder] Sent=${success}, Failed=${failed}, Total=${targets.length}`);
}

function startStreakReminderScheduler() {
    runStreakReminder().catch((error) => {
        console.error('[Streak Reminder] Lỗi khi chạy nhắc nhở:', error);
    });
    setInterval(() => {
        runStreakReminder().catch((error) => {
            console.error('[Streak Reminder] Lỗi khi chạy nhắc nhở:', error);
        });
    }, STREAK_REMINDER_CHECK_INTERVAL_MS);
}

async function listMinecraftFiles() {
    const baseDir = path.join(ROOT_DIR, 'Minecraft');
    let entries = [];
    try {
        entries = await readdir(baseDir, { withFileTypes: true });
    } catch (_error) {
        return [];
    }

    const files = entries.filter((entry) => entry.isFile());
    const items = await Promise.all(
        files.map(async (entry) => {
            const fullPath = path.join(baseDir, entry.name);
            const info = await stat(fullPath).catch(() => null);
            return {
                name: entry.name,
                size: info?.size || 0,
                url: `/Minecraft/${encodeURIComponent(entry.name)}`
            };
        })
    );

    return items.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

async function readMinecraftDownloads() {
    try {
        const raw = await readFile(DOWNLOADS_JSON_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

async function writeMinecraftDownloads(items) {
    await mkdir(path.dirname(DOWNLOADS_JSON_FILE), { recursive: true });
    await writeFile(DOWNLOADS_JSON_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function createDownloadId() {
    const seed = `${Date.now()}-${Math.random()}`;
    return createHash('sha1').update(seed).digest('hex').slice(0, 12);
}

function normalizeRecentTimestamp(value) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return null;
    return time.toISOString();
}

function normalizeStoredRecentUser(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = sanitizeRecentText(raw.id, 64, '');
    const username = sanitizeRecentText(raw.username, 80, 'User');
    const avatar = sanitizeRecentText(raw.avatar, 700, '');
    const loggedIn = Boolean(raw.loggedIn) && Boolean(id);
    const key = sanitizeRecentText(raw.key, 180, '') || (id ? `user:${id}` : '');
    const lastSeen = normalizeRecentTimestamp(raw.lastSeen) || new Date().toISOString();

    if (!key) return null;

    return {
        key,
        id: id || null,
        username: username || 'User',
        avatar,
        loggedIn,
        lastSeen
    };
}

async function readRecentUsersStore() {
    try {
        const raw = await readFile(RECENT_USERS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map(normalizeStoredRecentUser)
            .filter(Boolean)
            .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
            .slice(0, RECENT_USERS_MAX);
    } catch (_error) {
        return [];
    }
}

async function writeRecentUsersStore(items) {
    await mkdir(path.dirname(RECENT_USERS_FILE), { recursive: true });
    await writeFile(RECENT_USERS_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function buildRecentUserRecord(req) {
    const sessionUser = req.session?.user;
    const now = new Date().toISOString();
    const hasLoggedInUser = Boolean(sessionUser?.id && sessionUser?.username);

    if (hasLoggedInUser) {
        const id = sanitizeRecentText(sessionUser.id, 64, '');
        const username = sanitizeRecentText(sessionUser.username, 80, 'User');
        const avatar = sanitizeRecentText(sessionUser.avatar, 700, '');

        if (id) {
            return {
                key: `user:${id}`,
                id,
                username: username || 'User',
                avatar,
                loggedIn: true,
                lastSeen: now
            };
        }
    }

    const forwardedHeader = req.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader;
    const sourceIp = String(forwardedValue || req.ip || 'guest');
    const guestHash = createHash('sha1').update(sourceIp).digest('hex').slice(0, 16);

    return {
        key: `guest:${guestHash}`,
        id: null,
        username: 'User',
        avatar: '',
        loggedIn: false,
        lastSeen: now
    };
}

function toRecentUserPublic(item) {
    return {
        id: item.id || null,
        username: item.username || 'User',
        avatar: item.avatar || '',
        loggedIn: Boolean(item.loggedIn && item.id),
        lastSeen: item.lastSeen || null
    };
}

async function touchAndListRecentUsers(req, limit = RECENT_USERS_DEFAULT_LIMIT) {
    const currentRecord = buildRecentUserRecord(req);
    const existingItems = await readRecentUsersStore();
    const merged = [currentRecord, ...existingItems.filter((entry) => entry.key !== currentRecord.key)]
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
        .slice(0, RECENT_USERS_MAX);

    await writeRecentUsersStore(merged);
    return merged.slice(0, limit).map(toRecentUserPublic);
}

function toSafeDisplayText(value, maxLen = 160, fallback = '') {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    return text || fallback;
}

async function readJsonWithFallback(filePath, fallbackValue) {
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : fallbackValue;
    } catch (_error) {
        return fallbackValue;
    }
}

const whitelistStatements = {
    list: db.prepare(`
        SELECT id, "key", gamertag, status, created_at, used_at
        FROM whitelist_keys
        ORDER BY created_at DESC, id DESC
    `),
    byId: db.prepare(`
        SELECT id, "key", gamertag, gamertag_norm, status, created_at, used_at
        FROM whitelist_keys
        WHERE id = ?
        LIMIT 1
    `),
    byKey: db.prepare(`
        SELECT id, "key", gamertag, gamertag_norm, status, created_at, used_at
        FROM whitelist_keys
        WHERE "key" = ?
        LIMIT 1
    `),
    insert: db.prepare(`
        INSERT INTO whitelist_keys ("key", gamertag, gamertag_norm, status, created_at)
        VALUES (?, ?, ?, ?, ?)
    `),
    deleteById: db.prepare('DELETE FROM whitelist_keys WHERE id = ?'),
    claimProcessing: db.prepare('UPDATE whitelist_keys SET status = ? WHERE id = ? AND status = ?'),
    revertProcessing: db.prepare('UPDATE whitelist_keys SET status = ?, used_at = NULL WHERE id = ? AND status = ?'),
    markUsed: db.prepare('UPDATE whitelist_keys SET status = ?, used_at = ? WHERE id = ? AND status = ?')
};

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

// Set Socket.IO for status server and bot2
setSocketIO(io);
setBot2SocketIO(io);

// Setup middleware
const { sessionMiddleware } = setupMiddleware(app);
setupRateLimiters(app);

if (sessionMiddleware) {
    io.use((socket, next) => {
        sessionMiddleware(socket.request, socket.request.res || {}, next);
    });
}

// Setup EJS templating engine for server-side rendering
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Cache views in production for better performance
if (process.env.NODE_ENV === 'production') {
    app.set('view cache', true);
}

// Tắt CSP để test - cho phép tất cả

function queueToolUsageIncrement(tool) {
    if (!tool) return;
    incrementToolUsage(tool).catch((error) => {
        console.error(`[ToolUsage] Failed to record download for ${tool}:`, error.message);
    });
}

function resolveToolFromReferrer(req) {
    const referer = String(req.get('referer') || '').toLowerCase();
    if (!referer) return null;

    if (referer.includes('/html/tiktok.html') || referer.includes('/tiktok')) return 'tiktok';
    if (referer.includes('/html/youtube.html') || referer.includes('/youtube')) return 'youtube';
    if (referer.includes('/html/x.html') || referer.includes('/x') || referer.includes('/twitter')) return 'x';
    if (referer.includes('/html/soundcloud.html') || referer.includes('/soundcloud')) return 'soundcloud';
    if (referer.includes('/p/snapsave.html') || referer.includes('/facebook')) return 'facebook';
    return null;
}

function resolveToolFromProxyBody(body) {
    const payload = body && typeof body === 'object' ? body : {};
    const directPlatform = resolveToolFromPlatform(payload.platform);
    if (directPlatform) return directPlatform;

    const fileName = String(payload.fileName || '').toLowerCase();
    if (fileName.includes('tiktok')) return 'tiktok';
    if (fileName.includes('youtube') || fileName.includes('ytb')) return 'youtube';
    if (fileName.includes('soundcloud') || fileName.includes('sc_')) return 'soundcloud';
    if (fileName.includes('facebook') || fileName.includes('fb_')) return 'facebook';

    const fileUrl = String(payload.fileUrl || payload.url || '').trim();
    if (!fileUrl) return null;

    let host = '';
    try {
        host = new URL(fileUrl).hostname.toLowerCase();
    } catch (_error) {
        return null;
    }

    if (/tiktok|tiktokcdn|ttwstatic|ibyteimg|muscdn|tikwm/.test(host)) return 'tiktok';
    if (/youtube|youtu\.be|googlevideo/.test(host)) return 'youtube';
    if (/soundcloud|sndcdn/.test(host)) return 'soundcloud';
    if (/facebook|fbcdn|fbsbx|cdninstagram/.test(host)) return 'facebook';
    return null;
}

function attachDownloadTracker(res, tool) {
    if (!tool) return;
    res.once('finish', () => {
        const status = Number(res.statusCode || 0);
        if (status >= 200 && status < 400) {
            queueToolUsageIncrement(tool);
        }
    });
}

// Track successful downloads for leaderboard (non-blocking).
app.use((req, res, next) => {
    const requestPath = String(req.path || '');
    const requestMethod = String(req.method || 'GET').toUpperCase();
    let inferredTool = null;

    if (
        (requestPath === '/api/download/proxy-download' || requestPath === '/api/proxy-download')
        && requestMethod === 'POST'
    ) {
        inferredTool = resolveToolFromProxyBody(req.body) || resolveToolFromReferrer(req);
    } else if (requestPath === '/api/download/tiktok' && requestMethod === 'POST') {
        inferredTool = 'tiktok';
    } else if (requestPath === '/api/download/youtube' && requestMethod === 'POST') {
        inferredTool = 'youtube';
    } else if (requestPath === '/api/download/x' && requestMethod === 'POST') {
        inferredTool = 'x';
    } else if (requestPath === '/api/download/soundcloud' && requestMethod === 'POST') {
        inferredTool = 'soundcloud';
    } else if (requestPath === '/api/download/download' && requestMethod === 'POST') {
        inferredTool = resolveToolFromPlatform(req.body?.platform);
    } else if (requestPath === '/api/youtube-proxy' && requestMethod === 'POST') {
        inferredTool = 'youtube';
    } else if (requestPath === '/api/soundcloud-proxy' && requestMethod === 'POST') {
        inferredTool = 'soundcloud';
    } else if (/^\/api\/facebook\/download\/.+/.test(requestPath) && requestMethod === 'GET') {
        inferredTool = 'facebook';
    }

    if (inferredTool) {
        attachDownloadTracker(res, inferredTool);
    }

    next();
});

// Setup routes
setupRoutes(app);

// User info route
app.get('/api/user-info', (req, res) => {
    if (req.session && req.session.user) {
        const userId = String(req.session.user.id || '').trim();
        res.json({
            loggedIn: true,
            username: req.session.user.username,
            avatar: req.session.user.avatar,
            id: userId,
            isAdmin: isAdminUserId(userId)
        });
    } else {
        res.json({ loggedIn: false, isAdmin: false });
    }
});

app.get('/api/user/bits', (req, res) => {
    if (!req.session?.user?.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return res.json({ success: true, bits: 0 });
});

app.get('/api/config/server-status', async (_req, res) => {
    const fallback = { ip: 'vna.vanhmcpe.top', port: '25702', maxPlayers: 50 };
    const parsed = await readJsonWithFallback(SERVER_STATUS_FILE, fallback);
    const payload = {
        ip: toSafeDisplayText(parsed?.ip, 120, fallback.ip),
        port: toSafeDisplayText(parsed?.port, 12, fallback.port),
        maxPlayers: Number.isFinite(Number(parsed?.maxPlayers))
            ? Math.max(1, Math.min(5000, Math.floor(Number(parsed.maxPlayers))))
            : fallback.maxPlayers
    };
    return res.json(payload);
});

app.get('/api/config/countdown-settings', async (_req, res) => {
    const fallback = { eventDate: '19/09/2026', eventTime: '00:00', eventDescription: 'VNA Event' };
    const parsed = await readJsonWithFallback(COUNTDOWN_SETTINGS_FILE, fallback);
    const payload = {
        eventDate: toSafeDisplayText(parsed?.eventDate, 20, fallback.eventDate),
        eventTime: toSafeDisplayText(parsed?.eventTime, 8, fallback.eventTime),
        eventDescription: toSafeDisplayText(parsed?.eventDescription, 120, fallback.eventDescription)
    };
    return res.json(payload);
});

// API endpoint để lấy trạng thái PikaMC dựa trên cấu hình .env
app.get('/api/pikamc/status', async (req, res) => {
    // Tránh trùng tên biến PORT của web server, dùng PIKAMC_IP và PIKAMC_PORT
    const ip = process.env.PIKAMC_IP || 'vna.vanhmcpe.top';
    const port = process.env.PIKAMC_PORT || '25003';
    const apiKey = process.env.PIKAMC_API_KEY || '';

    let ramUsageStr = '0 MB';
    const ramTotalStr = '4096 MB';

    try {
        if (apiKey) {
            const { getServerResources } = await import('./src/services/pikamcService.js');
            const { data } = await getServerResources();
            if (data && data.attributes && data.attributes.resources) {
                const memBytes = data.attributes.resources.memory_bytes || 0;
                // Convert to MB
                const memMB = Math.round(memBytes / (1024 * 1024));
                ramUsageStr = `${memMB} MB`;
            } else {
                throw new Error('Invalid Pterodactyl data');
            }
        } else {
            throw new Error('No API key');
        }
    } catch (e) {
        // Fallback to mock RAM nếu chưa cấu hình đúng hoặc panel lỗi
        const mockRamBase = apiKey ? 3100 : 2600;
        const randomFluctuation = Math.round(Math.random() * 500 - 200);
        ramUsageStr = `${mockRamBase + randomFluctuation} MB`;
    }

    res.json({
        success: true,
        ip,
        port,
        ram: {
            usage: ramUsageStr,
            total: ramTotalStr
        }
    });
});

// PikaMC server resources route
app.get('/api/pikamc/server-resources', async (req, res) => {
    try {
        const { getServerResources } = await import('./src/services/pikamcService.js');
        const { data, cached } = await getServerResources();
        res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
        res.json(data);
    } catch (err) {
        console.error('Error fetching PikaMC resources:', err);
        res.status(500).json({ error: 'fetch_error', detail: err.message });
    }
});

app.get('/api/pterodactyl/server2/resources', async (_req, res) => {
    try {
        const { getSecondaryServerResources } = await import('./src/services/secondaryPterodactylService.js');
        const { data, cached, configured } = await getSecondaryServerResources();
        res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
        if (!configured) {
            return res.status(503).json(data);
        }
        return res.json(data);
    } catch (err) {
        // Preserve the original status code if available (e.g., 504 for connection timeout)
        const statusCode = err.status || 500;
        console.error(`[SecondaryPterodactyl] Route error (status ${statusCode}):`, err.message);
        return res.status(statusCode).json({ 
            error: 'fetch_error', 
            detail: err.message,
            configured: true 
        });
    }
});

// Players list route
app.get('/api/players', async (req, res) => {
    try {
        const { getPlayerStats } = await import('./src/services/playerService.js');
        const stats = await getPlayerStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching players:', error);
        res.status(500).json({ error: 'fetch_error', detail: error.message });
    }
});

function getDiskUsageCandidates() {
    return [
        process.env.DISK_USAGE_PATH?.trim(),
        path.parse(ROOT_DIR || process.cwd()).root,
        path.parse(process.cwd()).root,
        'C:\\'
    ].filter(Boolean);
}

async function getDiskUsageForAvailablePath() {
    let lastError = null;

    for (const targetPath of [...new Set(getDiskUsageCandidates())]) {
        try {
            const stats = await statfs(targetPath);
            return { targetPath, stats };
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
            lastError = error;
        }
    }

    throw lastError ?? new Error('No accessible disk path found for disk usage');
}

// Disk usage route
app.get('/api/disk-usage', async (req, res) => {
    try {
        const { targetPath, stats } = await getDiskUsageForAvailablePath();
        const total = stats.blocks * stats.bsize;
        const free = stats.bfree * stats.bsize;
        const used = total - free;
        
        res.json({
            success: true,
            path: targetPath,
            used: used,
            total: total,
            free: free
        });
    } catch (error) {
        console.error('Error getting disk usage:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use('/api/facebook', snapsaveRoute);
app.use('/api/status', statusRoute);
app.use('/api/auth', authRoutes);
app.get('/api/status/network-history', (_req, res) => {
    res.json(getNetworkHistory());
});
app.use('/', binhchonRoute);
app.use('/api/album', albumRoutes);

app.get('/api/streaks/reminder-status', async (_req, res) => {
    try {
        const now = new Date();
        const todayStr = getLocalDateString(now);
        const reminderState = await loadReminderState();
        const sentToday = reminderState.lastSentDate === todayStr;
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
            success: true,
            today: todayStr,
            sentToday,
            ...reminderState
        });
    } catch (error) {
        console.error('[Streak Reminder] Load status error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải trạng thái nhắc streak.' });
    }
});

app.use('/api/streaks', streakRoutes);
app.use('/api/cloud', cloudRoutes);
app.use('/api/forum', forumRoutes);

// Download API routes - legacy routes for backward compatibility
app.post('/api/proxy-download', proxyDownloadUnified);
app.post('/api/youtube-proxy', handleYoutubeDownload);
app.get('/api/youtube-info', getYoutubeInfo);
app.get('/api/soundcloud-info', getSoundCloudInfo);
app.post('/api/soundcloud-proxy', handleSoundCloudDownload);

// New unified downloader API routes
app.use('/api/download', downloaderRoutes);

// Server-Side Rendering routes (secure HTML rendering)
app.use('/', ssrRoutes);

// Discord Bot routes

app.get('/api/bot2/status', (req, res) => {
    res.json({ ready: isBotReady() });
});

app.post('/api/discord/embed', requireEmbedAuthorization, async (req, res) => {
    try {
        const result = await sendEmbed(req.body);
        if (result.success) {
            res.json({ success: true, message: 'Embed sent successfully' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error sending embed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/minecraft-downloads', async (_req, res) => {
    try {
        const items = await readMinecraftDownloads();
        return res.json({ success: true, items });
    } catch (error) {
        console.error('Load minecraft downloads error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách.' });
    }
});

app.get('/api/admin/minecraft-downloads', requireAdminPageAccess, async (_req, res) => {
    try {
        const items = await readMinecraftDownloads();
        return res.json({ success: true, items });
    } catch (error) {
        console.error('Load admin minecraft downloads error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách.' });
    }
});

app.get('/api/admin/minecraft-files', requireAdminPageAccess, async (_req, res) => {
    try {
        const items = await listMinecraftFiles();
        return res.json({ success: true, items });
    } catch (error) {
        console.error('Load minecraft files error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách file.' });
    }
});

app.post('/api/admin/minecraft-downloads', requireAdminPageAccess, async (req, res) => {
    try {
        const title = sanitizeAdminText(req.body?.title, 120);
        const version = sanitizeAdminText(req.body?.version, 140);
        const url = sanitizeAdminText(req.body?.url, 500);

        if (!title || !url) {
            return res.status(400).json({ success: false, error: 'Thiếu tiêu đề hoặc link tải.' });
        }

        const urlOk = /^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url);
        if (!urlOk) {
            return res.status(400).json({ success: false, error: 'Link tải không hợp lệ.' });
        }

        const items = await readMinecraftDownloads();
        if (items.some((item) => item?.url === url)) {
            return res.status(409).json({ success: false, error: 'Link này đã tồn tại.' });
        }

        const newItem = {
            id: createDownloadId(),
            title,
            version,
            url,
            createdAt: new Date().toISOString()
        };

        const nextItems = [newItem, ...items];
        await writeMinecraftDownloads(nextItems);

        return res.json({ success: true, item: newItem });
    } catch (error) {
        console.error('Add minecraft download error:', error);
        return res.status(500).json({ success: false, error: 'Không thể thêm nút tải.' });
    }
});

app.delete('/api/admin/minecraft-downloads/:id', requireAdminPageAccess, async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, error: 'Thiếu id cần xóa.' });
        }

        const items = await readMinecraftDownloads();
        const nextItems = items.filter((item) => item?.id !== id);
        if (nextItems.length === items.length) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
        }

        await writeMinecraftDownloads(nextItems);
        return res.json({ success: true });
    } catch (error) {
        console.error('Delete minecraft download error:', error);
        return res.status(500).json({ success: false, error: 'Không thể xóa nút tải.' });
    }
});

app.get('/api/admin/pikamc-config', requireAdminPageAccess, async (_req, res) => {
    try {
        const config = await getPikamcConfig();
        return res.json({ success: true, data: toPublicConfig(config) });
    } catch (error) {
        console.error('Load PikaMC config error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải cấu hình PikaMC.' });
    }
});

app.post('/api/admin/pikamc-config', requireAdminPageAccess, async (req, res) => {
    try {
        const current = await getPikamcConfig();
        const overrides = {
            panelUrl: sanitizePanelUrl(req.body?.panelUrl),
            serverId: sanitizeServerId(req.body?.serverId),
            apiKey: sanitizeAdminText(req.body?.apiKey, 200),
            whitelistCommandTemplate: sanitizeCommandTemplate(req.body?.whitelistCommandTemplate),
            whitelistRemoveCommandTemplate: sanitizeCommandTemplate(req.body?.whitelistRemoveCommandTemplate)
        };

        const next = applyConfigOverrides(current, overrides);
        if (!next.panelUrl) {
            return res.status(400).json({ success: false, error: 'Link panel không hợp lệ.' });
        }
        if (!next.serverId) {
            return res.status(400).json({ success: false, error: 'Server ID không hợp lệ.' });
        }
        if (!next.apiKey) {
            return res.status(400).json({ success: false, error: 'API key không được để trống.' });
        }

        const saved = await savePikamcConfig({
            ...next,
            whitelistCommandTemplate: next.whitelistCommandTemplate || WHITELIST_COMMAND_TEMPLATE,
            whitelistRemoveCommandTemplate: next.whitelistRemoveCommandTemplate || WHITELIST_REMOVE_COMMAND_TEMPLATE
        });

        return res.json({ success: true, data: toPublicConfig(saved) });
    } catch (error) {
        console.error('Save PikaMC config error:', error);
        return res.status(500).json({ success: false, error: 'Không thể lưu cấu hình PikaMC.' });
    }
});

app.get('/api/admin/whitelist-keys', requireAdminPageAccess, (req, res) => {
    try {
        const items = whitelistStatements.list.all();
        return res.json({ success: true, items });
    } catch (error) {
        console.error('Load whitelist keys error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách whitelist.' });
    }
});

app.post('/api/admin/whitelist-keys', requireAdminPageAccess, (req, res) => {
    try {
        const key = sanitizeWhitelistKey(req.body?.key, 64);
        const gamertag = sanitizeGamertag(req.body?.gamertag, 32);

        if (!key) {
            return res.status(400).json({ success: false, error: 'Mã không hợp lệ. Chỉ cho phép chữ/số/dấu _ - (4-64 ký tự).' });
        }
        if (!gamertag) {
            return res.status(400).json({ success: false, error: 'Gamertag không hợp lệ.' });
        }

        const existing = whitelistStatements.byKey.get(key);
        if (existing) {
            return res.status(409).json({ success: false, error: 'Mã này đã tồn tại.' });
        }

        const createdAt = new Date().toISOString();
        const gamertagNorm = normalizeGamertag(gamertag);
        const result = whitelistStatements.insert.run(key, gamertag, gamertagNorm, 'pending', createdAt);

        return res.json({
            success: true,
            item: {
                id: result.lastInsertRowid,
                key,
                gamertag,
                status: 'pending',
                created_at: createdAt,
                used_at: null
            }
        });
    } catch (error) {
        console.error('Add whitelist key error:', error);
        return res.status(500).json({ success: false, error: 'Không thể thêm whitelist.' });
    }
});

app.delete('/api/admin/whitelist-keys/:id', requireAdminPageAccess, async (req, res) => {
    try {
        const id = Number.parseInt(String(req.params.id || ''), 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, error: 'Id không hợp lệ.' });
        }

        const record = whitelistStatements.byId.get(id);
        if (!record) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
        }
        if (record.status === 'processing') {
            return res.status(409).json({ success: false, error: 'Mã này đang được kích hoạt. Vui lòng thử lại sau vài giây.' });
        }

        let removedFromServer = false;
        if (record.status === 'used') {
            const pikamcConfig = await getPikamcConfig();
            const command = buildWhitelistRemoveCommand(
                record.gamertag,
                pikamcConfig?.whitelistRemoveCommandTemplate,
                pikamcConfig?.whitelistCommandTemplate
            );
            if (!command) {
                return res.status(500).json({ success: false, error: 'Không thể tạo lệnh xóa whitelist trên server.' });
            }

            const consoleResult = await sendConsoleCommand(command);
            if (!consoleResult.success) {
                return res.status(502).json({
                    success: false,
                    error: 'Không thể gửi lệnh xóa whitelist lên panel. Chưa xóa dữ liệu local để tránh lệch trạng thái.'
                });
            }

            removedFromServer = true;
        }

        const result = whitelistStatements.deleteById.run(id);
        if (result.changes === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
        }

        return res.json({
            success: true,
            removedFromServer
        });
    } catch (error) {
        console.error('Delete whitelist key error:', error);
        return res.status(500).json({ success: false, error: 'Không thể xóa whitelist.' });
    }
});

app.post('/api/whitelist/activate', async (req, res) => {
    let claimedRecordId = null;
    let commandAccepted = false;
    let activationFinished = false;

    try {
        const key = sanitizeWhitelistKey(req.body?.key, 64);
        const gamertag = sanitizeGamertag(req.body?.gamertag, 32);

        if (!key || !gamertag) {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ mã và gamertag hợp lệ.' });
        }

        const record = whitelistStatements.byKey.get(key);
        if (!record) {
            return res.status(404).json({ success: false, error: 'Mã không tồn tại.' });
        }

        if (record.status !== 'pending') {
            const statusMessage = record.status === 'processing'
                ? 'Mã này đang được kích hoạt. Vui lòng đợi vài giây rồi thử lại.'
                : 'Mã này đã được kích hoạt.';
            return res.status(409).json({ success: false, error: statusMessage });
        }

        const inputNorm = normalizeGamertag(gamertag);
        const recordNorm = normalizeGamertag(record.gamertag_norm || record.gamertag);
        if (inputNorm !== recordNorm) {
            return res.status(403).json({ success: false, error: 'Gamertag không khớp với mã.' });
        }

        const claim = whitelistStatements.claimProcessing.run('processing', record.id, 'pending');
        if (claim.changes === 0) {
            const latestRecord = whitelistStatements.byId.get(record.id);
            if (latestRecord?.status === 'used') {
                return res.status(409).json({ success: false, error: 'Mã này đã được kích hoạt.' });
            }
            return res.status(409).json({ success: false, error: 'Mã này đang được kích hoạt. Vui lòng đợi vài giây rồi thử lại.' });
        }
        claimedRecordId = record.id;

        const pikamcConfig = await getPikamcConfig();
        const command = buildWhitelistCommand(record.gamertag, pikamcConfig?.whitelistCommandTemplate);
        if (!command) {
            return res.status(500).json({ success: false, error: 'Lỗi tạo lệnh whitelist.' });
        }

        const result = await sendConsoleCommand(command);
        if (!result.success) {
            return res.status(502).json({ success: false, error: 'Không thể gửi lệnh whitelist. Vui lòng thử lại sau.' });
        }
        commandAccepted = true;

        const usedAt = new Date().toISOString();
        const update = whitelistStatements.markUsed.run('used', usedAt, record.id, 'processing');
        if (update.changes === 0) {
            return res.status(500).json({
                success: false,
                error: 'Đã gửi lệnh whitelist nhưng không thể cập nhật trạng thái mã. Vui lòng báo admin kiểm tra.'
            });
        }

        activationFinished = true;
        return res.json({ success: true, message: 'Đã whitelist thành công!', gamertag: record.gamertag });
    } catch (error) {
        console.error('Whitelist activate error:', error);
        return res.status(500).json({ success: false, error: 'Không thể kích hoạt whitelist.' });
    } finally {
        if (claimedRecordId && !activationFinished && !commandAccepted) {
            try {
                whitelistStatements.revertProcessing.run('pending', claimedRecordId, 'processing');
            } catch (rollbackError) {
                console.error('Whitelist rollback error:', rollbackError);
            }
        }
    }
});

app.get('/api/leaderboard/tool-usage', async (_req, res) => {
    try {
        const summary = await getToolUsageSummary();
        return res.json({ success: true, data: summary });
    } catch (error) {
        console.error('Error loading tool usage leaderboard:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải dữ liệu leaderboard.' });
    }
});

// Recent users route (includes guests as "User" when not logged in).
app.get('/api/recent-users', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? RECENT_USERS_DEFAULT_LIMIT), 10);
        const limit = Number.isFinite(rawLimit)
            ? Math.min(Math.max(rawLimit, 1), 20)
            : RECENT_USERS_DEFAULT_LIMIT;

        const users = await touchAndListRecentUsers(req, limit);
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ success: true, users });
    } catch (error) {
        console.error('Error handling recent users:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách người dùng gần đây.' });
    }
});

// Cloud page route (must stay before static middleware).
app.get(['/cloud', '/cloud/'], (req, res) => res.sendFile(path.join(__dirname, 'p/cloud.html')));

// Block direct static access to private cloud storage.
app.use('/cloud', (req, res, next) => {
    if (req.path === '/' || req.path === '') {
        return next();
    }
    return res.status(403).json({ success: false, error: 'Forbidden' });
});
app.use('/temp/cloud', (_req, res) => {
    return res.status(403).json({ success: false, error: 'Forbidden' });
});

// Donations API
app.get('/api/donations', async (_req, res) => {
    try {
        const data = await getDonations(50);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('Error fetching donations:', error);
        res.status(500).json({ success: false, error: 'Không thể tải danh sách donate.' });
    }
});

app.get('/api/furina/quotes', async (_req, res) => {

    try {
        const raw = await readFile(FURINA_QUOTES_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        const quotes = Array.isArray(parsed?.quotes)
            ? parsed.quotes
                .filter((quote) => typeof quote === 'string')
                .map((quote) => quote.trim())
                .filter(Boolean)
            : [];

        if (quotes.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy câu nói Furina.' });
        }

        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.json({ success: true, quotes });
    } catch (error) {
        console.error('Error loading Furina quotes:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải câu nói Furina.' });
    }
});

// Protected admin pages
app.get('/admin/e.html', requireAdminPageAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/e.html'));
});
app.get('/admin/p.html', requireAdminPageAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/p.html'));
});
app.get('/admin/whitelist.html', requireAdminPageAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/whitelist.html'));
});
app.get('/admin/notifications.html', requireAdminPageAccess, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/notifications.html'));
});

// Static files

app.use('/album', express.static(path.join(__dirname, 'album')));
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, 'html/sw.js')));
app.use('/html', express.static(path.join(__dirname, 'html'), STATIC_PUBLIC_OPTIONS));
app.use('/photos', express.static(path.join(__dirname, 'photos'), STATIC_PUBLIC_OPTIONS));
app.use('/p', express.static(path.join(__dirname, 'p'), STATIC_PUBLIC_OPTIONS));
app.use('/A11', express.static(path.join(__dirname, 'A11'), STATIC_PUBLIC_OPTIONS));
app.use('/tools', express.static(path.join(__dirname, 'tools'), STATIC_PUBLIC_OPTIONS));
app.use('/admin', requireAdminPageAccess, express.static(path.join(__dirname, 'admin'), STATIC_PUBLIC_OPTIONS));
app.use('/minecraft', express.static(path.join(__dirname, 'Minecraft'), STATIC_PUBLIC_OPTIONS));
app.use('/Minecraft', express.static(path.join(__dirname, 'Minecraft'), STATIC_PUBLIC_OPTIONS));

// HTML pages
app.get('/leaderboard', (req, res) => res.sendFile(path.join(__dirname, 'html/leaderboard.html')));
app.get('/youtube', (req, res) => res.sendFile(path.join(__dirname, 'html/youtube.html')));
app.get('/tiktok', (req, res) => res.sendFile(path.join(__dirname, 'html/tiktok.html')));
app.get('/x', (req, res) => res.sendFile(path.join(__dirname, 'html/x.html')));
app.get('/twitter', (req, res) => res.sendFile(path.join(__dirname, 'html/x.html')));
app.get('/soundcloud', (req, res) => res.sendFile(path.join(__dirname, 'html/soundcloud.html')));
app.get('/streak', (req, res) => res.sendFile(path.join(__dirname, 'A11/streak.html')));
app.get('/whitelist', (req, res) => res.sendFile(path.join(__dirname, 'html/whitelist.html')));

app.get('/embed-admin', requireAdminPageAccess, (req, res) => res.sendFile(path.join(__dirname, 'admin/e.html')));
app.get('/admin06082008', requireAdminPageAccess, (req, res) => res.sendFile(path.join(__dirname, 'admin/e.html')));
app.get('/rawphoto', (req, res) => res.sendFile(path.join(__dirname, 'p/rawphoto.html')));
app.get('/forum', (req, res) => res.sendFile(path.join(__dirname, 'p/forum.html')));

app.get('/', (req, res) => {
    res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'html/index.html'));
});

// Preload raw image with aggressive caching - 1 year cache
app.get('/photos/raw/anh-nhom/raw-2026.png', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
    res.sendFile(path.join(__dirname, 'photos/raw/anh-nhom/raw-2026.png'));
});

// Socket.IO connection handling

io.on('connection', async (socket) => {
    // Send chat history to new client
    const { getRecentMessages } = await import('./src/services/chatService.js');
    socket.emit('chat-history', getRecentMessages(50));
    
    // Handle web to game messages
    socket.on('send-to-game', async (data) => {
        const sessionUser = socket.request?.session?.user;
        if (!sessionUser?.id || !sessionUser?.username) {
            socket.emit('chat-error', { message: 'Bạn cần đăng nhập để gửi tin nhắn.' });
            return;
        }

        const safeUser = toSafeDisplayText(sessionUser.username, 50, 'User');
        const safeContent = toSafeDisplayText(data?.content, 400, '');
        if (!safeContent) {
            return;
        }

        // Block XRay messages
        if (shouldBlockMessage(safeContent)) {
            console.log(`🚫 Blocked XRay message: ${safeContent.substring(0, 60)}...`);
            return;
        }

        // Send to game
        const command = `say (Web) ${safeUser}: ${safeContent}`;
        await sendConsoleCommand(command);
        
        // Save to history
        await addChatMessage(safeUser, safeContent, 'web');
        
        // Broadcast to all clients
        io.emit('mc-chat', { user: safeUser, text: safeContent });
        console.log(`🌍 Web User ${safeUser}: ${safeContent}`);
    });
    
    // Handle game to web messages
    socket.on('mc-chat-from-bot', async (data) => {
        const safeUser = toSafeDisplayText(data?.user, 80, 'Hệ thống');
        const safeText = toSafeDisplayText(data?.text, 500, '');
        if (!safeText) return;

        if (shouldBlockMessage(safeText)) {
            console.log(`🚫 Blocked XRay message: ${safeText.substring(0, 60)}...`);
            return;
        }
        await addChatMessage(safeUser, safeText, 'game');
        io.emit('mc-chat', { user: safeUser, text: safeText });
    });
});

async function bootstrap() {
    console.log(`🚀 Process ${process.pid} is running`);

    await loadChatHistory();

    if (BOT2_TOKEN && !BOT2_TOKEN.includes('PASTE_YOUR_BOT_TOKEN_HERE')) {
        startBot2();
    } else {
        console.warn('BOT2_TOKEN not set; Bot 2 will not start.');
    }

    startStreakReminderScheduler();

    try {
        const xoavideoPath = path.join(__dirname, 'src/modules/xoavideo.js');
        const startCleanup = () => {
            const proc = fork(xoavideoPath, [], { stdio: 'inherit' });
            console.log(`✅ Started cleanup worker pid=${proc.pid}`);
            proc.on('exit', (code, signal) => {
                console.warn(`Cleanup worker exited (code=${code}, signal=${signal}). Restarting...`);
                setTimeout(startCleanup, 1000);
            });
        };
        startCleanup();
    } catch (err) {
        console.error('Failed to start cleanup worker:', err);
    }

    server.listen(PORT, '0.0.0.0', () => {
        const addr = server.address();
        console.log(`
===============================================
🚀 Server MC NOTE đã sẵn sàng!
🌐 Domain: https://vanhmcpe.top
📡 Cổng: ${addr.port}
🔄 Mode: single-process
===============================================
`);
    });
}

process.on('uncaughtException', (err) => {
    console.error(`❌ Uncaught Exception in process ${process.pid}:`, err);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(`❌ Unhandled Rejection in process ${process.pid}:`, reason);
    process.exit(1);
});

bootstrap().catch((error) => {
    console.error('❌ Failed to bootstrap server:', error);
    process.exit(1);
});
