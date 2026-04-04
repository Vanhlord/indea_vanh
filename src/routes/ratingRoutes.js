import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RATINGS_FILE = path.join(__dirname, '../../json/ratings.json');
const EMPTY_DISTRIBUTION = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };

function getSessionUser(req) {
    const userId = String(req.session?.user?.id || '').trim();
    if (!userId) return null;
    return {
        id: userId,
        username: String(req.session?.user?.username || 'Anonymous').trim() || 'Anonymous',
        avatar: String(req.session?.user?.avatar || '').trim()
    };
}

function createEmptyRatingsState() {
    return {
        ratings: [],
        stats: {
            average: 0,
            total: 0,
            distribution: { ...EMPTY_DISTRIBUTION }
        }
    };
}

// Đọc dữ liệu ratings
async function readRatings() {
    try {
        const data = await fs.readFile(RATINGS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        const normalizedRatings = Array.isArray(parsed?.ratings) ? parsed.ratings : [];
        const normalizedStats = parsed?.stats && typeof parsed.stats === 'object'
            ? parsed.stats
            : calculateStats(normalizedRatings);

        return {
            ratings: normalizedRatings,
            stats: normalizedStats
        };
    } catch (e) {
        return createEmptyRatingsState();
    }
}

// Ghi dữ liệu ratings
async function writeRatings(data) {
    await fs.writeFile(RATINGS_FILE, JSON.stringify(data, null, 2));
}

// Tính toán thống kê
function calculateStats(ratings) {
    const total = ratings.length;
    if (total === 0) {
        return { average: 0, total: 0, distribution: { ...EMPTY_DISTRIBUTION } };
    }
    
    const sum = ratings.reduce((acc, r) => acc + r.rating, 0);
    const distribution = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    
    ratings.forEach(r => {
        const key = String(r.rating);
        if (distribution[key] !== undefined) {
            distribution[key]++;
        }
    });
    
    return {
        average: sum / total,
        total: total,
        distribution: distribution
    };
}

// GET /api/ratings/stats - Lấy thống kê đánh giá
router.get('/stats', async (req, res) => {
    try {
        const data = await readRatings();
        res.json(data.stats);
    } catch (e) {
        console.error('Error getting rating stats:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/ratings - Gửi đánh giá mới
router.post('/', async (req, res) => {
    try {
        const { rating, comment, timestamp } = req.body;
        const sessionUser = getSessionUser(req);
        if (!sessionUser) {
            return res.status(401).json({ message: 'Bạn cần đăng nhập để đánh giá.' });
        }
        
        // Validate
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
        }
        
        const data = await readRatings();
        
        // Kiểm tra đã đánh giá chưa
        const existingIndex = data.ratings.findIndex(r => r.userId === sessionUser.id);
        
        const newRating = {
            userId: sessionUser.id,
            userName: sessionUser.username,
            userAvatar: sessionUser.avatar,
            rating: parseInt(rating),
            comment: comment || '',
            timestamp: timestamp || new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            // Cập nhật đánh giá cũ
            data.ratings[existingIndex] = newRating;
        } else {
            // Thêm đánh giá mới
            data.ratings.push(newRating);
        }
        
        // Tính lại thống kê
        data.stats = calculateStats(data.ratings);
        
        // Lưu file
        await writeRatings(data);
        
        res.json({ 
            success: true, 
            message: existingIndex >= 0 ? 'Đã cập nhật đánh giá!' : 'Cảm ơn bạn đã đánh giá!',
            stats: data.stats
        });
        
    } catch (e) {
        console.error('Error submitting rating:', e);
        res.status(500).json({ message: 'Có lỗi xảy ra, vui lòng thử lại!' });
    }
});

// GET /api/ratings - Lấy danh sách đánh giá (có thể phân trang)
router.get('/', async (req, res) => {
    try {
        const data = await readRatings();
        const { limit = 10, offset = 0 } = req.query;
        const safeLimit = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 10));
        const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);

        const commentsOnly = String(req.query.commentsOnly || '0') === '1';
        const source = commentsOnly
            ? data.ratings.filter((r) => String(r?.comment || '').trim().length > 0)
            : [...data.ratings];

        const ratings = [...source]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(safeOffset, safeOffset + safeLimit);
        
        res.json({
            ratings,
            total: source.length,
            stats: data.stats
        });
    } catch (e) {
        console.error('Error getting ratings:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/ratings/:timestamp - Xóa đánh giá của người dùng
router.delete('/:timestamp', async (req, res) => {
    try {
        const { timestamp } = req.params;
        const sessionUser = getSessionUser(req);
        
        if (!sessionUser) {
            return res.status(401).json({ message: 'Bạn cần đăng nhập để xóa đánh giá.' });
        }
        
        const data = await readRatings();
        
        // Tìm đánh giá cần xóa
        const ratingIndex = data.ratings.findIndex(r => 
            r.timestamp === timestamp && r.userId === sessionUser.id
        );
        
        if (ratingIndex === -1) {
            return res.status(404).json({ message: 'Không tìm thấy đánh giá' });
        }
        
        // Xóa đánh giá
        data.ratings.splice(ratingIndex, 1);
        
        // Tính lại thống kê
        data.stats = calculateStats(data.ratings);
        
        // Lưu file
        await writeRatings(data);
        
        res.json({ 
            success: true, 
            message: 'Đã xóa đánh giá thành công!',
            stats: data.stats
        });
        
    } catch (e) {
        console.error('Error deleting rating:', e);
        res.status(500).json({ message: 'Có lỗi xảy ra khi xóa đánh giá!' });
    }
});

export default router;
