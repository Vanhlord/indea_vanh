import express from 'express';
import webpush from 'web-push';
import { getData, insertData, updateData } from '../modules/database.js';

const router = express.Router();

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(
        'mailto:admin@vanhmcpe.top',
        vapidPublicKey,
        vapidPrivateKey
    );
}

// Admin check middleware (helper since we aren't refactoring server.js yet)
const parseIdSet = (rawValue) => {
    return new Set(
        String(rawValue || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
    );
};
let ADMIN_IDS = null;
const isAdmin = (userId) => {
    if (!ADMIN_IDS) {
        ADMIN_IDS = parseIdSet(process.env.ADMIN_ID || process.env.DISCORD_ADMIN_ID || '');
    }
    return userId && ADMIN_IDS.has(String(userId));
};

// Subscribe
router.post('/subscribe', async (req, res) => {
    const subscription = req.body;
    const userId = req.session?.user?.id || null;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: 'Invalid subscription object' });
    }

    try {
        const existing = await getData('push_subscriptions', { endpoint: subscription.endpoint });
        if (existing.length === 0) {
            await insertData('push_subscriptions', {
                user_id: userId,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                created_at: new Date().toISOString()
            });
        } else if (userId && existing[0].user_id !== userId) {
            await updateData('push_subscriptions', { user_id: userId }, { endpoint: subscription.endpoint });
        }
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Error saving subscription:', error);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

// Get subscription count (Admin only)
router.get('/count', async (req, res) => {
    const userId = req.session?.user?.id;
    if (!isAdmin(userId)) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    try {
        const subscriptions = await getData('push_subscriptions');
        res.json({ success: true, count: subscriptions.length });
    } catch (error) {
        console.error('Error getting subscription count:', error);
        res.status(500).json({ error: 'Failed to get subscription count' });
    }
});

// Broadcast (Admin only)
router.post('/broadcast', async (req, res) => {
    const userId = req.session?.user?.id;
    if (!isAdmin(userId)) {
        return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const { title, body, icon, url } = req.body;
    
    try {
        const subscriptions = await getData('push_subscriptions');
        const payload = JSON.stringify({
            title: title || 'Thông báo mới',
            body: body || '',
            icon: icon || 'https://vanhmcpe.top/photos/raw/anh-nhom/123.png',
            url: url || 'https://vanhmcpe.top/'
        });

        const results = await Promise.allSettled(
            subscriptions.map(sub => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth
                    }
                };
                return webpush.sendNotification(pushSubscription, payload);
            })
        );
        
        let successCount = 0;
        let failureCount = 0;

        results.forEach(res => {
            if (res.status === 'fulfilled') successCount++;
            else failureCount++;
        });

        res.json({ success: true, successCount, failureCount, total: subscriptions.length });
    } catch (error) {
        console.error('Error broadcasting notifications:', error);
        res.status(500).json({ error: 'Failed to broadcast notifications' });
    }
});

export default router;
