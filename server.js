import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import { fork } from 'child_process';
import path from 'path';
import { createHash } from 'crypto';
import WS from 'ws';
import { fileURLToPath } from 'url';
import { mkdir, readFile, writeFile, readdir, stat } from 'fs/promises';

// Import internal modules
import { setupMiddleware, setupRateLimiters } from './src/middleware/setup.js';
import { errorHandler, notFoundHandler, requestIdMiddleware } from './src/middleware/errorHandler.js';

import { setupRoutes } from './src/routes/index.js';
import { registerAppApiRoutes } from './src/routes/appApiRoutes.js';
import { registerAppPageRoutes } from './src/routes/appPageRoutes.js';
import { loadChatHistory, addChatMessage, shouldBlockMessage } from './src/services/chatService.js';
import { sendConsoleCommand, getConsoleWebSocketAuth } from './src/services/pikamcService.js';
import { getPikamcConfig } from './src/services/pikamcConfigService.js';
import {
    PORT,
    ROOT_DIR,
    WHITELIST_COMMAND_TEMPLATE,
    WHITELIST_REMOVE_COMMAND_TEMPLATE
} from './src/config/index.js';
import db from './src/modules/database.js';

// Internal secret for bot-to-server Socket.IO authentication
const BOT_INTERNAL_SECRET = process.env.BOT_INTERNAL_SECRET || '';

// Import existing modules
import { setSocketIO } from './src/modules/status/status.js';
// Pixeon removed
import {
    incrementToolUsage,
    resolveToolFromPlatform
} from './src/services/toolUsageService.js';

import { startBot2, BOT2_TOKEN, setSocketIO as setBot2SocketIO } from './bot/bot2.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECENT_USERS_FILE = path.join(ROOT_DIR, 'json', 'recent-users.json');
const FURINA_QUOTES_FILE = path.join(ROOT_DIR, 'json', 'furina_quotes.json');
const SERVER_STATUS_FILE = path.join(ROOT_DIR, 'json', 'server_status.json');
const COUNTDOWN_SETTINGS_FILE = path.join(ROOT_DIR, 'json', 'countdown_settings.json');
const DOWNLOADS_JSON_FILE = path.join(ROOT_DIR, 'json', 'minecraft_downloads.json');
const DEFAULT_VAPID_PUBLIC_KEY = 'BCIwWTxvXmKzN7Tdg0IiJ0RsASHNVKBKjE3wln2sCSMledAUMc_XrSyZmdmz9ZKUkap4MIlk8cQbmnQwarl2R-Q';
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

async function writeJson(filePath, data) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
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
app.use(requestIdMiddleware);
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
registerAppApiRoutes(app, {
    isAdminUserId,
    requireEmbedAuthorization,
    requireAdminPageAccess,
    toSafeDisplayText,
    readJsonWithFallback,
    writeJson,
    serverStatusFile: SERVER_STATUS_FILE,
    countdownSettingsFile: COUNTDOWN_SETTINGS_FILE,
    defaultVapidPublicKey: DEFAULT_VAPID_PUBLIC_KEY,
    readMinecraftDownloads,
    writeMinecraftDownloads,
    listMinecraftFiles,
    createDownloadId,
    sanitizeAdminText,
    sanitizePanelUrl,
    sanitizeServerId,
    sanitizeCommandTemplate,
    sanitizeWhitelistKey,
    sanitizeGamertag,
    normalizeGamertag,
    buildWhitelistCommand,
    buildWhitelistRemoveCommand,
    buildStrengthEffectCommands,
    whitelistStatements,
    touchAndListRecentUsers,
    recentUsersDefaultLimit: RECENT_USERS_DEFAULT_LIMIT,
    furinaQuotesFile: FURINA_QUOTES_FILE
});

registerAppPageRoutes(app, {
    __dirname,
    staticPublicOptions: STATIC_PUBLIC_OPTIONS,
    requireAdminPageAccess
});

// Socket.IO connection handling

io.on('connection', async (socket) => {
    // Send chat history to new client
    const { getRecentMessages } = await import('./src/services/chatService.js');
    socket.emit('chat-history', getRecentMessages(50));
    
    // Handle web to game messages
    socket.on('send-to-game', async (data) => {
        try {
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

            if (shouldBlockMessage(safeContent)) {
                console.log(`🚫 Blocked XRay message: ${safeContent.substring(0, 60)}...`);
                return;
            }

            const command = `say (Web) ${safeUser}: ${safeContent}`;
            const commandResult = await sendConsoleCommand(command);
            if (!commandResult?.success) {
                socket.emit('chat-error', {
                    message: 'Không thể gửi tin nhắn vào server lúc này. Vui lòng thử lại.'
                });
                return;
            }

            await addChatMessage(safeUser, safeContent, 'web');
            io.emit('mc-chat', { user: safeUser, text: safeContent });
            console.log(`🌍 Web User ${safeUser}: ${safeContent}`);
        } catch (error) {
            console.error('send-to-game socket error:', error);
            socket.emit('chat-error', { message: 'Có lỗi xảy ra khi gửi tin nhắn.' });
        }
    });
    
    // Handle game to web messages (requires internal secret)
    socket.on('mc-chat-from-bot', async (data) => {
        try {
            // Verify internal bot secret to prevent spoofing
            const incomingSecret = String(data?.secret || '').trim();
            if (!BOT_INTERNAL_SECRET || incomingSecret !== BOT_INTERNAL_SECRET) {
                console.warn('⚠️ Rejected mc-chat-from-bot: invalid or missing secret');
                return;
            }

            const safeUser = toSafeDisplayText(data?.user, 80, 'Hệ thống');
            const safeText = toSafeDisplayText(data?.text, 500, '');
            if (!safeText) return;

            if (shouldBlockMessage(safeText)) {
                console.log(`🚫 Blocked XRay message: ${safeText.substring(0, 60)}...`);
                return;
            }
            await addChatMessage(safeUser, safeText, 'game');
            io.emit('mc-chat', { user: safeUser, text: safeText });
        } catch (error) {
            console.error('mc-chat-from-bot socket error:', error);
        }
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

app.use('/api', notFoundHandler);
app.use(errorHandler);

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
