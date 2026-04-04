import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { promises as fsp } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const CLOUD_ROOT = path.join(__dirname, '../../cloud');
const CLOUD_TEMP = path.join(__dirname, '../../temp/cloud');
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 10;
const CLOUD_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_CHUNK_FILE_BYTES = 3 * 1024 * 1024 * 1024;
const MAX_CHUNK_SIZE_BYTES = 90 * 1024 * 1024;
const MIN_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
const CHUNK_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const TRASH_DIRNAME = '.trash';
const TRASH_INDEX_FILENAME = '.trash-index.json';
const EDIT_LOG_FILENAME = '.edit-log.json';
const MAX_EDITABLE_TEXT_BYTES = 2 * 1024 * 1024;
const SHARE_INDEX_FILENAME = '.share-index.json';
const CHUNK_DIRNAME = '.chunks';
const CHUNK_META_FILENAME = 'meta.json';
const CHUNK_PART_PREFIX = 'part-';
const UPLOAD_LOCK_FILENAME = '.upload.lock';
const FILE_LOCK_TIMEOUT_MS = 30000;
const FILE_LOCK_RETRY_MS = 100;
const FILE_LOCK_STALE_MS = 120000;
const SHARE_PRUNE_INTERVAL_MS = 30 * 60 * 1000;

let lastSharePruneAt = 0;

const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        if (!fs.existsSync(CLOUD_TEMP)) {
            fs.mkdirSync(CLOUD_TEMP, { recursive: true });
        }
        cb(null, CLOUD_TEMP);
    },
    filename: function (_req, file, cb) {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE }
});

const uploadChunk = multer({
    storage,
    limits: { fileSize: MAX_CHUNK_SIZE_BYTES }
});

function requireLogin(req, res, next) {
    if (!req.session?.user?.id || !req.session?.user?.username) {
        return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để dùng Cloud.' });
    }
    next();
}

function sanitizeSegment(input, fallback = 'item') {
    // Remove control characters (0-31 and 127 DEL), keep all Unicode including Vietnamese
    const filtered = Array.from(String(input || ''))
        .filter((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('');

    // Replace only reserved Windows/Unix filename characters with underscore
    // Keep Vietnamese characters and all other Unicode letters
    const value = filtered
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\.+$/g, '')
        .trim();

    return value || fallback;
}

function normalizeUploadFilename(originalname = '') {
    const raw = String(originalname || '').trim();
    if (!raw) return 'file';

    // Heuristic: many uploads with broken UTF-8 appear as mojibake markers like "Ã", "Â", "Ä", "á»", "áº".
    const mojibakePattern = /(Ã|Â|Ä|Å|Æ|Ð|Ñ|á»|áº|á¼|á¸)/;
    if (!mojibakePattern.test(raw)) {
        return raw.normalize('NFC');
    }

    try {
        const decoded = Buffer.from(raw, 'latin1').toString('utf8').normalize('NFC');
        const markerCount = (value) => (String(value).match(/(Ã|Â|Ä|Å|Æ|Ð|Ñ|á»|áº|á¼|á¸)/g) || []).length;
        const rawMarkers = markerCount(raw);
        const decodedMarkers = markerCount(decoded);
        const rawBad = (raw.match(/\uFFFD/g) || []).length;
        const decodedBad = (decoded.match(/\uFFFD/g) || []).length;

        // Prefer decoded filename when it clearly reduces mojibake noise.
        if (decoded && decodedMarkers < rawMarkers && decodedBad <= rawBad + 1) {
            return decoded;
        }
    } catch (_error) {
        // Keep raw value if conversion fails.
    }

    return raw.normalize('NFC');
}

function normalizeRelativePath(inputPath = '/') {
    const raw = String(inputPath || '/').replace(/\\/g, '/').trim();
    const clean = raw === '' ? '/' : raw;
    const parts = clean
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.trim());

    for (const segment of parts) {
        if (segment === '.' || segment === '..') {
            throw new Error('Invalid path segment.');
        }
    }

    return parts.map((segment) => sanitizeSegment(segment)).join('/');
}

function toClientPath(relativePath = '') {
    return `/${relativePath.replace(/\\/g, '/')}`.replace(/\/+/g, '/');
}

function safeResolve(baseDir, relativePath = '') {
    const targetPath = path.resolve(baseDir, relativePath);
    const safeBase = `${path.resolve(baseDir)}${path.sep}`;
    const safeTarget = `${targetPath}${path.sep}`;
    if (!safeTarget.startsWith(safeBase)) {
        throw new Error('Invalid target path.');
    }
    return targetPath;
}

function createHttpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonArrayFile(indexPath) {
    try {
        const raw = await fsp.readFile(indexPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

async function withFileLock(lockPath, work, options = {}) {
    const timeoutMs = Number(options.timeoutMs || FILE_LOCK_TIMEOUT_MS);
    const retryMs = Number(options.retryMs || FILE_LOCK_RETRY_MS);
    const staleMs = Number(options.staleMs || FILE_LOCK_STALE_MS);
    const startedAt = Date.now();

    await fsp.mkdir(path.dirname(lockPath), { recursive: true });

    let lockHandle = null;
    while (!lockHandle) {
        try {
            lockHandle = await fsp.open(lockPath, 'wx');
            await lockHandle.writeFile(String(process.pid));
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const lockStat = await fsp.stat(lockPath).catch(() => null);
            if (lockStat && (Date.now() - lockStat.mtimeMs) > staleMs) {
                await fsp.rm(lockPath, { force: true }).catch(() => { });
                continue;
            }

            if ((Date.now() - startedAt) > timeoutMs) {
                const timeoutError = createHttpError(429, 'Cloud đang bận, vui lòng thử lại sau vài giây.');
                timeoutError.code = 'LOCK_TIMEOUT';
                throw timeoutError;
            }

            await sleep(retryMs);
        }
    }

    try {
        return await work();
    } finally {
        try {
            await lockHandle.close();
        } catch (_error) {
            // Ignore lock-handle cleanup errors.
        }
        await fsp.rm(lockPath, { force: true }).catch(() => { });
    }
}

async function ensureUserRoot(req) {
    const rawUserId = String(req.session?.user?.id || '').trim();
    const safeUserId = sanitizeSegment(rawUserId, '');
    if (!safeUserId) {
        throw new Error('Thiếu user id hợp lệ để khởi tạo Cloud.');
    }

    // New storage namespace: user_<id> to avoid collisions when users rename usernames.
    const userRootName = `user_${safeUserId}`;
    const userRoot = path.join(CLOUD_ROOT, userRootName);

    // Backward compatibility: migrate legacy username folder (if any) into id-based folder once.
    const legacyUsername = sanitizeSegment(req.session?.user?.username, '');
    const legacyRoot = legacyUsername ? path.join(CLOUD_ROOT, legacyUsername) : null;
    if (legacyRoot && legacyRoot !== userRoot && fs.existsSync(legacyRoot) && !fs.existsSync(userRoot)) {
        await fsp.rename(legacyRoot, userRoot);
    }

    await fsp.mkdir(userRoot, { recursive: true });
    return { userRootName, userRoot };
}

function getTrashPaths(userRoot) {
    const trashDir = safeResolve(userRoot, TRASH_DIRNAME);
    const indexPath = safeResolve(userRoot, TRASH_INDEX_FILENAME);
    return { trashDir, indexPath };
}

async function ensureTrashData(userRoot) {
    const { trashDir, indexPath } = getTrashPaths(userRoot);
    await fsp.mkdir(trashDir, { recursive: true });
    if (!fs.existsSync(indexPath)) {
        await fsp.writeFile(indexPath, '[]', 'utf8');
    }
    return { trashDir, indexPath };
}

async function ensureEditLog(userRoot) {
    const indexPath = safeResolve(userRoot, EDIT_LOG_FILENAME);
    if (!fs.existsSync(indexPath)) {
        await fsp.writeFile(indexPath, '[]', 'utf8');
    }
    return { indexPath };
}

async function ensureShareIndex() {
    const indexPath = path.join(CLOUD_ROOT, SHARE_INDEX_FILENAME);
    if (!fs.existsSync(indexPath)) {
        await fsp.mkdir(CLOUD_ROOT, { recursive: true });
        await fsp.writeFile(indexPath, '[]', 'utf8');
    }
    return { indexPath };
}

function getUploadLockPath(userRoot) {
    return safeResolve(userRoot, UPLOAD_LOCK_FILENAME);
}

function parseChunkUploadId(rawUploadId) {
    const uploadId = String(rawUploadId || '').trim();
    if (!/^[A-Za-z0-9_-]{12,120}$/.test(uploadId)) {
        throw createHttpError(400, 'uploadId không hợp lệ.');
    }
    return uploadId;
}

function parseChunkIndex(rawIndex) {
    const index = Number.parseInt(String(rawIndex || ''), 10);
    if (!Number.isInteger(index) || index < 0) {
        throw createHttpError(400, 'Số thứ tự chunk không hợp lệ.');
    }
    return index;
}

function normalizeChunkSize(rawChunkSize) {
    const chunkSize = Number(rawChunkSize || DEFAULT_CHUNK_SIZE_BYTES);
    if (!Number.isFinite(chunkSize)) {
        return DEFAULT_CHUNK_SIZE_BYTES;
    }
    return Math.max(MIN_CHUNK_SIZE_BYTES, Math.min(MAX_CHUNK_SIZE_BYTES, Math.floor(chunkSize)));
}

function normalizeChunkTotalSize(rawTotalSize) {
    const totalSize = Number(rawTotalSize || 0);
    if (!Number.isFinite(totalSize) || totalSize <= 0) {
        throw createHttpError(400, 'Kích thước file không hợp lệ.');
    }
    if (totalSize > MAX_CHUNK_FILE_BYTES) {
        throw createHttpError(413, 'File quá lớn. Chunk upload hiện hỗ trợ tối đa 3GB.');
    }
    return Math.floor(totalSize);
}

function getChunkRoot(userRoot) {
    return safeResolve(userRoot, CHUNK_DIRNAME);
}

function getChunkSessionPaths(userRoot, uploadId) {
    const safeUploadId = parseChunkUploadId(uploadId);
    const chunkRoot = getChunkRoot(userRoot);
    const sessionDir = safeResolve(chunkRoot, safeUploadId);
    const metaPath = safeResolve(sessionDir, CHUNK_META_FILENAME);
    const lockPath = `${metaPath}.lock`;
    return { uploadId: safeUploadId, chunkRoot, sessionDir, metaPath, lockPath };
}

function getChunkPartFilename(index) {
    return `${CHUNK_PART_PREFIX}${String(index).padStart(6, '0')}`;
}

function getChunkPartPath(sessionDir, index) {
    return safeResolve(sessionDir, getChunkPartFilename(index));
}

async function readChunkMeta(metaPath) {
    const raw = await fsp.readFile(metaPath, 'utf8').catch(() => null);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
}

async function writeChunkMeta(metaPath, data) {
    await safeWriteJsonFile(metaPath, data);
}

async function cleanupExpiredChunkSessions(userRoot) {
    const chunkRoot = getChunkRoot(userRoot);
    await fsp.mkdir(chunkRoot, { recursive: true });
    const entries = await fsp.readdir(chunkRoot, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionDir = safeResolve(chunkRoot, entry.name);
        const metaPath = safeResolve(sessionDir, CHUNK_META_FILENAME);
        const metaStat = await fsp.stat(metaPath).catch(() => null);
        const fallbackStat = metaStat ? null : await fsp.stat(sessionDir).catch(() => null);
        const touchedAt = metaStat?.mtimeMs || fallbackStat?.mtimeMs || 0;
        if (!touchedAt) continue;
        if ((now - touchedAt) > CHUNK_SESSION_TTL_MS) {
            await fsp.rm(sessionDir, { recursive: true, force: true }).catch(() => { });
        }
    }
}

async function getReservedChunkBytes(userRoot) {
    const chunkRoot = getChunkRoot(userRoot);
    const entries = await fsp.readdir(chunkRoot, { withFileTypes: true }).catch(() => []);

    const results = await Promise.all(entries.map(async (entry) => {
        if (!entry.isDirectory()) return 0;
        const metaPath = safeResolve(chunkRoot, `${entry.name}/${CHUNK_META_FILENAME}`);
        const meta = await readChunkMeta(metaPath);
        if (!meta || meta.status === 'completed' || meta.status === 'cancelled') return 0;
        const totalSize = Number(meta.totalSize || 0);
        return (Number.isFinite(totalSize) && totalSize > 0) ? totalSize : 0;
    }));

    return results.reduce((sum, val) => sum + val, 0);
}

async function safeWriteJsonFile(filePath, data) {
    const tmpPath = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    try {
        await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        await fsp.rename(tmpPath, filePath);
    } catch (error) {
        await fsp.rm(tmpPath, { force: true }).catch(() => { });
        throw error;
    }
}

async function mutateShareIndex(mutator) {
    const { indexPath } = await ensureShareIndex();
    const lockPath = `${indexPath}.lock`;
    return withFileLock(lockPath, async () => {
        const index = await readJsonArrayFile(indexPath);
        const result = await mutator(index);
        await safeWriteJsonFile(indexPath, index);
        return result;
    });
}

async function mutateEditLog(userRoot, mutator) {
    const { indexPath } = await ensureEditLog(userRoot);
    const lockPath = `${indexPath}.lock`;
    return withFileLock(lockPath, async () => {
        const logs = await readJsonArrayFile(indexPath);
        const result = await mutator(logs);
        await safeWriteJsonFile(indexPath, logs);
        return result;
    });
}

async function mutateTrashIndex(userRoot, mutator) {
    const { indexPath } = await ensureTrashData(userRoot);
    const lockPath = `${indexPath}.lock`;
    return withFileLock(lockPath, async () => {
        const index = await readJsonArrayFile(indexPath);
        const result = await mutator(index);
        await safeWriteJsonFile(indexPath, index);
        return result;
    });
}

async function readShareIndex() {
    const { indexPath } = await ensureShareIndex();
    return readJsonArrayFile(indexPath);
}

function parseOptionalDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function isShareExpired(entry, nowMs = Date.now()) {
    const expiresAt = parseOptionalDate(entry?.expiresAt);
    if (!expiresAt) return false;
    return expiresAt.getTime() <= nowMs;
}

async function pruneShareIndex(options = {}) {
    const nowMs = Number(options.nowMs || Date.now());
    const force = Boolean(options.force);
    if (!force && (nowMs - lastSharePruneAt) < SHARE_PRUNE_INTERVAL_MS) {
        return;
    }

    try {
        await mutateShareIndex(async (index) => {
            const kept = [];

            for (const entry of index) {
                if (!entry?.token) continue;
                if (entry.revokedAt) continue;
                if (isShareExpired(entry, nowMs)) continue;

                const ownerRootName = sanitizeSegment(entry.ownerRootName, '');
                if (!ownerRootName) continue;

                let relPath = '';
                try {
                    relPath = normalizeRelativePath(entry.relativePath || '');
                } catch (_error) {
                    continue;
                }

                if (!relPath || isReservedCloudPath(relPath)) continue;

                let filePath = '';
                try {
                    const ownerRoot = path.join(CLOUD_ROOT, ownerRootName);
                    filePath = safeResolve(ownerRoot, relPath);
                } catch (_error) {
                    continue;
                }

                const stat = await fsp.stat(filePath).catch(() => null);
                if (!stat || !stat.isFile()) continue;

                kept.push(entry);
            }

            if (kept.length === index.length) {
                return;
            }
            index.length = 0;
            index.push(...kept);
        });
        lastSharePruneAt = nowMs;
    } catch (_error) {
        // Ignore prune failures to avoid blocking public access.
    }
}

async function dropShareToken(token) {
    const safeToken = String(token || '').trim();
    if (!safeToken) return;
    try {
        await mutateShareIndex(async (index) => {
            const position = index.findIndex((entry) => entry?.token === safeToken);
            if (position !== -1) {
                index.splice(position, 1);
            }
        });
    } catch (_error) {
        // Best-effort cleanup only.
    }
}

export function getCloudUserRootName(rawUserId) {
    const safeUserId = sanitizeSegment(String(rawUserId || '').trim(), '');
    if (!safeUserId) return '';
    return `user_${safeUserId}`;
}

export async function revokeShareTokens(tokens, options = {}) {
    const tokenSet = new Set(
        Array.from(tokens || [])
            .map((token) => String(token || '').trim())
            .filter(Boolean)
    );
    if (tokenSet.size === 0) {
        return { success: true, revoked: 0 };
    }

    const ownerRootName = options.ownerRootName
        ? sanitizeSegment(String(options.ownerRootName || '').trim(), '')
        : '';
    const revokedAt = options.revokedAt || new Date().toISOString();
    const revokedReason = options.revokedReason ? String(options.revokedReason).trim().slice(0, 200) : '';
    const revokedBy = options.revokedBy ? String(options.revokedBy).trim().slice(0, 120) : '';

    const revoked = await mutateShareIndex(async (index) => {
        let count = 0;
        for (const entry of index) {
            if (!entry?.token) continue;
            if (entry.revokedAt) continue;
            if (!tokenSet.has(entry.token)) continue;
            if (ownerRootName && entry.ownerRootName !== ownerRootName) continue;

            entry.revokedAt = revokedAt;
            if (revokedReason) entry.revokedReason = revokedReason;
            if (revokedBy) entry.revokedBy = revokedBy;
            count += 1;
        }
        return count;
    });

    return { success: true, revoked: Number(revoked || 0) };
}

function generateShareToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function getPublicBaseUrl(req) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    return `${protocol}://${req.get('host')}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatSizeLabel(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const idx = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const val = n / Math.pow(1024, idx);
    return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function getPublicPreviewKind(filename = '') {
    const ext = path.extname(String(filename || '')).toLowerCase().replace('.', '');
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
    if (['txt', 'md', 'log', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts', 'py'].includes(ext)) return 'text';
    return 'none';
}

function renderPublicPreviewHtml(kind, previewUrl, fileName) {
    const safeUrl = escapeHtml(previewUrl);
    const safeName = escapeHtml(fileName);
    if (kind === 'image') {
        return `<div class="preview-wrap"><img class="preview-image" src="${safeUrl}" alt="${safeName}" loading="eager" decoding="async" /></div>`;
    }
    if (kind === 'pdf') {
        return `<div class="preview-wrap"><iframe class="preview-frame" src="${safeUrl}" title="${safeName}"></iframe></div>`;
    }
    if (kind === 'video') {
        return `<div class="preview-wrap preview-dark"><video class="preview-video" src="${safeUrl}" controls preload="metadata"></video></div>`;
    }
    if (kind === 'audio') {
        return `<div class="preview-wrap"><div class="preview-audio-box"><audio class="preview-audio" src="${safeUrl}" controls preload="metadata"></audio></div></div>`;
    }
    if (kind === 'text') {
        return `<div class="preview-wrap"><iframe class="preview-frame" src="${safeUrl}" title="${safeName}"></iframe></div>`;
    }
    return '<div class="preview-empty">Định dạng này chưa hỗ trợ xem trước trực tiếp. Bạn có thể tải file xuống.</div>';
}

function renderPublicErrorPage(message, statusCode = 500) {
    const codeLabel = `ERROR ${statusCode}`;
    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(codeLabel)}</title>
<style>
    :root{--bg:#020617;--bg2:#0f172a;--line:#334155;--warn:#f59e0b;--ink:#e2e8f0;--muted:#94a3b8;--err:#ef4444}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:
    radial-gradient(800px 400px at 20% 0%, rgba(239,68,68,.16), transparent 60%),
    radial-gradient(900px 500px at 100% 100%, rgba(245,158,11,.10), transparent 60%),
    linear-gradient(135deg,var(--bg),var(--bg2));color:var(--ink);font-family:Consolas,Monaco,'Courier New',monospace;display:grid;place-items:center;padding:20px}
    .panel{width:min(760px,100%);border:1px solid var(--line);border-radius:20px;background:rgba(2,6,23,.75);box-shadow:0 30px 80px rgba(0,0,0,.55);overflow:hidden}
    .head{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;background:rgba(15,23,42,.7)}
    .dots{display:flex;gap:8px}.dot{width:10px;height:10px;border-radius:999px;background:#334155}.dot.r{background:#ef4444}.dot.y{background:#f59e0b}.dot.g{background:#22c55e}
    .code{font-size:12px;letter-spacing:.08em;color:#fca5a5;text-transform:uppercase}
    .body{padding:26px 22px 28px;text-align:center}
    .tri{font-size:72px;line-height:1;display:inline-block;color:var(--warn);filter:drop-shadow(0 0 14px rgba(245,158,11,.45));animation:flicker 1.8s infinite}
    h1{margin:12px 0 8px;font-size:30px;letter-spacing:.08em;color:#fecaca;text-shadow:0 0 8px rgba(239,68,68,.35)}
    p{margin:0 auto;max-width:620px;color:var(--muted);font-size:14px;line-height:1.65}
    .err{margin-top:16px;display:inline-block;padding:8px 12px;border:1px solid #7f1d1d;border-radius:10px;background:rgba(127,29,29,.2);color:#fca5a5;font-weight:700;letter-spacing:.05em}
    @keyframes flicker{0%,100%{opacity:1;transform:translateY(0)}25%{opacity:.68;transform:translateY(-1px)}35%{opacity:.92;transform:translateY(1px)}60%{opacity:.74}80%{opacity:.96}}
  </style>
</head>
<body>
  <main class="panel">
    <header class="head">
      <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
      <div class="code">${escapeHtml(codeLabel)}</div>
    </header>
    <section class="body">
      <div class="tri">⚠</div>
      <h1>${escapeHtml(codeLabel)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="err">SYSTEM ALERT: RESOURCE UNAVAILABLE</div>
    </section>
  </main>
</body>
</html>`;
}

async function resolvePublicShare(token) {
    if (!token) {
        return { errorStatus: 400, errorMessage: 'Thiếu token chia sẻ.' };
    }

    await pruneShareIndex();

    const index = await readShareIndex();
    const item = index.find((entry) => entry?.token === token);
    if (!item) {
        return { errorStatus: 404, errorMessage: 'Link chia sẻ không tồn tại.' };
    }
    if (item.revokedAt) {
        return { errorStatus: 410, errorMessage: 'Link chia sẻ đã bị thu hồi.' };
    }
    if (isShareExpired(item)) {
        await dropShareToken(token);
        return { errorStatus: 410, errorMessage: 'Link chia sẻ đã hết hạn.' };
    }

    const ownerRootName = sanitizeSegment(item.ownerRootName, '');
    if (!ownerRootName) {
        await dropShareToken(token);
        return { errorStatus: 500, errorMessage: 'Dữ liệu link chia sẻ không hợp lệ.' };
    }
    const ownerRoot = path.join(CLOUD_ROOT, ownerRootName);

    let relPath = '';
    try {
        relPath = normalizeRelativePath(item.relativePath || '');
    } catch (_error) {
        await dropShareToken(token);
        return { errorStatus: 404, errorMessage: 'File chia sẻ không còn khả dụng.' };
    }

    if (!relPath || isReservedCloudPath(relPath)) {
        await dropShareToken(token);
        return { errorStatus: 404, errorMessage: 'File chia sẻ không còn khả dụng.' };
    }

    const filePath = safeResolve(ownerRoot, relPath);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
        await dropShareToken(token);
        return { errorStatus: 422, errorMessage: 'Không thể tìm thấy file hoặc file đã bị xóa bởi người dùng.' };
    }

    return { index, item, relPath, filePath, stat };
}

async function readEditLog(userRoot) {
    const { indexPath } = await ensureEditLog(userRoot);
    return readJsonArrayFile(indexPath);
}

function getExtnameFromRelativePath(relativePath = '') {
    return path.extname(String(relativePath || '')).toLowerCase();
}

function isEditableTextPath(relativePath = '') {
    const editableExts = new Set(['.txt', '.md', '.log', '.json', '.csv', '.xml', '.html', '.css', '.js', '.ts']);
    return editableExts.has(getExtnameFromRelativePath(relativePath));
}

async function readTrashIndex(userRoot) {
    const { indexPath } = await ensureTrashData(userRoot);
    return readJsonArrayFile(indexPath);
}

function isReservedCloudPath(relativePath) {
    const segments = String(relativePath || '').split('/').filter(Boolean);
    const hasReservedSegment = segments.some((segment) => (
        segment === TRASH_DIRNAME
        || segment === CHUNK_DIRNAME
        || segment === TRASH_INDEX_FILENAME
        || segment === EDIT_LOG_FILENAME
        || segment === `${TRASH_INDEX_FILENAME}.lock`
        || segment === `${EDIT_LOG_FILENAME}.lock`
        || segment === UPLOAD_LOCK_FILENAME
    ));

    return (
        hasReservedSegment
        || relativePath === TRASH_DIRNAME
        || relativePath.startsWith(`${TRASH_DIRNAME}/`)
        || relativePath === CHUNK_DIRNAME
        || relativePath.startsWith(`${CHUNK_DIRNAME}/`)
    );
}

function assertAllowedTargetPath(parentRelPath, itemName, itemLabel = 'Mục') {
    const combined = parentRelPath ? `${parentRelPath}/${itemName}` : itemName;
    if (isReservedCloudPath(combined)) {
        throw createHttpError(400, `${itemLabel} trùng với tên hệ thống, vui lòng đổi tên khác.`);
    }
}

async function getUniqueFilePath(dirPath, filename) {
    const parsed = path.parse(filename);
    const safeBase = sanitizeSegment(parsed.name, 'file');
    // Only remove reserved chars from extension, keep other Unicode (though extensions are usually ASCII)
    const safeExt = parsed.ext.replace(/[<>:"/\\|?*]/g, '');
    let candidate = `${safeBase}${safeExt}`;
    let fullPath = path.join(dirPath, candidate);
    let count = 1;

    while (fs.existsSync(fullPath)) {
        candidate = `${safeBase}-${count}${safeExt}`;
        fullPath = path.join(dirPath, candidate);
        count += 1;
    }

    return { filename: candidate, fullPath };
}

async function getUniqueTargetPath(parentDir, desiredName) {
    const parsed = path.parse(desiredName);
    const safeBase = sanitizeSegment(parsed.name, 'item');
    // Only remove reserved chars from extension, keep other Unicode
    const safeExt = parsed.ext.replace(/[<>:"/\\|?*]/g, '');
    let candidate = `${safeBase}${safeExt}`;
    let targetPath = path.join(parentDir, candidate);
    let count = 1;

    while (fs.existsSync(targetPath)) {
        candidate = `${safeBase}-${count}${safeExt}`;
        targetPath = path.join(parentDir, candidate);
        count += 1;
    }

    return { candidate, targetPath };
}

async function getFolderStats(dirPath, currentDepth = 0, maxDepth = 10) {
    if (currentDepth > maxDepth) {
        return { usedBytes: 0, fileCount: 0, folderCount: 0 };
    }

    let usedBytes = 0;
    let fileCount = 0;
    let folderCount = 0;

    const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);

    const results = await Promise.all(entries.map(async (entry) => {
        if (
            entry.name === CHUNK_DIRNAME
            || entry.name === TRASH_INDEX_FILENAME
            || entry.name === EDIT_LOG_FILENAME
            || entry.name === `${TRASH_INDEX_FILENAME}.lock`
            || entry.name === `${EDIT_LOG_FILENAME}.lock`
            || entry.name === UPLOAD_LOCK_FILENAME
            || entry.name === TRASH_DIRNAME
        ) {
            return { usedBytes: 0, fileCount: 0, folderCount: 0 };
        }

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const childStats = await getFolderStats(fullPath, currentDepth + 1, maxDepth);
            return {
                usedBytes: childStats.usedBytes,
                fileCount: childStats.fileCount,
                folderCount: childStats.folderCount + 1
            };
        } else if (entry.isFile()) {
            const stat = await fsp.stat(fullPath).catch(() => ({ size: 0 }));
            return {
                usedBytes: stat.size,
                fileCount: 1,
                folderCount: 0
            };
        }
        return { usedBytes: 0, fileCount: 0, folderCount: 0 };
    }));

    for (const res of results) {
        usedBytes += res.usedBytes;
        fileCount += res.fileCount;
        folderCount += res.folderCount;
    }

    return { usedBytes, fileCount, folderCount };
}

router.get('/files', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '/');
        const query = String(req.query.q || '').trim().toLowerCase();
        const targetDir = safeResolve(userRoot, relPath);

        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể truy cập đường dẫn hệ thống.' });
        }

        const dirStat = await fsp.stat(targetDir).catch(() => null);
        if (!dirStat || !dirStat.isDirectory()) {
            return res.status(404).json({ success: false, error: 'Thư mục không tồn tại.' });
        }

        const entries = await fsp.readdir(targetDir, { withFileTypes: true });
        const visibleEntries = entries.filter((entry) => {
            if (
                entry.name === TRASH_DIRNAME
                || entry.name === CHUNK_DIRNAME
                || entry.name === TRASH_INDEX_FILENAME
                || entry.name === EDIT_LOG_FILENAME
                || entry.name === `${TRASH_INDEX_FILENAME}.lock`
                || entry.name === `${EDIT_LOG_FILENAME}.lock`
                || entry.name === UPLOAD_LOCK_FILENAME
            ) {
                return false;
            }
            return true;
        });

        const items = await Promise.all(visibleEntries.map(async (entry) => {
            const fullPath = path.join(targetDir, entry.name);
            const itemStat = await fsp.stat(fullPath);
            const relative = relPath ? `${relPath}/${entry.name}` : entry.name;
            return {
                name: entry.name,
                type: entry.isDirectory() ? 'folder' : 'file',
                size: entry.isDirectory() ? null : itemStat.size,
                modifiedAt: itemStat.mtime.toISOString(),
                path: toClientPath(relative)
            };
        }));

        const filtered = query
            ? items.filter((item) => item.name.toLowerCase().includes(query))
            : items;

        filtered.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return new Date(b.modifiedAt) - new Date(a.modifiedAt);
        });

        return res.json({
            success: true,
            data: {
                currentPath: toClientPath(relPath),
                items: filtered
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/storage', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const stats = await getFolderStats(userRoot);
        return res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/folder', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '/');
        const folderName = sanitizeSegment(req.body.name, '');

        if (!folderName) {
            return res.status(400).json({ success: false, error: 'Tên thư mục không hợp lệ.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể tạo trong đường dẫn hệ thống.' });
        }
        assertAllowedTargetPath(relPath, folderName, 'Thư mục');

        const parent = safeResolve(userRoot, relPath);
        const target = safeResolve(parent, folderName);
        await fsp.mkdir(target, { recursive: false });

        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        if (error.code === 'EEXIST') {
            return res.status(409).json({ success: false, error: 'Thư mục đã tồn tại.' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/file', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '/');
        const fileName = sanitizeSegment(req.body.name, '');

        if (!fileName) {
            return res.status(400).json({ success: false, error: 'Tên file không hợp lệ.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể tạo trong đường dẫn hệ thống.' });
        }
        assertAllowedTargetPath(relPath, fileName, 'File');

        const parent = safeResolve(userRoot, relPath);
        await fsp.mkdir(parent, { recursive: true });

        const { filename, fullPath } = await getUniqueFilePath(parent, fileName);
        await fsp.writeFile(fullPath, '', 'utf8');

        const itemRelPath = relPath ? `${relPath}/${filename}` : filename;
        return res.json({
            success: true,
            data: {
                name: filename,
                path: toClientPath(itemRelPath)
            }
        });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/upload', requireLogin, upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res) => {
    const uploaded = [];
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '/');
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể upload vào đường dẫn hệ thống.' });
        }

        const targetDir = safeResolve(userRoot, relPath);
        await fsp.mkdir(targetDir, { recursive: true });

        await withFileLock(getUploadLockPath(userRoot), async () => {
            const stats = await getFolderStats(userRoot);
            const usedBytes = stats.usedBytes || 0;
            const uploadSize = (req.files || []).reduce((sum, f) => sum + (f.size || 0), 0);

            if (usedBytes + uploadSize > CLOUD_QUOTA_BYTES) {
                throw createHttpError(413, 'Vượt quá dung lượng 5GB. Vui lòng xóa file cũ để tiếp tục.');
            }

            for (const file of (req.files || [])) {
                const preferredName = normalizeUploadFilename(file.originalname);
                const { filename, fullPath } = await getUniqueFilePath(targetDir, preferredName);
                assertAllowedTargetPath(relPath, filename, 'File');
                await fsp.rename(file.path, fullPath);
                uploaded.push({
                    name: filename,
                    size: file.size
                });
            }
        });

        return res.json({ success: true, data: { uploaded } });
    } catch (error) {
        for (const file of (req.files || [])) {
            if (file.path && fs.existsSync(file.path)) {
                await fsp.unlink(file.path).catch(() => { });
            }
        }
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/upload/init', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '/');
        const originalFileName = String(req.body.fileName || '').trim();
        const totalSize = normalizeChunkTotalSize(req.body.totalSize);
        const chunkSize = normalizeChunkSize(req.body.chunkSize);
        const requestedChunks = Number.parseInt(String(req.body.totalChunks || ''), 10);

        if (!originalFileName) {
            return res.status(400).json({ success: false, error: 'Thiếu tên file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể upload vào đường dẫn hệ thống.' });
        }

        const targetDir = safeResolve(userRoot, relPath);
        await fsp.mkdir(targetDir, { recursive: true });

        const computedChunks = Math.ceil(totalSize / chunkSize);
        if (!Number.isInteger(computedChunks) || computedChunks <= 0) {
            return res.status(400).json({ success: false, error: 'Không thể tính số lượng chunk.' });
        }
        if (Number.isInteger(requestedChunks) && requestedChunks > 0 && requestedChunks !== computedChunks) {
            return res.status(400).json({ success: false, error: 'Số lượng chunk không khớp với kích thước file.' });
        }

        const data = await withFileLock(getUploadLockPath(userRoot), async () => {
            await cleanupExpiredChunkSessions(userRoot);

            const stats = await getFolderStats(userRoot);
            const usedBytes = stats.usedBytes || 0;
            const reservedBytes = await getReservedChunkBytes(userRoot);
            if (usedBytes + reservedBytes + totalSize > CLOUD_QUOTA_BYTES) {
                throw createHttpError(413, 'Vượt quá dung lượng 5GB. Vui lòng xóa file cũ để tiếp tục.');
            }

            const uploadId = crypto.randomBytes(18).toString('base64url');
            const { sessionDir, metaPath } = getChunkSessionPaths(userRoot, uploadId);
            await fsp.mkdir(sessionDir, { recursive: true });

            const preferredName = normalizeUploadFilename(originalFileName);
            const unique = await getUniqueFilePath(targetDir, preferredName);
            assertAllowedTargetPath(relPath, unique.filename, 'File');
            const nowIso = new Date().toISOString();
            const meta = {
                uploadId,
                relPath,
                originalName: originalFileName,
                targetName: unique.filename,
                totalSize,
                chunkSize,
                totalChunks: computedChunks,
                uploadedChunks: [],
                status: 'uploading',
                createdAt: nowIso,
                updatedAt: nowIso
            };
            await writeChunkMeta(metaPath, meta);

            return {
                uploadId,
                chunkSize,
                totalChunks: computedChunks,
                targetName: unique.filename
            };
        });

        return res.json({ success: true, data });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/upload/chunk/:uploadId/:index', requireLogin, (req, res) => {
    uploadChunk.single('chunk')(req, res, async (uploadError) => {
        if (uploadError) {
            const status = uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            const msg = uploadError.code === 'LIMIT_FILE_SIZE'
                ? 'Chunk vượt giới hạn cho phép.'
                : 'Không thể nhận chunk upload.';
            return res.status(status).json({ success: false, error: msg });
        }

        let tempChunkPath = req.file?.path || '';
        try {
            const { userRoot } = await ensureUserRoot(req);
            const { uploadId, sessionDir, metaPath, lockPath } = getChunkSessionPaths(userRoot, req.params.uploadId);
            const chunkIndex = parseChunkIndex(req.params.index);
            const fileSize = Number(req.file?.size || 0);

            if (!tempChunkPath || !fileSize) {
                throw createHttpError(400, 'Chunk upload trống hoặc không hợp lệ.');
            }

            const result = await withFileLock(lockPath, async () => {
                const meta = await readChunkMeta(metaPath);
                if (!meta) {
                    throw createHttpError(404, 'Không tìm thấy phiên upload.');
                }
                if (meta.status !== 'uploading') {
                    throw createHttpError(409, 'Phiên upload không còn ở trạng thái nhận chunk.');
                }
                if (chunkIndex >= Number(meta.totalChunks || 0)) {
                    throw createHttpError(400, 'Chunk index vượt quá tổng số chunk.');
                }

                const metaChunkSize = Number(meta.chunkSize || 0);
                if (metaChunkSize <= 0 || fileSize > metaChunkSize) {
                    throw createHttpError(400, 'Kích thước chunk không hợp lệ.');
                }
                const totalChunks = Number(meta.totalChunks || 0);
                const expectedLastSize = Number(meta.totalSize || 0) - (metaChunkSize * Math.max(0, totalChunks - 1));
                if (!Number.isInteger(totalChunks) || totalChunks <= 0 || expectedLastSize <= 0) {
                    throw createHttpError(400, 'Metadata phiên upload không hợp lệ.');
                }
                const expectedSize = chunkIndex === (totalChunks - 1) ? expectedLastSize : metaChunkSize;
                if (expectedSize > 0 && fileSize !== expectedSize) {
                    throw createHttpError(400, 'Chunk có kích thước không đúng với metadata phiên upload.');
                }

                const partPath = getChunkPartPath(sessionDir, chunkIndex);
                if (fs.existsSync(partPath)) {
                    await fsp.rm(partPath, { force: true }).catch(() => { });
                }
                await fsp.rename(tempChunkPath, partPath);
                tempChunkPath = '';

                const uploadedSet = new Set((meta.uploadedChunks || []).map((value) => Number(value)));
                uploadedSet.add(chunkIndex);
                meta.uploadedChunks = Array.from(uploadedSet)
                    .filter((value) => Number.isInteger(value) && value >= 0 && value < Number(meta.totalChunks || 0))
                    .sort((a, b) => a - b);
                meta.updatedAt = new Date().toISOString();
                await writeChunkMeta(metaPath, meta);

                return {
                    uploadId,
                    uploadedChunks: meta.uploadedChunks.length,
                    totalChunks: Number(meta.totalChunks || 0)
                };
            });

            return res.json({ success: true, data: result });
        } catch (error) {
            if (error?.statusCode) {
                return res.status(error.statusCode).json({ success: false, error: error.message });
            }
            return res.status(500).json({ success: false, error: error.message });
        } finally {
            if (tempChunkPath && fs.existsSync(tempChunkPath)) {
                await fsp.unlink(tempChunkPath).catch(() => { });
            }
        }
    });
});

router.get('/upload/status/:uploadId', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const { uploadId, sessionDir, metaPath, lockPath } = getChunkSessionPaths(userRoot, req.params.uploadId);

        const data = await withFileLock(lockPath, async () => {
            const meta = await readChunkMeta(metaPath);
            if (!meta) {
                throw createHttpError(404, 'Không tìm thấy phiên upload.');
            }

            const verified = [];
            for (const rawIdx of (meta.uploadedChunks || [])) {
                const idx = Number(rawIdx);
                if (!Number.isInteger(idx) || idx < 0 || idx >= Number(meta.totalChunks || 0)) continue;
                const partPath = getChunkPartPath(sessionDir, idx);
                if (fs.existsSync(partPath)) verified.push(idx);
            }

            if (verified.length !== (meta.uploadedChunks || []).length) {
                meta.uploadedChunks = verified;
                meta.updatedAt = new Date().toISOString();
                await writeChunkMeta(metaPath, meta);
            }

            return {
                uploadId,
                status: String(meta.status || 'uploading'),
                totalChunks: Number(meta.totalChunks || 0),
                uploadedChunks: verified.length,
                targetName: String(meta.targetName || meta.originalName || 'file')
            };
        });

        return res.json({ success: true, data });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/upload/complete/:uploadId', requireLogin, async (req, res) => {
    let chunkSessionDir = '';
    try {
        const { userRoot } = await ensureUserRoot(req);
        const { uploadId, sessionDir, metaPath, lockPath } = getChunkSessionPaths(userRoot, req.params.uploadId);
        chunkSessionDir = sessionDir;

        const data = await withFileLock(lockPath, async () => {
            const meta = await readChunkMeta(metaPath);
            if (!meta) {
                throw createHttpError(404, 'Không tìm thấy phiên upload.');
            }
            if (meta.status !== 'uploading' && meta.status !== 'assembling') {
                throw createHttpError(409, 'Phiên upload không hợp lệ để hoàn tất.');
            }

            const totalChunks = Number(meta.totalChunks || 0);
            if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
                throw createHttpError(400, 'Metadata upload bị lỗi.');
            }

            const uploadedSet = new Set((meta.uploadedChunks || []).map((value) => Number(value)));
            for (let idx = 0; idx < totalChunks; idx += 1) {
                if (!uploadedSet.has(idx)) {
                    throw createHttpError(400, `Thiếu chunk #${idx + 1}.`);
                }
                const partPath = getChunkPartPath(sessionDir, idx);
                if (!fs.existsSync(partPath)) {
                    throw createHttpError(400, `Chunk #${idx + 1} chưa được tải lên đầy đủ.`);
                }
            }

            meta.status = 'assembling';
            meta.updatedAt = new Date().toISOString();
            await writeChunkMeta(metaPath, meta);

            const finalized = await withFileLock(getUploadLockPath(userRoot), async () => {
                const stats = await getFolderStats(userRoot);
                const usedBytes = stats.usedBytes || 0;
                const finalSize = Number(meta.totalSize || 0);
                if (usedBytes + finalSize > CLOUD_QUOTA_BYTES) {
                    throw createHttpError(413, 'Không đủ dung lượng để hoàn tất file. Vui lòng xóa bớt dữ liệu.');
                }

                const relPath = normalizeRelativePath(meta.relPath || '/');
                if (isReservedCloudPath(relPath)) {
                    throw createHttpError(400, 'Đường dẫn lưu file không hợp lệ.');
                }

                const targetDir = safeResolve(userRoot, relPath);
                await fsp.mkdir(targetDir, { recursive: true });

                const preferredName = normalizeUploadFilename(meta.targetName || meta.originalName || 'file');
                const unique = await getUniqueFilePath(targetDir, preferredName);
                assertAllowedTargetPath(relPath, unique.filename, 'File');
                const assemblingPath = safeResolve(sessionDir, '.assembling.tmp');
                await fsp.rm(assemblingPath, { force: true }).catch(() => { });
                await fsp.writeFile(assemblingPath, '');

                try {
                    const writeStream = fs.createWriteStream(assemblingPath);
                    for (let idx = 0; idx < totalChunks; idx += 1) {
                        const partPath = getChunkPartPath(sessionDir, idx);
                        const readStream = fs.createReadStream(partPath);

                        await new Promise((resolve, reject) => {
                            readStream.pipe(writeStream, { end: false });
                            readStream.on('end', resolve);
                            readStream.on('error', reject);
                        });

                        await fsp.rm(partPath, { force: true }).catch(() => { });
                    }
                    writeStream.end();
                    await new Promise((resolve, reject) => {
                        writeStream.on('finish', resolve);
                        writeStream.on('error', reject);
                    });

                    await fsp.rename(assemblingPath, unique.fullPath);
                } catch (assembleError) {
                    await fsp.rm(assemblingPath, { force: true }).catch(() => { });
                    throw assembleError;
                }

                const finalRelPath = path.relative(userRoot, unique.fullPath);
                return {
                    name: unique.filename,
                    path: toClientPath(finalRelPath)
                };
            });

            meta.status = 'completed';
            meta.completedAt = new Date().toISOString();
            meta.updatedAt = meta.completedAt;
            meta.finalName = finalized.name;
            meta.finalPath = finalized.path;
            await writeChunkMeta(metaPath, meta);

            return { uploadId, ...finalized };
        });

        if (chunkSessionDir) {
            await fsp.rm(chunkSessionDir, { recursive: true, force: true }).catch(() => { });
        }
        return res.json({ success: true, data });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/upload/:uploadId', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const { sessionDir } = getChunkSessionPaths(userRoot, req.params.uploadId);
        await fsp.rm(sessionDir, { recursive: true, force: true }).catch(() => { });
        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.patch('/rename', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const sourceRel = normalizeRelativePath(req.body.path || '');
        const newName = sanitizeSegment(req.body.newName, '');

        if (!sourceRel || !newName) {
            return res.status(400).json({ success: false, error: 'Thiếu dữ liệu đổi tên.' });
        }
        if (isReservedCloudPath(sourceRel)) {
            return res.status(400).json({ success: false, error: 'Không thể đổi tên mục hệ thống.' });
        }
        assertAllowedTargetPath(path.posix.dirname(sourceRel) === '.' ? '' : path.posix.dirname(sourceRel), newName, 'Tên mới');

        const source = safeResolve(userRoot, sourceRel);
        const target = safeResolve(path.dirname(source), newName);
        await fsp.rename(source, target);
        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        if (error.code === 'EEXIST') {
            return res.status(409).json({ success: false, error: 'Tên mới đã tồn tại.' });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/share', requireLogin, async (req, res) => {
    try {
        const { userRoot, userRootName } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '');
        const ownerDisplayName = String(req.session?.user?.username || '').trim().slice(0, 120) || 'Người dùng Cloud';
        const ownerAvatar = String(req.session?.user?.avatar || '').trim().slice(0, 700);
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path file cần chia sẻ.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể chia sẻ file hệ thống.' });
        }

        const absPath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(absPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }

        const token = await mutateShareIndex(async (index) => {
            // Reuse an active share link for the same file to avoid creating too many duplicate tokens.
            const existing = index.find((entry) => (
                entry?.ownerRootName === userRootName
                && entry?.relativePath === relPath
                && !entry?.revokedAt
            ));

            if (existing?.token) {
                existing.expiresAt = null;
                existing.ownerDisplayName = ownerDisplayName;
                existing.ownerAvatar = ownerAvatar || '';
                return existing.token;
            }

            const createdToken = generateShareToken();
            index.push({
                token: createdToken,
                ownerRootName: userRootName,
                ownerDisplayName,
                ownerAvatar: ownerAvatar || '',
                relativePath: relPath,
                createdAt: new Date().toISOString(),
                downloadCount: 0,
                expiresAt: null
            });
            return createdToken;
        });

        const shareUrl = `${getPublicBaseUrl(req)}/api/cloud/public/${encodeURIComponent(token)}`;
        return res.json({
            success: true,
            data: {
                token,
                shareUrl,
                expiresAt: null
            }
        });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/share/:token', requireLogin, async (req, res) => {
    try {
        const { userRootName } = await ensureUserRoot(req);
        const token = String(req.params.token || '').trim();
        if (!token) {
            return res.status(400).json({ success: false, error: 'Thiếu token cần thu hồi.' });
        }

        await mutateShareIndex(async (index) => {
            const item = index.find((entry) => entry?.token === token);
            if (!item) {
                throw createHttpError(404, 'Không tìm thấy link chia sẻ.');
            }
            if (item.ownerRootName !== userRootName) {
                throw createHttpError(403, 'Bạn không có quyền thu hồi link này.');
            }
            item.revokedAt = new Date().toISOString();
        });

        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/public/:token', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const result = await resolvePublicShare(token);
        if (result.errorMessage) {
            return res.status(result.errorStatus || 500).send(renderPublicErrorPage(result.errorMessage, result.errorStatus || 500));
        }

        const { item, relPath, stat } = result;
        const fileName = path.basename(relPath);
        const sizeLabel = formatSizeLabel(stat.size);
        const downloadUrl = `/api/cloud/public/${encodeURIComponent(token)}/download`;
        const previewUrl = `/api/cloud/public/${encodeURIComponent(token)}/preview`;
        const previewKind = getPublicPreviewKind(fileName);
        const previewHtml = renderPublicPreviewHtml(previewKind, previewUrl, fileName);
        const expireLabel = 'Vô thời hạn (khi file còn tồn tại)';
        let authorName = String(item.ownerDisplayName || '').trim();
        if (!authorName) {
            const ownerRootName = String(item.ownerRootName || '').trim();
            authorName = ownerRootName.startsWith('user_') ? 'Người dùng Cloud' : (ownerRootName || 'Người dùng Cloud');
        }
        const authorAvatar = String(item.ownerAvatar || '').trim();
        const authorInitial = escapeHtml((Array.from(authorName)[0] || '?').toUpperCase());
        const authorLabel = escapeHtml(authorName);
        const safeAuthorAvatar = authorAvatar ? escapeHtml(authorAvatar) : '';
        const sharedAt = item?.createdAt ? new Date(item.createdAt) : null;
        const sharedAtLabel = sharedAt && !Number.isNaN(sharedAt.getTime()) ? sharedAt.toLocaleString('vi-VN') : '--';

        return res.send(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
<meta property="og:image" content="/photos/anh-dowload/dowload.png">
<meta property="og:title" content="Trang tải file">
  <title>Tải file chia sẻ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    :root{--bg1:#f0f9ff;--bg2:#fdf2f8;--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--brand:#2563eb;--brand2:#1d4ed8}
    *{box-sizing:border-box} body{margin:0;font-family:'Manrope',system-ui,sans-serif;color:var(--ink);background:
      radial-gradient(1200px 500px at 0% -10%, #dbeafe 0%, transparent 60%),
      radial-gradient(1100px 500px at 100% -20%, #fce7f3 0%, transparent 60%),
      linear-gradient(120deg,var(--bg1),var(--bg2));min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{width:min(760px,100%);background:#fff;border:1px solid var(--line);border-radius:24px;box-shadow:0 28px 70px rgba(15,23,42,.16);overflow:hidden}
    .hero{padding:28px 28px 18px;background:linear-gradient(135deg,#eff6ff,#eef2ff 45%,#fdf2f8);border-bottom:1px solid #dbeafe}
    .badge{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #dbeafe;color:#1d4ed8;padding:8px 12px;border-radius:999px;font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;box-shadow:0 8px 22px rgba(37,99,235,.14)}
    h1{margin:14px 0 6px;font-size:30px;line-height:1.1;letter-spacing:-.02em}
    .sub{margin:0;color:var(--muted)}
    .author{margin-top:16px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.86);backdrop-filter:blur(6px);border:1px solid #dbeafe;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .author-main{display:flex;align-items:center;gap:10px;min-width:0}
    .author-avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px;overflow:hidden;box-shadow:0 8px 18px rgba(37,99,235,.28);flex-shrink:0}
    .author-avatar img{display:block;width:100%;height:100%;object-fit:cover}
    .author-copy{min-width:0}
    .author-k{font-size:11px;font-weight:800;color:#64748b;letter-spacing:.08em;text-transform:uppercase}
    .author-v{margin-top:2px;font-weight:800;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
    .author-time{font-size:12px;color:#64748b;font-weight:700}
    .body{padding:22px 28px 28px}
    .file{display:flex;align-items:center;gap:14px;padding:16px;border:1px solid #dbeafe;border-radius:16px;background:linear-gradient(135deg,#f8fafc,#eef6ff)}
    .icon{width:50px;height:50px;border-radius:14px;background:linear-gradient(135deg,#dbeafe,#c7d2fe);display:grid;place-items:center;font-size:24px}
    .name-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .name{font-weight:800;word-break:break-word}
    .size-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid #c7d2fe;background:#eef2ff;color:#1e3a8a;font-size:12px;font-weight:800;letter-spacing:.02em}
    .meta{margin-top:2px;color:var(--muted);font-size:14px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
    .cell{padding:12px 14px;border:1px solid #dbeafe;border-radius:12px;background:#fff}
    .k{font-size:11px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase}
    .v{margin-top:4px;font-weight:700}
    .actions{margin-top:20px;display:flex;gap:10px;flex-wrap:wrap}
    .btn{appearance:none;border:none;border-radius:12px;padding:13px 18px;font-weight:800;font-size:14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:10px}
    .btn-size{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);font-size:12px;font-weight:800}
    .btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;box-shadow:0 10px 26px rgba(37,99,235,.35)}
    .btn-primary:hover{filter:brightness(1.03)}
    .preview-title{margin-top:16px;margin-bottom:10px;font-size:12px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase}
    .preview-wrap{border:1px solid var(--line);border-radius:14px;background:#f8fafc;overflow:hidden;min-height:120px}
    .preview-dark{background:#020617}
    .preview-image{display:block;width:100%;max-height:420px;object-fit:contain;background:#fff}
    .preview-frame{display:block;width:100%;height:420px;border:0;background:#fff}
    .preview-video{display:block;width:100%;max-height:420px;background:#000}
    .preview-audio-box{padding:24px 16px;background:#fff}
    .preview-audio{display:block;width:100%;max-width:100%;min-height:54px;background:#fff}
    .preview-empty{padding:16px;border:1px dashed #cbd5e1;border-radius:14px;background:#fff;color:#64748b;font-size:14px}
    .hint{margin-top:10px;color:#64748b;font-size:13px}
    @media (max-width:640px){
      body{padding:10px;align-items:flex-start}
      .card{width:100%;border-radius:18px}
      h1{font-size:23px}
      .sub{font-size:14px}
      .hero{padding:20px 14px 12px}
      .author{padding:10px 10px;flex-direction:column;align-items:flex-start}
      .author-v{max-width:100%}
      .body{padding:14px 14px 18px}
      .file{padding:12px;gap:10px}
      .icon{width:44px;height:44px;font-size:20px;border-radius:12px}
      .meta{font-size:13px}
      .grid{grid-template-columns:1fr;gap:8px;margin-top:12px}
      .cell{padding:10px 12px}
      .actions{margin-top:14px}
      .btn{width:100%;justify-content:center;padding:14px 16px}
      .preview-title{margin-top:12px}
      .preview-image{max-height:280px}
      .preview-frame{height:300px}
      .preview-video{max-height:280px}
      .preview-audio-box{padding:14px 10px}
      .preview-audio{min-height:50px}
    }
  </style>
</head>
<body>
  <main class="card">
    <section class="hero">
      <span class="badge">Cloud Share</span>
      <h1>Tệp được chia sẻ với bạn</h1>
      <p class="sub">Xem thông tin tệp và bấm tải xuống khi bạn sẵn sàng.</p>
      <div class="author">
        <div class="author-main">
          <div class="author-avatar">${safeAuthorAvatar ? `<img src="${safeAuthorAvatar}" alt="${authorLabel}">` : authorInitial}</div>
          <div class="author-copy">
            <div class="author-k">Tác giả</div>
            <div class="author-v">${authorLabel}</div>
          </div>
        </div>
        <div class="author-time">Đã chia sẻ: ${escapeHtml(sharedAtLabel)}</div>
      </div>
    </section>
    <section class="body">
      <div class="file">
        <div class="icon">📄</div>
        <div>
          <div class="name-row">
            <div class="name">${escapeHtml(fileName)}</div>
            <span class="size-pill">${escapeHtml(sizeLabel)}</span>
          </div>
          <div class="meta">${escapeHtml(sizeLabel)}</div>
        </div>
      </div>
      <div class="grid">
        <div class="cell"><div class="k">Dung lượng</div><div class="v">${escapeHtml(sizeLabel)}</div></div>
        <div class="cell"><div class="k">Hiệu lực</div><div class="v">${escapeHtml(expireLabel)}</div></div>
        <div class="cell"><div class="k">Lượt tải</div><div class="v">${Number(item.downloadCount || 0)}</div></div>
        <div class="cell"><div class="k">Tác giả</div><div class="v">${authorLabel}</div></div>
      </div>
      <div class="preview-title">Xem trước</div>
      ${previewHtml}
      <div class="actions">
        <a class="btn btn-primary" href="${downloadUrl}">⬇ Tải xuống <span class="btn-size">${escapeHtml(sizeLabel)}</span></a>
      </div>
      <div class="hint">Nếu nút không hoạt động, thử mở link này trong tab mới.</div>
    </section>
  </main>
</body>
</html>`);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/public/:token/download', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const result = await resolvePublicShare(token);
        if (result.errorMessage) {
            return res.status(result.errorStatus || 500).json({ success: false, error: result.errorMessage });
        }

        const { filePath } = result;
        res.setHeader('Cache-Control', 'public, max-age=300');
        try {
            await mutateShareIndex(async (index) => {
                const entry = index.find((item) => item?.token === token && !item?.revokedAt);
                if (!entry) return;
                entry.downloadCount = Number(entry.downloadCount || 0) + 1;
                entry.lastDownloadedAt = new Date().toISOString();
            });
        } catch (_error) {
            // Keep download available even when share index update is temporarily locked.
        }

        return res.download(filePath, path.basename(filePath));
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/public/:token/thumb', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const width = Math.max(120, Math.min(1024, Number.parseInt(String(req.query.w || '560'), 10) || 560));

        const result = await resolvePublicShare(token);
        if (result.errorMessage) {
            return res.status(result.errorStatus || 500).json({ success: false, error: result.errorMessage });
        }

        const { filePath, stat, relPath } = result;
        const fileName = path.basename(relPath);
        const previewKind = getPublicPreviewKind(fileName);
        if (previewKind !== 'image') {
            return res.status(415).json({ success: false, error: 'thumb_only_supports_images' });
        }

        const thumbDir = path.join(CLOUD_TEMP, 'thumbs');
        await fsp.mkdir(thumbDir, { recursive: true });

        const cacheKey = `${token}-${width}-${Math.floor(stat.mtimeMs)}-${stat.size}.webp`;
        const outPath = path.join(thumbDir, cacheKey);

        if (!fs.existsSync(outPath)) {
            const tmpPath = `${outPath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
            try {
                const { default: sharp } = await import('sharp');
                await sharp(filePath)
                    .rotate()
                    .resize({ width, withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(tmpPath);
                await fsp.rename(tmpPath, outPath);
            } catch (error) {
                await fsp.rm(tmpPath, { force: true }).catch(() => { });
                return res.status(500).json({ success: false, error: `thumb_failed: ${error.message}` });
            }
        }

        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(outPath);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/public/:token/preview', async (req, res) => {
    try {
        const token = String(req.params.token || '').trim();
        const result = await resolvePublicShare(token);
        if (result.errorMessage) {
            return res.status(result.errorStatus || 500).json({ success: false, error: result.errorMessage });
        }

        const { filePath } = result;
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.sendFile(filePath);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/history', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '');
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path lịch sử file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể truy cập lịch sử file hệ thống.' });
        }

        const filePath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }

        const logs = await readEditLog(userRoot);
        const items = logs
            .filter((entry) => entry?.path === toClientPath(relPath))
            .sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt))
            .slice(0, 20);

        return res.json({ success: true, data: { items } });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/content', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '');
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể mở file hệ thống.' });
        }
        if (!isEditableTextPath(relPath)) {
            return res.status(415).json({ success: false, error: 'Chỉ hỗ trợ mở nội dung file text.' });
        }

        const filePath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }
        if (stat.size > MAX_EDITABLE_TEXT_BYTES) {
            return res.status(413).json({ success: false, error: 'File quá lớn để chỉnh sửa trực tiếp (tối đa 2MB).' });
        }

        const content = await fsp.readFile(filePath, 'utf8');
        const logs = await readEditLog(userRoot);
        const items = logs
            .filter((entry) => entry?.path === toClientPath(relPath))
            .sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt))
            .slice(0, 20);

        return res.json({
            success: true,
            data: {
                path: toClientPath(relPath),
                content,
                items
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/download-stats', requireLogin, async (req, res) => {
    try {
        const { userRootName } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '/');

        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path file.' });
        }

        const shareIndex = await readShareIndex();
        const userShares = shareIndex.filter((entry) =>
            entry?.ownerRootName === userRootName &&
            entry?.relativePath === relPath &&
            !entry?.revokedAt
        );

        let totalDownloads = 0;
        let firstDownloadedAt = null;
        let lastDownloadedAt = null;

        for (const share of userShares) {
            const count = Number(share.downloadCount || 0);
            totalDownloads += count;

            if (share.lastDownloadedAt) {
                if (!lastDownloadedAt || new Date(share.lastDownloadedAt) > new Date(lastDownloadedAt)) {
                    lastDownloadedAt = share.lastDownloadedAt;
                }
            }

            if (count > 0 && share.createdAt) {
                if (!firstDownloadedAt || new Date(share.createdAt) < new Date(firstDownloadedAt)) {
                    firstDownloadedAt = share.createdAt;
                }
            }
        }

        return res.json({
            success: true,
            data: {
                path: relPath,
                downloadCount: totalDownloads,
                shareCount: userShares.length,
                firstDownloadedAt,
                lastDownloadedAt
            }
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || 'Không thể lấy thống kê download.'
        });
    }
});

router.patch('/content', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.body.path || '');
        const nextContent = String(req.body.content ?? '');
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể sửa file hệ thống.' });
        }
        if (!isEditableTextPath(relPath)) {
            return res.status(415).json({ success: false, error: 'Chỉ hỗ trợ chỉnh sửa file text.' });
        }

        const contentBytes = Buffer.byteLength(nextContent, 'utf8');
        if (contentBytes > MAX_EDITABLE_TEXT_BYTES) {
            return res.status(413).json({ success: false, error: 'Nội dung quá lớn (tối đa 2MB).' });
        }

        const filePath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }

        await fsp.writeFile(filePath, nextContent, 'utf8');

        const entry = {
            path: toClientPath(relPath),
            editedAt: new Date().toISOString(),
            editor: sanitizeSegment(req.session.user.username || 'unknown', 'unknown'),
            size: contentBytes
        };
        const items = await mutateEditLog(userRoot, async (logs) => {
            logs.push(entry);
            if (logs.length > 300) {
                logs.splice(0, logs.length - 300);
            }

            return logs
                .filter((log) => log?.path === toClientPath(relPath))
                .sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt))
                .slice(0, 20);
        });

        return res.json({
            success: true,
            data: {
                path: toClientPath(relPath),
                items
            }
        });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/move-to-trash', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const sourceRel = normalizeRelativePath(req.body.path || '');
        if (!sourceRel) {
            return res.status(400).json({ success: false, error: 'Thiếu đường dẫn cần xóa.' });
        }
        if (isReservedCloudPath(sourceRel)) {
            return res.status(400).json({ success: false, error: 'Không thể thao tác trên mục hệ thống.' });
        }

        const source = safeResolve(userRoot, sourceRel);
        const created = await mutateTrashIndex(userRoot, async (index) => {
            const sourceStat = await fsp.stat(source).catch(() => null);
            if (!sourceStat) {
                throw createHttpError(404, 'Mục không tồn tại.');
            }

            const trashId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const stampName = `${trashId}-${path.basename(source)}`;
            const trashRelativePath = `${TRASH_DIRNAME}/${stampName}`;
            const target = safeResolve(userRoot, trashRelativePath);
            await fsp.rename(source, target);

            index.push({
                id: trashId,
                name: path.basename(source),
                type: sourceStat.isDirectory() ? 'folder' : 'file',
                size: sourceStat.isFile() ? sourceStat.size : null,
                originalPath: toClientPath(sourceRel),
                trashedPath: toClientPath(trashRelativePath),
                deletedAt: new Date().toISOString()
            });

            return { id: trashId };
        });

        return res.json({ success: true, data: created });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/trash', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const query = String(req.query.q || '').trim().toLowerCase();
        const index = await readTrashIndex(userRoot);
        const validItems = [];
        for (const item of index) {
            let relTrashPath = '';
            try {
                relTrashPath = normalizeRelativePath(item.trashedPath || '');
            } catch (_error) {
                continue;
            }
            const absPath = safeResolve(userRoot, relTrashPath);
            const stat = await fsp.stat(absPath).catch(() => null);
            if (!stat) {
                continue;
            }

            validItems.push({
                ...item,
                type: stat.isDirectory() ? 'folder' : 'file',
                size: stat.isFile() ? stat.size : null,
                trashedPath: toClientPath(relTrashPath)
            });
        }

        const filtered = query
            ? validItems.filter((item) => String(item.name || '').toLowerCase().includes(query))
            : validItems;

        filtered.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

        return res.json({
            success: true,
            data: {
                items: filtered
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/trash/restore', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const id = String(req.body.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, error: 'Thiếu id mục cần khôi phục.' });
        }

        const outcome = await mutateTrashIndex(userRoot, async (index) => {
            const position = index.findIndex((entry) => entry.id === id);
            if (position === -1) {
                throw createHttpError(404, 'Không tìm thấy mục trong thùng rác.');
            }

            const item = index[position];
            const sourceRel = normalizeRelativePath(item.trashedPath || '');
            const sourceAbs = safeResolve(userRoot, sourceRel);
            const sourceStat = await fsp.stat(sourceAbs).catch(() => null);
            if (!sourceStat) {
                index.splice(position, 1);
                return { status: 'missing' };
            }

            const restoreRel = normalizeRelativePath(item.originalPath || '');
            if (isReservedCloudPath(restoreRel)) {
                throw createHttpError(400, 'Không thể khôi phục vào đường dẫn hệ thống.');
            }

            const parentRel = path.posix.dirname(restoreRel);
            const parentAbs = safeResolve(userRoot, parentRel === '.' ? '' : parentRel);
            await fsp.mkdir(parentAbs, { recursive: true });

            let restoreAbs = safeResolve(userRoot, restoreRel);
            if (fs.existsSync(restoreAbs)) {
                const unique = await getUniqueTargetPath(parentAbs, path.basename(restoreRel));
                restoreAbs = unique.targetPath;
            }

            await fsp.rename(sourceAbs, restoreAbs);
            index.splice(position, 1);

            return {
                status: 'restored',
                restoredPath: toClientPath(path.relative(userRoot, restoreAbs))
            };
        });

        if (outcome.status === 'missing') {
            return res.status(404).json({ success: false, error: 'Mục đã không còn trong thùng rác.' });
        }

        return res.json({
            success: true,
            data: {
                restoredPath: outcome.restoredPath
            }
        });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/trash/:id', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const id = String(req.params.id || '').trim();
        if (!id) {
            return res.status(400).json({ success: false, error: 'Thiếu id mục cần xóa.' });
        }

        await mutateTrashIndex(userRoot, async (index) => {
            const position = index.findIndex((entry) => entry.id === id);
            if (position === -1) {
                throw createHttpError(404, 'Không tìm thấy mục trong thùng rác.');
            }

            const item = index[position];
            const sourceRel = normalizeRelativePath(item.trashedPath || '');
            const sourceAbs = safeResolve(userRoot, sourceRel);
            await fsp.rm(sourceAbs, { recursive: true, force: true });
            index.splice(position, 1);
        });

        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/download', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '');
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path tải file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể tải file hệ thống.' });
        }

        const filePath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }

        return res.download(filePath, path.basename(filePath));
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/preview', requireLogin, async (req, res) => {
    try {
        const { userRoot } = await ensureUserRoot(req);
        const relPath = normalizeRelativePath(req.query.path || '');
        if (!relPath) {
            return res.status(400).json({ success: false, error: 'Thiếu path preview file.' });
        }
        if (isReservedCloudPath(relPath)) {
            return res.status(400).json({ success: false, error: 'Không thể preview file hệ thống.' });
        }

        const filePath = safeResolve(userRoot, relPath);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(404).json({ success: false, error: 'File không tồn tại.' });
        }

        // Inline mode for faster browser-native rendering/streaming (image/video/audio/pdf).
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.sendFile(filePath);
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
