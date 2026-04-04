import { execFile } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Helper to find yt-dlp.exe in multiple locations
function findYtDlp() {
    const possiblePaths = [
        path.resolve(__dirname, '..', 'yt-dlp.exe'),           // src/modules/yt-dlp.exe
        path.resolve(__dirname, '..', '..', '..', 'yt-dlp.exe'), // root/yt-dlp.exe
        path.resolve(process.cwd(), 'yt-dlp.exe'),              // cwd/yt-dlp.exe
        'yt-dlp.exe'                                            // in PATH
    ];
    
    for (const ytDlpPath of possiblePaths) {
        if (fs.existsSync(ytDlpPath)) {
            console.log(`[SoundCloud] Found yt-dlp at: ${ytDlpPath}`);
            return ytDlpPath;
        }
    }
    
    return null;
}

// SoundCloud Download Handler - Proxy download through server
export const handleSoundCloudDownload = async (req, res) => {
    let targetPath = null;
    
    try {
        const { trackUrl, fileName: customName } = req.body;

        if (!trackUrl) {
            return res.status(400).json({ error: 'Thiếu link SoundCloud!' });
        }

        // Validate SoundCloud URL
        if (!trackUrl.includes('soundcloud.com')) {
            return res.status(400).json({ error: 'Link không phải SoundCloud!' });
        }

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Generate unique filename
        const uniqueId = Date.now() + Math.random().toString(36).substr(2, 9);
        const baseName = customName
            ? sanitizeFileBaseName(customName, `soundcloud_${uniqueId}`)
            : `soundcloud_${uniqueId}`;
        const fileName = `${baseName}.mp3`;

        // Setup paths
        const targetDir = path.resolve(__dirname, '..', 'mp3');
        targetPath = path.join(targetDir, fileName);

        // Ensure directory exists
        await fs.ensureDir(targetDir);

        // Check yt-dlp exists
        const ytDlpPath = findYtDlp();
        if (!ytDlpPath) {
            return res.status(500).json({ error: 'yt-dlp.exe không tìm thấy! Vui lòng đặt yt-dlp.exe vào thư mục gốc hoặc src/modules/' });
        }

        console.log(`[SoundCloud Download] Starting: ${trackUrl}`);
        console.log(`[SoundCloud Download] File: ${fileName}`);

        // yt-dlp arguments for SoundCloud
        const args = [
            '--no-warnings',
            '--no-check-certificate',
            '--extract-audio',
            '--audio-format', 'mp3',
            '--audio-quality', '0', // Best quality
            '--output', targetPath,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--add-header', 'Accept-Language:en-US,en;q=0.9',
            '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            trackUrl
        ];

        // Execute yt-dlp
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout: yt-dlp took too long'));
            }, 120000); // 2 minutes timeout

            execFile(ytDlpPath, args, { timeout: 120000 }, (error, stdout, stderr) => {
                clearTimeout(timeout);
                
                if (error) {
                    console.error('[SoundCloud Download] yt-dlp error:', error);
                    reject(error);
                    return;
                }
                
                console.log('[SoundCloud Download] yt-dlp stdout:', stdout);
                if (stderr) console.log('[SoundCloud Download] yt-dlp stderr:', stderr);
                
                // Check if file was created
                if (!fs.existsSync(targetPath)) {
                    reject(new Error('File not created after download'));
                    return;
                }
                
                resolve();
            });
        });

        console.log(`[SoundCloud Download] File saved: ${targetPath}`);

        // Get file stats
        const stats = fs.statSync(targetPath);
        console.log(`[SoundCloud Download] File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        // Set headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', stats.size);

        // Stream file to client
        const fileStream = fs.createReadStream(targetPath);
        fileStream.pipe(res);

        // Handle stream events
        fileStream.on('error', (err) => {
            console.error('[SoundCloud Download] Stream error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Lỗi đọc file!' });
            }
        });

        fileStream.on('close', () => {
            console.log(`[SoundCloud Download] ✅ File sent: ${fileName}`);
            // Delete temp file
            if (targetPath && fs.existsSync(targetPath)) {
                try {
                    fs.unlinkSync(targetPath);
                    console.log(`[SoundCloud Download] 🗑️ Deleted temp file: ${fileName}`);
                } catch (err) {
                    console.error('[SoundCloud Download] Error deleting file:', err);
                }
            }
        });

    } catch (error) {
        console.error('[SoundCloud Download] Error:', error.message);
        
        // Cleanup on error
        if (targetPath && fs.existsSync(targetPath)) {
            try {
                fs.unlinkSync(targetPath);
            } catch (err) {
                // Ignore delete error
            }
        }
        
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Lỗi tải nhạc từ SoundCloud!',
                detail: error.message 
            });
        }
    }
};

export async function getSoundCloudInfoData(url) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl || !targetUrl.includes('soundcloud.com')) {
        throw new Error('Link SoundCloud không hợp lệ!');
    }

    const ytDlpPath = findYtDlp();
    if (!ytDlpPath) {
        throw new Error('yt-dlp.exe không tìm thấy! Vui lòng đặt yt-dlp.exe vào thư mục gốc hoặc src/modules/');
    }

    console.log(`[SoundCloud Info] Fetching: ${targetUrl}`);

    const args = [
        '--no-warnings',
        '--no-check-certificate',
        '--dump-json',
        '--skip-download',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        targetUrl
    ];

    const info = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout getting info'));
        }, 30000);

        execFile(ytDlpPath, args, { timeout: 30000 }, (error, stdout, _stderr) => {
            clearTimeout(timeout);
            
            if (error) {
                console.error('[SoundCloud Info] yt-dlp error:', error);
                reject(error);
                return;
            }
            
            try {
                const data = JSON.parse(stdout);
                resolve(data);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });

    return {
        title: info.title,
        artist: info.artist || info.uploader,
        duration: info.duration,
        thumbnail: info.thumbnail,
        url: targetUrl
    };
}

// Get track info using yt-dlp
export const getSoundCloudInfo = async (req, res) => {
    try {
        const info = await getSoundCloudInfoData(req.query.url);
        return res.json(info);
    } catch (error) {
        const message = String(error.message || '');
        if (message.includes('không hợp lệ')) {
            return res.status(400).json({ error: message });
        }

        console.error('[SoundCloud Info] Error:', error);
        return res.status(500).json({ 
            error: 'Không lấy được thông tin track!',
            detail: message 
        });
    }
};

