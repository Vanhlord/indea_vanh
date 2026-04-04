import { execFile } from 'child_process';

import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getYtDlpPath() {
    return path.resolve(__dirname, '..', '..', '..', 'yt-dlp.exe');
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

export async function getYoutubeInfoData(videoUrl) {
    const targetUrl = String(videoUrl || '').trim();
    if (!targetUrl) {
        throw new Error('Thiếu URL YouTube');
    }

    const ytDlpPath = getYtDlpPath();
    if (!fs.existsSync(ytDlpPath)) {
        console.error('[YouTube] yt-dlp.exe not found at:', ytDlpPath);
        throw new Error('Lỗi server: Không tìm thấy yt-dlp.exe!');
    }

    const args = [
        '--no-check-certificate',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        '--extractor-args', 'youtube:player_client=android',
        '--dump-json',
        targetUrl
    ];

    console.log('[YouTube] Info command:', ytDlpPath, args.join(' '));

    const { stdout } = await execFileAsync(ytDlpPath, args, { timeout: 30000 });
    const info = JSON.parse(stdout);

    return {
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration
    };
}

// Hàm lấy thông tin video (Tiêu đề, Thumbnail)
const getYoutubeInfo = async (req, res) => {
    const videoUrl = req.query.url;

    try {
        const info = await getYoutubeInfoData(videoUrl);
        return res.json(info);
    } catch (error) {
        const message = String(error.message || '');
        if (message.includes('yt-dlp.exe')) {
            return res.status(500).json({ error: message });
        }
        if (message.includes('JSON')) {
            console.error('[YouTube] Parse error:', error);
            return res.status(500).json({ error: 'Lỗi phân tích dữ liệu video' });
        }

        console.error('[YouTube] Error getting info:', error);
        if (error.stderr) {
            console.error('[YouTube] Stderr:', error.stderr);
        }
        return res.status(400).json({ error: 'Không lấy được thông tin video! Video có thể bị hạn chế hoặc link không hợp lệ.' });
    }
};

// Hàm xử lý tải file
const handleYoutubeDownload = (req, res) => {
    const { videoUrl, type } = req.body;
    
    if (!videoUrl) {
        return res.status(400).json({ error: 'Thiếu link video!' });
    }

    // Fix path: yt-dlp.exe is in root directory (3 levels up from src/modules/downloader/)
    const ytDlpPath = path.resolve(__dirname, '..', '..', '..', 'yt-dlp.exe');
    const fileName = `youtube_${Date.now()}.${type === 'video' ? 'mp4' : 'mp3'}`;
    const outputPath = path.resolve(__dirname, '..', '..', '..', 'youtube', fileName);

    // Check if yt-dlp exists
    if (!fs.existsSync(ytDlpPath)) {
        console.error('[YouTube] yt-dlp.exe not found at:', ytDlpPath);
        return res.status(500).json({ error: 'Lỗi server: Không tìm thấy yt-dlp.exe!' });
    }

    // Đảm bảo thư mục youtube tồn tại
    fs.ensureDirSync(path.dirname(outputPath));

    // Build args array to avoid shell escaping issues
    const args = [
        '--no-check-certificate',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--referer', 'https://www.youtube.com/',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
        '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        '--extractor-args', 'youtube:player_client=android',
        '--concurrent-fragments', '3',

        '--buffer-size', '16M',
        '--http-chunk-size', '10M',
        '--retries', '3',
        '--fragment-retries', '3',
        '--no-part',
        '-o', outputPath
    ];

    if (type === 'video') {
        // Ưu tiên chất lượng cao: thử lấy 1080p trước, nếu không được thì lấy best có sẵn
        args.push('-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[ext=mp4]/best');
        args.push('--merge-output-format', 'mp4');
    } else {

        // Tối ưu audio: trích xuất nhanh với chất lượng cao
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '192K', '--prefer-ffmpeg');
    }

    args.push(videoUrl);

    console.log('[YouTube] Download command:', ytDlpPath, args.join(' '));

    execFile(ytDlpPath, args, { timeout: 120000 }, (error, stdout, stderr) => {
        if (error) {
            console.error('[YouTube] Download failed:', error);
            console.error('[YouTube] Stderr:', stderr);
            return res.status(500).json({ error: 'Lỗi tải video. Video có thể bị hạn chế hoặc server đang bận!' });
        }

        // Kiểm tra xem file đã được tạo chưa và gửi về cho người dùng
        if (fs.existsSync(outputPath)) {
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.setHeader('Content-Type', type === 'video' ? 'video/mp4' : 'audio/mpeg');
            
            const fileStream = fs.createReadStream(outputPath);
            fileStream.pipe(res);
            
            fileStream.on('close', () => {
                // Tải xong xóa file tạm
                fs.remove(outputPath).catch(err => console.error('[YouTube] Error removing file:', err));
            });
            
            fileStream.on('error', (err) => {
                console.error('[YouTube] Stream error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Lỗi đọc file!' });
                }
            });
        } else {
            res.status(500).json({ error: 'Không tìm thấy file sau khi xử lý' });
        }
    });
};

export { handleYoutubeDownload, getYoutubeInfo };

