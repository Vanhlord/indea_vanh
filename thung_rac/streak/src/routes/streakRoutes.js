import express from 'express';
import {
    loadStreaks,
    getStartOfDay,
    updateStreaks,
    checkInStreak
} from '../services/streakService.js';
import { sendDirectMessage } from '../../bot/bot2.js';

const router = express.Router();
const STREAK_ADMIN_IDS = new Set(
    String(process.env.STREAK_ADMIN_IDS || process.env.DISCORD_ADMIN_IDS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
);

function requireAdminUser(req, res, next) {
    const userId = String(req.session?.user?.id || '').trim();
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (STREAK_ADMIN_IDS.size === 0) {
        return res.status(503).json({ error: 'Admin allowlist is not configured' });
    }
    if (!STREAK_ADMIN_IDS.has(userId)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
}

// Get all streaks (leaderboard)
router.get('/', async (req, res) => {
    try {
        const { sort = 'streak' } = req.query;
        const now = new Date();
        const data = await loadStreaks(now);
        
        // Sort streaks
        const sortedStreaks = [...data.streaks];
        if (sort === 'streak') {
            sortedStreaks.sort((a, b) => b.currentStreak - a.currentStreak);
        } else if (sort === 'total') {
            sortedStreaks.sort((a, b) => b.totalCheckIns - a.totalCheckIns);
        }
        
        // Calculate stats
        const today = getStartOfDay(now);
        
        const stats = {
            totalUsers: data.streaks.length,
            avgStreak: data.streaks.length > 0 
                ? Math.round(data.streaks.reduce((sum, s) => sum + s.currentStreak, 0) / data.streaks.length * 10) / 10
                : 0,
            topStreak: data.streaks.length > 0 
                ? Math.max(...data.streaks.map(s => s.currentStreak))
                : 0,
            todayCheckins: data.streaks.filter(s => {
                if (!s.lastCheckIn) return false;
                const lastCheckin = new Date(s.lastCheckIn);
                return lastCheckin >= today;
            }).length
        };
        
        res.json({
            streaks: sortedStreaks,
            stats
        });
    } catch (e) {
        console.error('Error getting streaks:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get my streak (requires auth)
router.get('/me', async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const userId = req.session.user.id;
        let userStreak = null;

        await updateStreaks(new Date(), 30, (data) => {
            userStreak = data.streaks.find(s => s.userId === userId);

            if (!userStreak) {
                userStreak = {
                    userId: userId,
                    username: req.session.user.username,
                    avatar: req.session.user.avatar,
                    currentStreak: 0,
                    maxStreak: 0,
                    lastCheckIn: null,
                    totalCheckIns: 0,
                    history: []
                };
                data.streaks.push(userStreak);
            }

            return data;
        });

        res.json(userStreak);
    } catch (e) {
        console.error('Error getting my streak:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check in (requires auth)
router.post('/checkin', async (req, res) => {
    try {
        // Check if user is logged in
        if (!req.session?.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const userId = req.session.user.id;
        const now = new Date();
        const today = getStartOfDay(now);
        
        const result = await checkInStreak({
            userId,
            username: req.session.user.username,
            avatar: req.session.user.avatar,
            banner: req.session.user.banner || null
        }, now);

        if (!result.ok) {
            return res.status(400).json({
                error: result.error,
                currentStreak: result.currentStreak || 0,
                nextCheckin: result.nextCheckin || new Date(today.getTime() + 86400000)
            });
        }

        res.json({
            success: true,
            currentStreak: result.userStreak.currentStreak,
            maxStreak: result.userStreak.maxStreak,
            totalCheckIns: result.userStreak.totalCheckIns,
            message: `🔥 +1 Streak! Current: ${result.userStreak.currentStreak} days`
        });

        const dmMessage = `✅ Bạn đã điểm danh hôm nay!\nStreak hiện tại: ${result.userStreak.currentStreak} ngày.\nStreak cao nhất: ${result.userStreak.maxStreak} ngày.`;
        sendDirectMessage(userId, { content: dmMessage }).catch((error) => {
            console.warn('[Streak] Failed to send DM confirmation:', error?.message || error);
        });
        
    } catch (e) {
        console.error('Error checking in:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin: Reset streak
router.post('/admin/reset', requireAdminUser, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }
        
        let found = false;

        await updateStreaks(new Date(), 30, (data) => {
            const userStreak = data.streaks.find(s => s.userId === userId);

            if (!userStreak) {
                return data;
            }

            found = true;
            userStreak.currentStreak = 0;
            userStreak.maxStreak = 0;
            userStreak.lastCheckIn = null;
            userStreak.totalCheckIns = 0;
            userStreak.history = [];
            return data;
        });

        if (!found) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, message: 'Streak reset' });
    } catch (e) {
        console.error('Error resetting streak:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
