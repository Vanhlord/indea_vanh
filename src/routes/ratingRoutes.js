import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RATINGS_FILE = path.join(__dirname, '../../json/ratings.json');
const RATINGS_LOCK_FILE = `${RATINGS_FILE}.lock`;
const EMPTY_DISTRIBUTION = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 60;
const LOCK_STALE_MS = 10000;

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

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRatingsLock(work) {
    const startedAt = Date.now();
    let lockHandle = null;

    await fs.mkdir(path.dirname(RATINGS_FILE), { recursive: true });

    while (!lockHandle) {
        try {
            lockHandle = await fs.open(RATINGS_LOCK_FILE, 'wx');
            await lockHandle.writeFile(String(process.pid));
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const stat = await fs.stat(RATINGS_LOCK_FILE).catch(() => null);
            if (stat && (Date.now() - stat.mtimeMs) > LOCK_STALE_MS) {
                await fs.rm(RATINGS_LOCK_FILE, { force: true }).catch(() => {});
                continue;
            }

            if ((Date.now() - startedAt) > LOCK_TIMEOUT_MS) {
                throw new Error('Ratings file is busy');
            }

            await sleep(LOCK_RETRY_MS);
        }
    }

    try {
        return await work();
    } finally {
        try {
            await lockHandle.close();
        } catch (_error) {
            // Ignore lock cleanup errors.
        }
        await fs.rm(RATINGS_LOCK_FILE, { force: true }).catch(() => {});
    }
}

async function writeRatingsAtomic(data) {
    await fs.mkdir(path.dirname(RATINGS_FILE), { recursive: true });
    const tmpPath = `${RATINGS_FILE}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, RATINGS_FILE);
}

async function mutateRatings(mutator) {
    return withRatingsLock(async () => {
        const data = await readRatings();
        const result = await mutator(data);
        await writeRatingsAtomic(data);
        return result;
    });
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
        
        const result = await mutateRatings(async (data) => {
            const existingIndex = data.ratings.findIndex(r => r.userId === sessionUser.id);
            const newRating = {
                userId: sessionUser.id,
                userName: sessionUser.username,
                userAvatar: sessionUser.avatar,
                rating: parseInt(rating, 10),
                comment: comment || '',
                timestamp: timestamp || new Date().toISOString()
            };

            if (existingIndex >= 0) {
                data.ratings[existingIndex] = newRating;
            } else {
                data.ratings.push(newRating);
            }

            data.stats = calculateStats(data.ratings);
            return {
                existed: existingIndex >= 0,
                stats: data.stats
            };
        });
        
        res.json({ 
            success: true, 
            message: result.existed ? 'Đã cập nhật đánh giá!' : 'Cảm ơn bạn đã đánh giá!',
            stats: result.stats
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
        
        const result = await mutateRatings(async (data) => {
            const ratingIndex = data.ratings.findIndex(r =>
                r.timestamp === timestamp && r.userId === sessionUser.id
            );

            if (ratingIndex === -1) {
                return null;
            }

            data.ratings.splice(ratingIndex, 1);
            data.stats = calculateStats(data.ratings);
            return { stats: data.stats };
        });

        if (!result) {
            return res.status(404).json({ message: 'Không tìm thấy đánh giá' });
        }
        
        res.json({ 
            success: true, 
            message: 'Đã xóa đánh giá thành công!',
            stats: result.stats
        });
        
    } catch (e) {
        console.error('Error deleting rating:', e);
        res.status(500).json({ message: 'Có lỗi xảy ra khi xóa đánh giá!' });
    }
});

export default router;
