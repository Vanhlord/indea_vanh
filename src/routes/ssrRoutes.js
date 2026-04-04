/**
 * Server-Side Rendering Routes
 * These routes demonstrate secure server-side rendering with EJS
 * All API calls and data processing happens on the server
 * Client receives pre-rendered HTML with no exposed secrets
 */

import express from 'express';
import { getToolUsageSummary } from '../services/toolUsageService.js';

const router = express.Router();

/**
 * Leaderboard Page (Server-Side Rendered)
 * All data is fetched server-side and injected into EJS template
 * ❌ No API calls from client-side JavaScript
 * ❌ No exposed secrets in Network tab
 * ✅ Fully server-rendered HTML
 */
router.get('/leaderboard-ssr', async (req, res) => {
    try {
        const summary = await getToolUsageSummary();
        const ranking = Array.isArray(summary?.ranking) ? summary.ranking : [];
        const leaderboard = ranking.map((item) => ({
            username: item?.label || 'Unknown',
            downloads: Number(item?.downloads || 0),
            platform: item?.tool || 'unknown',
            lastUsed: item?.lastDownloadedAt || null
        }));

        const totalDownloads = leaderboard.reduce((sum, item) => sum + item.downloads, 0);
        const totalTools = leaderboard.length;
        const topUsers = Math.min(totalTools, 10);

        // All data is ready before rendering
        // Client receives complete HTML with no async operations
        res.render('leaderboard', {
            leaderboard,
            totalDownloads,
            totalTools,
            topUsers,
            pageTitle: 'Leaderboard - Server-Side Rendered'
        });
    } catch (error) {
        console.error('SSR Leaderboard error:', error);
        res.render('leaderboard', {
            leaderboard: [],
            totalDownloads: 0,
            totalTools: 0,
            topUsers: 0,
            error: 'Không thể tải dữ liệu leaderboard'
        });
    }
});

/**
 * Status Server Page (Server-Side Rendered)
 * All server status checks happen server-side
 * Client never sees API endpoints or keys
 */
router.get('/status-ssr', async (req, res) => {
    try {
        // Import server status service (server-side only)
        const { getServerResources } = await import('../services/pikamcService.js');
        const { getSecondaryServerResources } = await import('../services/secondaryPterodactylService.js');
        const { getPlayerStats } = await import('../services/playerService.js');

        // Fetch all data in parallel
        const [pikamcData, pterodactylData, playersData] = await Promise.allSettled([
            getServerResources(),
            getSecondaryServerResources(),
            getPlayerStats()
        ]);

        // Process PikaMC data
        const pikamc = {
            online: pikamcData.status === 'fulfilled',
            playerCount: pikamcData.value?.data?.players?.count || 0,
            maxPlayers: pikamcData.value?.data?.players?.max || 30,
            ramUsage: pikamcData.value?.data?.resources?.ram || 0,
            cpuUsage: pikamcData.value?.data?.resources?.cpu || 0
        };

        // Process Pterodactyl data
        const pterodactyl = {
            online: pterodactylData.status === 'fulfilled' && !pterodactylData.value?.error,
            playerCount: pterodactylData.value?.data?.players || 0,
            ramUsage: pterodactylData.value?.data?.memory_bytes 
                ? Math.round(pterodactylData.value.data.memory_bytes / 1024 / 1024)
                : 0,
            uptime: pterodactylData.value?.data?.uptime || 0
        };

        // Process players data
        const stats = {
            requestsToday: playersData.status === 'fulfilled'
                ? Number(playersData.value?.total || playersData.value?.players?.length || 0)
                : 0,
            apiCalls: 0
        };

        // Disk usage would normally come from system calls
        const diskUsage = {
            usedPercent: 45,
            totalGB: 500,
            freeGB: 275
        };

        // Cloud stats
        const cloudStats = {
            totalFiles: 0,
            totalSize: '0'
        };

        // All data is ready before rendering to HTML
        res.render('status-server', {
            pikamc,
            pterodactyl,
            diskUsage,
            cloudStats,
            stats,
            pageTitle: 'Status Server - Server-Side Rendered'
        });
    } catch (error) {
        console.error('SSR Status error:', error);
        res.render('status-server', {
            pikamc: { online: false },
            pterodactyl: { online: false },
            diskUsage: { usedPercent: 0, totalGB: 0, freeGB: 0 },
            cloudStats: { totalFiles: 0, totalSize: '0' },
            stats: { requestsToday: 0, apiCalls: 0 },
            error: 'Không thể tải trạng thái server'
        });
    }
});

export default router;
