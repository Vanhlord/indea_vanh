import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertSafeMediaUrl, assertSafeMediaUrlSync } from '../../services/downloader/urlSafety.js';

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

export const handleTikTokDownload = async (req, res) => {
    const { fileUrl, type, fileName: customName } = req.body;
    let targetPath = null;

    try {
        if (!fileUrl) {
            return res.status(400).json({ error: 'Thiếu link!' });
        }

        const safeFileUrl = (await assertSafeMediaUrl(fileUrl)).toString();

        // Định dạng đuôi file tùy theo loại
        const extension = type === 'video' ? 'mp4' : (type === 'music' ? 'mp3' : 'jpg');
        const uniqueId = Date.now() + Math.random().toString(36).substr(2, 9);
        const baseName = customName
            ? sanitizeFileBaseName(customName, `tiktok_${uniqueId}`)
            : `tiktok_${uniqueId}`;
        const fileName = `${baseName}.${extension}`;

        // Chọn thư mục dựa trên loại: video -> 'video', music -> 'mp3', image -> 'temp'
        const folder = type === 'video' ? 'video' : (type === 'music' ? 'mp3' : 'temp');
        const targetDir = path.resolve(__dirname, folder);
        targetPath = path.join(targetDir, fileName);

        // Tạo thư mục nếu chưa có
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        console.log(`📥 Downloading TikTok ${type}: ${fileUrl}`);

        // Download với timeout và headers
        const response = await axios({
            method: 'get',
            url: safeFileUrl,
            responseType: 'stream',
            timeout: 30000, // 30s timeout
            maxRedirects: 3,
            beforeRedirect: (options) => {
                const protocol = options.protocol || 'https:';
                const host = options.hostname || options.host || '';
                const port = options.port ? `:${options.port}` : '';
                const pathname = options.path || '/';
                assertSafeMediaUrlSync(`${protocol}//${host}${port}${pathname}`);
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });

        const writer = fs.createWriteStream(targetPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log(`✅ Downloaded to: ${targetPath}`);

        // Set headers cho download
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', type === 'music' ? 'audio/mpeg' : (type === 'video' ? 'video/mp4' : 'image/jpeg'));
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // Stream file về client
        const fileStream = fs.createReadStream(targetPath);
        fileStream.pipe(res);

        // Xóa file sau khi gửi xong
        fileStream.on('close', () => {
            console.log(`✅ File sent: ${fileName}, cleaning up...`);
            if (targetPath && fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                console.log(`🗑️ Deleted temp file: ${fileName}`);
            }
        });

        fileStream.on('error', (err) => {
            console.error('❌ Lỗi đọc file:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Lỗi đọc file!' });
            }
            // Cleanup on error
            if (targetPath && fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
            }
        });

    } catch (error) {
        console.error('❌ Lỗi xử lý TikTok download:', error.message);
        
        // Cleanup on error
        if (targetPath && fs.existsSync(targetPath)) {
            try {
                fs.unlinkSync(targetPath);
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        if (!res.headersSent) {
            if (error.code === 'ECONNABORTED') {
                res.status(504).json({ error: 'Timeout khi tải file từ TikTok!' });
            } else if (error.response?.status === 403) {
                res.status(403).json({ error: 'TikTok chặn truy cập, thử lại sau!' });
            } else {
                res.status(500).json({ error: 'Lỗi xử lý file trên server: ' + error.message });
            }
        }
    }
};

/**
 * Get TikTok video info from tikwm.com API
 * @param {string} url - TikTok video URL
 * @returns {Promise<Object>} Video metadata
 */
export const getTikTokInfo = async (url) => {
    try {
        if (!url) {
            throw new Error('Thiếu URL TikTok!');
        }

        console.log(`🔍 Fetching TikTok info for: ${url}`);

        const response = await axios({
            method: 'get',
            url: `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`,
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });

        if (response.data && response.data.code === 0 && response.data.data) {
            const data = response.data.data;
            return {
                success: true,
                data: {
                    title: data.title || '',
                    author: data.author?.nickname || '',
                    avatar: data.author?.avatar || '',
                    play: data.play || '',
                    music: data.music || '',
                    images: data.images || [],
                    duration: data.duration || 0,
                    wmplay: data.wmplay || '',
                    hdplay: data.hdplay || ''
                }
            };
        } else {
            throw new Error(response.data?.msg || 'Không thể lấy thông tin video');
        }
    } catch (error) {
        console.error('❌ Lỗi lấy thông tin TikTok:', error.message);
        throw new Error('Lỗi kết nối đến TikTok API: ' + error.message);
    }
};
