import { execFile } from 'child_process';

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

import { runXWorkerDownloadJob, runXWorkerInfoJob } from '../../services/downloader/xWorkerBridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getYtDlpPath() {
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

function execFileAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                error.stderr = stderr;
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

function sanitizeFileBaseName(input, fallback = 'file') {
    const normalized = path.basename(String(input || '').trim());
    const withoutControl = Array.from(path.parse(normalized).name)
        .filter((ch) => {
            const code = ch.charCodeAt(0);
            return code >= 32 && code !== 127;
        })
        .join('');

    const cleaned = withoutControl
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\.+$/g, '')
        .trim()
        .slice(0, 80);

    return cleaned || fallback;
}

function normalizeXUrl(input) {
    try {
        const parsed = new URL(String(input || '').trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;

        const host = parsed.hostname.toLowerCase();
        const isXHost = (
            host === 'x.com'
            || host.endsWith('.x.com')
            || host === 'twitter.com'
            || host.endsWith('.twitter.com')
            || host === 't.co'
            || host.endsWith('.t.co')
        );

        if (!isXHost) return null;

        if (host === 'x.com' || host.endsWith('.x.com')) {
            parsed.hostname = 'twitter.com';
        }

        return parsed.toString();
    } catch (_error) {
        return null;
    }
}

function pickThumbnail(info) {
    return info?.thumbnail
        || (Array.isArray(info?.thumbnails) ? info.thumbnails.find((item) => item?.url)?.url : '')
        || '';
}

function pickPreviewUrl(info) {
    const formats = Array.isArray(info?.formats) ? info.formats : [];
    const ranked = formats
        .filter((format) => format && typeof format.url === 'string')
        .sort((left, right) => {
            const leftHeight = Number(left.height || 0);
            const rightHeight = Number(right.height || 0);
            if (rightHeight !== leftHeight) return rightHeight - leftHeight;

            const leftBitrate = Number(left.tbr || 0);
            const rightBitrate = Number(right.tbr || 0);
            if (rightBitrate !== leftBitrate) return rightBitrate - leftBitrate;

            const leftExt = String(left.ext || '');
            const rightExt = String(right.ext || '');
            if (leftExt !== rightExt) {
                if (rightExt === 'mp4') return 1;
                if (leftExt === 'mp4') return -1;
            }
            return 0;
        });

    const preferred = ranked.find((format) => format.vcodec && format.vcodec !== 'none')
        || ranked[0]
        || null;

    return preferred?.url || info?.url || info?.webpage_url || '';
}

function getBaseArgs() {
    return [
        '--no-check-certificate',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        '--extractor-args', 'twitter:api=syndication'
    ];
}

function getDownloadTarget(customName) {
    const uniqueId = Date.now() + Math.random().toString(36).slice(2, 9);
    const baseName = customName
        ? sanitizeFileBaseName(customName, `x_${uniqueId}`)
        : `x_${uniqueId}`;
    const fileName = `${baseName}.mp4`;
    const outputDir = path.resolve(__dirname, '..', '..', '..', 'x');
    const outputPath = path.join(outputDir, fileName);

    return { fileName, outputDir, outputPath };
}

async function streamDownloadedFile(outputPath, fileName, res) {
    if (!fs.existsSync(outputPath)) {
        return res.status(500).json({ error: 'Không tìm thấy file sau khi xử lý' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('close', () => {
        fs.remove(outputPath).catch((error) => console.error('[X] Error removing file:', error));
    });

    fileStream.on('error', (error) => {
        console.error('[X] Stream error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Lỗi đọc file!' });
        }
    });
}

async function getXInfoDataDirect(videoUrl) {
    const targetUrl = normalizeXUrl(videoUrl);
    if (!targetUrl) {
        throw new Error('Link X/Twitter không hợp lệ!');
    }

    const ytDlpPath = getYtDlpPath();
    if (!ytDlpPath) {
        throw new Error('Lỗi server: Không tìm thấy yt-dlp.exe!');
    }

    const args = [
        ...getBaseArgs(),
        '--dump-json',
        targetUrl
    ];

    console.log('[X] Direct info command:', ytDlpPath, args.join(' '));

    const { stdout } = await execFileAsync(ytDlpPath, args, { timeout: 30000 });
    const info = JSON.parse(stdout);

    return {
        title: info.title || info.fulltitle || 'X video',
        author: info.uploader || info.channel || info.creator || info.uploader_id || '',
        thumbnail: pickThumbnail(info),
        duration: Number(info.duration || 0),
        previewUrl: pickPreviewUrl(info),
        raw: info
    };
}

async function handleXDownloadDirect(targetUrl, outputPath, fileName) {
    const ytDlpPath = getYtDlpPath();
    if (!ytDlpPath) {
        throw new Error('Lỗi server: Không tìm thấy yt-dlp.exe!');
    }

    const args = [
        ...getBaseArgs(),
        '--no-playlist',
        '--concurrent-fragments', '4',
        '--buffer-size', '16M',
        '--http-chunk-size', '10M',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-part',
        '--merge-output-format', 'mp4',
        '-f', 'bestvideo*+bestaudio/best',
        '-o', outputPath,
        targetUrl
    ];

    console.log('[X] Direct download command:', ytDlpPath, args.join(' '));

    await execFileAsync(ytDlpPath, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    if (!fs.existsSync(outputPath)) {
        throw new Error('Không tìm thấy file sau khi xử lý');
    }

    return { outputPath, fileName };
}

export async function getXInfoData(videoUrl) {
    const targetUrl = normalizeXUrl(videoUrl);
    if (!targetUrl) {
        throw new Error('Link X/Twitter không hợp lệ!');
    }

    try {
        return await getXInfoDataDirect(targetUrl);
    } catch (directError) {
        console.warn('[X] Direct info failed, fallback to worker:', directError.message);
        return await runXWorkerInfoJob(targetUrl);
    }
}

export async function handleXDownload(req, res) {
    const { videoUrl, fileName: customName } = req.body || {};
    const targetUrl = normalizeXUrl(videoUrl);

    if (!targetUrl) {
        return res.status(400).json({ error: 'Link X/Twitter không hợp lệ!' });
    }

    const { fileName, outputDir, outputPath } = getDownloadTarget(customName);

    fs.ensureDirSync(outputDir);

    try {
        await handleXDownloadDirect(targetUrl, outputPath, fileName);
        return await streamDownloadedFile(outputPath, fileName, res);
    } catch (directError) {
        console.warn('[X] Direct download failed, fallback to worker:', directError.message);
        await fs.remove(outputPath).catch(() => {});

        try {
            await runXWorkerDownloadJob(targetUrl, outputPath, fileName);
            return await streamDownloadedFile(outputPath, fileName, res);
        } catch (error) {
            console.error('[X] Download failed:', error);
            if (error.stderr) {
                console.error('[X] Stderr:', error.stderr);
            }

            await fs.remove(outputPath).catch(() => {});
            return res.status(500).json({ error: 'Lỗi tải video từ X/Twitter. Link có thể bị hạn chế hoặc không hợp lệ!' });
        }
    }
}
