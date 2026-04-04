import { Router } from 'express';
import { getRecentMessages, clearHistory } from '../services/chatService.js';

const router = Router();

function requireAuthenticatedUser(req, res, next) {
    if (!req.session?.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
}

// GET /api/chat/history - Get chat history
router.get('/history', async (req, res) => {
    try {
        const messages = getRecentMessages(50);
        res.json({
            success: true,
            messages,
            total: messages.length
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy lịch sử chat' });
    }
});

// POST /api/chat/clear - Clear chat history
router.post('/clear', requireAuthenticatedUser, async (req, res) => {
    try {
        await clearHistory();
        res.json({ success: true, message: 'Đã xóa lịch sử chat' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi xóa lịch sử chat' });
    }
});

export default router;
