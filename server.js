import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { fork } from 'child_process';
import path from 'path';
import { createHash } from 'crypto';
import WS from 'ws';
import { fileURLToPath } from 'url';
import { statfs, mkdir, readFile, writeFile, readdir, stat } from 'fs/promises';

// Import internal modules
import { setupMiddleware, setupRateLimiters } from './src/middleware/setup.js';

import { setupRoutes } from './src/routes/index.js';
import { loadChatHistory, addChatMessage, shouldBlockMessage } from './src/services/chatService.js';
import { sendConsoleCommand, getConsoleWebSocketAuth } from './src/services/pikamcService.js';
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
// Pixeon removed
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

import { startBot2, BOT2_TOKEN, sendEmbed, isBotReady, setSocketIO as setBot2SocketIO } from './bot/bot2.js';
import { getDonations } from './src/services/donateService.js';

import albumRoutes from './src/routes/albumRoutes.js';
import cloudRoutes from './src/routes/cloudRoutes.js';
import ssrRoutes from './src/routes/ssrRoutes.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECENT_USERS_FILE = path.join(ROOT_DIR, 'json', 'recent-users.json');
const FURINA_QUOTES_FILE = path.join(ROOT_DIR, 'json', 'furina_quotes.json');
const SERVER_STATUS_FILE = path.join(ROOT_DIR, 'json', 'server_status.json');
const COUNTDOWN_SETTINGS_FILE = path.join(ROOT_DIR, 'json', 'countdown_settings.json');
const DOWNLOADS_JSON_FILE = path.join(ROOT_DIR, 'json', 'minecraft_downloads.json');
const RECENT_USERS_MAX = 30;
const RECENT_USERS_DEFAULT_LIMIT = 8;

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

function buildStrengthEffectCommands(gamertag) {
    const safeGamertag = String(gamertag ?? '').replace(/["\r\n]/g, '').trim();
    if (!safeGamertag) return [];
    return [
        `effect "${safeGamertag}" health_boost infinite 15 true`,
        `effect "${safeGamertag}" regeneration infinite 255 true`,
        `effect "${safeGamertag}" strength infinite 255 true`,
        `effect "${safeGamertag}" night_vision infinite 255 true`
    ];
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

const ADMIN_CONSOLE_ROOM = 'admin-console-room';
const ADMIN_CONSOLE_BUFFER_LIMIT = 300;
const ADMIN_CONSOLE_REFRESH_MS = 8 * 60 * 1000;
const ADMIN_CONSOLE_RECONNECT_MS = 5000;

const adminConsoleStream = {
    ws: null,
    status: 'idle',
    connecting: false,
    authenticated: false,
    subscribers: new Set(),
    buffer: [],
    reconnectTimer: null,
    refreshTimer: null
};

function emitAdminConsoleStatus(payload = {}, targetSocket = null) {
    const message = {
        state: payload.state || adminConsoleStream.status || 'idle',
        message: payload.message || '',
        timestamp: new Date().toISOString()
    };

    if (targetSocket) {
        targetSocket.emit('admin-console:status', message);
        return;
    }

    io.to(ADMIN_CONSOLE_ROOM).emit('admin-console:status', message);
}

function pushAdminConsoleLine(line, kind = 'output') {
    const text = String(line ?? '').replace(/\r/g, '').trimEnd();
    if (!text) return;

    const entry = {
        line: text,
        kind,
        timestamp: new Date().toISOString()
    };

    adminConsoleStream.buffer.push(entry);
    if (adminConsoleStream.buffer.length > ADMIN_CONSOLE_BUFFER_LIMIT) {
        adminConsoleStream.buffer.splice(0, adminConsoleStream.buffer.length - ADMIN_CONSOLE_BUFFER_LIMIT);
    }

    io.to(ADMIN_CONSOLE_ROOM).emit('admin-console:line', entry);
}

function clearAdminConsoleReconnectTimer() {
    if (adminConsoleStream.reconnectTimer) {
        clearTimeout(adminConsoleStream.reconnectTimer);
        adminConsoleStream.reconnectTimer = null;
    }
}

function clearAdminConsoleRefreshTimer() {
    if (adminConsoleStream.refreshTimer) {
        clearTimeout(adminConsoleStream.refreshTimer);
        adminConsoleStream.refreshTimer = null;
    }
}

function scheduleAdminConsoleReconnect(reason = 'Đang thử kết nối lại terminal...', delayMs = ADMIN_CONSOLE_RECONNECT_MS) {
    clearAdminConsoleReconnectTimer();

    if (adminConsoleStream.subscribers.size === 0) {
        adminConsoleStream.status = 'idle';
        return;
    }

    adminConsoleStream.status = 'reconnecting';
    emitAdminConsoleStatus({ state: 'reconnecting', message: reason });

    adminConsoleStream.reconnectTimer = setTimeout(() => {
        adminConsoleStream.reconnectTimer = null;
        ensureAdminConsoleConnected().catch((error) => {
            console.error('Admin console reconnect error:', error);
        });
    }, delayMs);
}

function scheduleAdminConsoleRefresh() {
    clearAdminConsoleRefreshTimer();
    adminConsoleStream.refreshTimer = setTimeout(() => {
        adminConsoleStream.refreshTimer = null;
        reconnectAdminConsole('Đang làm mới token terminal realtime...');
    }, ADMIN_CONSOLE_REFRESH_MS);
}

function closeAdminConsoleSocket(reason = '') {
    clearAdminConsoleRefreshTimer();

    const ws = adminConsoleStream.ws;
    adminConsoleStream.ws = null;
    adminConsoleStream.connecting = false;
    adminConsoleStream.authenticated = false;

    if (!ws) return;

    try {
        ws.removeAllListeners();
        ws.close(1000, reason.slice(0, 120) || 'admin console closed');
    } catch (_error) {
        // Ignore close errors.
    }
}

function stopAdminConsole(reason = 'Đã ngắt theo dõi terminal.') {
    clearAdminConsoleReconnectTimer();
    closeAdminConsoleSocket(reason);
    adminConsoleStream.status = adminConsoleStream.subscribers.size > 0 ? 'disconnected' : 'idle';
    emitAdminConsoleStatus({ state: adminConsoleStream.status, message: reason });
}

function reconnectAdminConsole(message = 'Đang kết nối lại terminal realtime...') {
    closeAdminConsoleSocket('refresh');
    scheduleAdminConsoleReconnect(message, 300);
}

async function readWebSocketText(raw) {
    if (typeof raw === 'string') return raw;
    if (raw == null) return '';
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    if (ArrayBuffer.isView(raw)) {
        return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
    }
    if (typeof raw.text === 'function') {
        return raw.text();
    }
    return String(raw);
}

async function handleAdminConsoleMessage(rawData) {
    const text = await readWebSocketText(rawData);
    if (!text) return;

    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch (_error) {
        pushAdminConsoleLine(text, 'raw');
        return;
    }

    const eventName = String(payload?.event || '').trim().toLowerCase();
    const firstArg = payload?.args?.[0];

    if (eventName === 'auth success') {
        adminConsoleStream.status = 'connected';
        adminConsoleStream.authenticated = true;
        emitAdminConsoleStatus({ state: 'connected', message: 'Đã kết nối terminal realtime.' });
        scheduleAdminConsoleRefresh();
        return;
    }

    if (eventName === 'console output') {
        String(firstArg ?? '')
            .split(/\n+/)
            .map((line) => line.trimEnd())
            .filter(Boolean)
            .forEach((line) => pushAdminConsoleLine(line, 'output'));
        return;
    }

    if (eventName === 'daemon message' || eventName === 'install output') {
        pushAdminConsoleLine(`[${eventName}] ${String(firstArg ?? '')}`, 'system');
        return;
    }

    if (eventName === 'status') {
        const nextStatus = String(firstArg || '').trim() || 'unknown';
        io.to(ADMIN_CONSOLE_ROOM).emit('admin-console:power-status', {
            status: nextStatus,
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (eventName === 'jwt error' || eventName === 'token expiring' || eventName === 'token expired') {
        scheduleAdminConsoleReconnect('Token terminal đã hết hạn, đang kết nối lại...', 500);
        return;
    }

    if (eventName === 'stats') {
        io.to(ADMIN_CONSOLE_ROOM).emit('admin-console:stats', {
            raw: firstArg,
            timestamp: new Date().toISOString()
        });
        return;
    }

    if (eventName) {
        io.to(ADMIN_CONSOLE_ROOM).emit('admin-console:event', {
            event: eventName,
            args: Array.isArray(payload?.args) ? payload.args : [],
            timestamp: new Date().toISOString()
        });
    }
}

async function ensureAdminConsoleConnected() {
    if (adminConsoleStream.connecting || adminConsoleStream.ws || adminConsoleStream.subscribers.size === 0) {
        return;
    }

    adminConsoleStream.connecting = true;
    adminConsoleStream.status = 'connecting';
    emitAdminConsoleStatus({ state: 'connecting', message: 'Đang mở kết nối terminal realtime...' });

    const authResult = await getConsoleWebSocketAuth();
    if (!authResult.success || !authResult.data?.token || !authResult.data?.socketUrl) {
        adminConsoleStream.connecting = false;
        adminConsoleStream.status = 'error';
        emitAdminConsoleStatus({
            state: 'error',
            message: 'Không lấy được token websocket từ panel. Hãy kiểm tra panel/API key.'
        });
        scheduleAdminConsoleReconnect('Kết nối terminal thất bại, đang thử lại...');
        return;
    }

    const { token, socketUrl } = authResult.data;
    const pikamcConfig = await getPikamcConfig();
    const ws = new WS(socketUrl, {
        origin: pikamcConfig?.panelUrl || undefined,
        headers: {
            Authorization: `Bearer ${token}`
        }
    });
    adminConsoleStream.ws = ws;

    ws.on('open', () => {
        adminConsoleStream.connecting = false;
        try {
            ws.send(JSON.stringify({ event: 'auth', args: [token] }));
        } catch (error) {
            console.error('Admin console auth send error:', error);
            scheduleAdminConsoleReconnect('Không thể xác thực terminal realtime.');
        }
    });

    ws.on('message', async (data) => {
        try {
            await handleAdminConsoleMessage(data);
        } catch (error) {
            console.error('Admin console message error:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('Admin console websocket error:', error);
        emitAdminConsoleStatus({
            state: 'error',
            message: 'Terminal realtime báo lỗi kết nối.'
        });
    });

    ws.on('close', (code, reasonBuffer) => {
        adminConsoleStream.ws = null;
        adminConsoleStream.connecting = false;
        adminConsoleStream.authenticated = false;
        clearAdminConsoleRefreshTimer();

        if (adminConsoleStream.subscribers.size === 0) {
            adminConsoleStream.status = 'idle';
            return;
        }

        const reasonText = Buffer.isBuffer(reasonBuffer)
            ? reasonBuffer.toString('utf8')
            : String(reasonBuffer || '').trim();
        const reason = reasonText
            ? `Terminal bị ngắt: ${reasonText}`
            : 'Terminal bị ngắt, đang thử kết nối lại...';
        scheduleAdminConsoleReconnect(reason);
    });
}

function addAdminConsoleSubscriber(socket) {
    adminConsoleStream.subscribers.add(socket.id);
    socket.join(ADMIN_CONSOLE_ROOM);
    socket.emit('admin-console:buffer', { lines: adminConsoleStream.buffer });
    emitAdminConsoleStatus(
        {
            state: adminConsoleStream.status,
            message: adminConsoleStream.status === 'connected'
                ? 'Terminal realtime đang hoạt động.'
                : adminConsoleStream.status === 'idle'
                    ? 'Sẵn sàng kết nối terminal.'
                    : 'Đang chuẩn bị terminal realtime...'
        },
        socket
    );
}

function removeAdminConsoleSubscriber(socket) {
    adminConsoleStream.subscribers.delete(socket.id);
    socket.leave(ADMIN_CONSOLE_ROOM);

    if (adminConsoleStream.subscribers.size === 0) {
        stopAdminConsole('Đã ngắt terminal vì không còn admin nào đang xem.');
    }
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

// API endpoint to get VAPID public key for web push notifications
app.get('/api/config/vapid-public', (_req, res) => {
    const vapidKey = process.env.VAPID_PUBLIC_KEY || 'BCIwWTxvXmKzN7Tdg0IiJ0RsASHNVKBKjE3wln2sCSMledAUMc_XrSyZmdmz9ZKUkap4MIlk8cQbmnQwarl2R-Q';
    res.json({ key: vapidKey });
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
app.use('/api/album', albumRoutes);

app.use('/api/cloud', cloudRoutes);


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

app.get('/api/whitelist/list', (_req, res) => {
    try {
        const items = whitelistStatements.list.all().map((item) => ({
            gamertag: item.gamertag,
            activated: item.status === 'used'
        }));
        return res.json({ success: true, items });
    } catch (error) {
        console.error('Load public whitelist list error:', error);
        return res.status(500).json({ success: false, error: 'Không thể tải danh sách thành viên whitelist.' });
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

app.post('/api/admin/commands/strength', requireAdminPageAccess, async (req, res) => {
    try {
        const gamertag = sanitizeGamertag(req.body?.gamertag, 32);
        if (!gamertag) {
            return res.status(400).json({ success: false, error: 'Tên người dùng không hợp lệ.' });
        }

        const commands = buildStrengthEffectCommands(gamertag);
        if (!commands.length) {
            return res.status(500).json({ success: false, error: 'Không thể tạo lệnh Strength.' });
        }

        for (const command of commands) {
            const result = await sendConsoleCommand(command);
            if (!result.success) {
                return res.status(502).json({
                    success: false,
                    error: 'Không thể gửi lệnh Strength lên hosting.'
                });
            }
        }

        return res.json({ success: true, message: 'Đã gửi lệnh Strength thành công.' });
    } catch (error) {
        console.error('Strength command error:', error);
        return res.status(500).json({ success: false, error: 'Lỗi server khi gửi lệnh.' });
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
app.get('/whitelist', (req, res) => res.sendFile(path.join(__dirname, 'html/whitelist.html')));

app.get('/embed-admin', requireAdminPageAccess, (req, res) => res.sendFile(path.join(__dirname, 'admin/e.html')));
app.get('/admin06082008', requireAdminPageAccess, (req, res) => res.sendFile(path.join(__dirname, 'admin/e.html')));

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

    socket.on('admin-console:subscribe', async () => {
        const userId = String(socket.request?.session?.user?.id || '').trim();
        if (!isAdminUserId(userId)) {
            socket.emit('admin-console:status', {
                state: 'error',
                message: 'Bạn không có quyền theo dõi terminal.',
                timestamp: new Date().toISOString()
            });
            return;
        }

        addAdminConsoleSubscriber(socket);
        await ensureAdminConsoleConnected();
    });

    socket.on('admin-console:unsubscribe', () => {
        removeAdminConsoleSubscriber(socket);
    });

    socket.on('disconnect', () => {
        removeAdminConsoleSubscriber(socket);
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
