import { execFile } from 'child_process';
import express from 'express';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOWNLOAD_DIR = path.resolve(__dirname, '..', '..', '..', 'videofb');
const SAFE_FILE_NAME_PATTERN = /^fb_video_\d{10,20}\.mp4$/;

function isAllowedFacebookHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return (
        host === 'facebook.com'
        || host.endsWith('.facebook.com')
        || host === 'fb.watch'
        || host.endsWith('.fb.watch')
        || host.endsWith('.fbcdn.net')
        || host.endsWith('.fbsbx.com')
    );
}

function normalizeFacebookUrl(input) {
    try {
        const parsed = new URL(String(input || '').trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        if (!isAllowedFacebookHost(parsed.hostname)) return null;
        return parsed.toString();
    } catch (_error) {
        return null;
    }
}

function resolveYtDlpPath() {
    const candidates = [
        path.resolve(__dirname, '..', '..', '..', 'yt-dlp.exe'),
        path.resolve(process.cwd(), 'yt-dlp.exe'),
        'yt-dlp.exe',
        'yt-dlp'
    ];

    for (const candidate of candidates) {
        if (candidate === 'yt-dlp.exe' || candidate === 'yt-dlp') return candidate;
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

function resolveDownloadFilePath(fileName) {
    const safeName = path.basename(String(fileName || '').trim());
    if (!SAFE_FILE_NAME_PATTERN.test(safeName)) return null;

    const baseDir = path.resolve(DOWNLOAD_DIR);
    const fullPath = path.resolve(baseDir, safeName);
    if (!fullPath.startsWith(`${baseDir}${path.sep}`)) return null;

    return { safeName, fullPath };
}

function runYtDlp(ytDlpPath, args) {
    return new Promise((resolve, reject) => {
        execFile(ytDlpPath, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

// Route xử lý tải video về server
router.post('/download', async (req, res) => {
    const videoUrl = normalizeFacebookUrl(req.body?.url);

    if (!videoUrl) {
        return res.status(400).json({ error: 'Link Facebook không hợp lệ.' });
    }

    const ytDlpPath = resolveYtDlpPath();
    if (!ytDlpPath) {
        return res.status(500).json({ error: 'Không tìm thấy yt-dlp trên server.' });
    }

    const timestamp = Date.now();
    const fileName = `fb_video_${timestamp}.mp4`;
    const outputPath = path.join(DOWNLOAD_DIR, fileName);

    try {
        await fsp.mkdir(DOWNLOAD_DIR, { recursive: true });

        const args = [
            '-f', 'best',
            '--no-playlist',
            '--no-warnings',
            '-o', outputPath,
            videoUrl
        ];

        await runYtDlp(ytDlpPath, args);

        const stat = await fsp.stat(outputPath).catch(() => null);
        if (!stat || !stat.isFile()) {
            return res.status(500).json({ error: 'Tải xong nhưng không tìm thấy file kết quả.' });
        }

        return res.json({ success: true, fileName });
    } catch (error) {
        console.error('[Facebook] Download failed:', error.message);
        return res.status(500).json({ error: 'Không tải được video Facebook.' });
    }
});

// Route để tải file về máy người dùng
router.get('/download/:fileName', async (req, res) => {
    const resolved = resolveDownloadFilePath(req.params.fileName);
    if (!resolved) {
        return res.status(400).json({ error: 'Tên file không hợp lệ.' });
    }

    const { safeName, fullPath } = resolved;

    try {
        await fsp.access(fullPath);

        return res.download(fullPath, safeName, (error) => {
            if (error && !res.headersSent) {
                res.status(404).json({ error: 'File không tồn tại' });
                return;
            }

            // Xóa file tạm sau khi trả về client xong.
            setTimeout(() => {
                fsp.unlink(fullPath).catch((unlinkError) => {
                    console.log('Không xóa được file:', unlinkError.message);
                });
            }, 5000);
        });
    } catch (_error) {
        return res.status(404).json({ error: 'File không tồn tại' });
    }
});

export default router;
