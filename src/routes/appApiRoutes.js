import path from 'path';
import { readFile, statfs } from 'fs/promises';

import statusRoute, { getNetworkHistory } from '../modules/status/status.js';
import snapsaveRoute from '../modules/downloader/facebook.js';
import authRoutes from '../modules/auth/oauth.js';
import { handleYoutubeDownload, getYoutubeInfo } from '../modules/downloader/youtube.js';
import { handleSoundCloudDownload, getSoundCloudInfo } from '../modules/downloader/soundcloud.js';
import { proxyDownload as proxyDownloadUnified } from '../controllers/downloaderController.js';
import albumRoutes from './albumRoutes.js';
import cloudRoutes from './cloudRoutes.js';
import ssrRoutes from './ssrRoutes.js';
import {
    getPikamcConfig,
    savePikamcConfig,
    toPublicConfig,
    applyConfigOverrides
} from '../services/pikamcConfigService.js';
import { sendConsoleCommand, getServerResources } from '../services/pikamcService.js';
import { getSecondaryServerResources } from '../services/secondaryPterodactylService.js';
import { getPlayerStats } from '../services/playerService.js';
import { getToolUsageSummary } from '../services/toolUsageService.js';
import { getDonations } from '../services/donateService.js';
import {
    ROOT_DIR,
    PIKAMC_IP,
    PIKAMC_PORT,
    WHITELIST_COMMAND_TEMPLATE,
    WHITELIST_REMOVE_COMMAND_TEMPLATE
} from '../config/index.js';
import { sendEmbed, isBotReady } from '../../bot/bot2.js';
import {
    deleteSiteSetting,
    getPublicSiteSettings,
    getSiteSettings,
    upsertSiteSettings
} from '../services/siteSettingsService.js';

function getDiskUsageCandidates() {
    return [
        process.env.DISK_USAGE_PATH?.trim(),
        path.parse(ROOT_DIR || process.cwd()).root,
        path.parse(process.cwd()).root,
        'C:\\'
    ].filter(Boolean);
}

async function getDiskUsageForAvailablePath() {
    let lastError = null;

    for (const targetPath of [...new Set(getDiskUsageCandidates())]) {
        try {
            const stats = await statfs(targetPath);
            return { targetPath, stats };
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
            lastError = error;
        }
    }

    throw lastError ?? new Error('No accessible disk path found for disk usage');
}

export function registerAppApiRoutes(app, deps) {
    const {
        isAdminUserId,
        requireEmbedAuthorization,
        requireAdminPageAccess,
        toSafeDisplayText,
        readJsonWithFallback,
        writeJson,
        serverStatusFile,
        countdownSettingsFile,
        defaultVapidPublicKey,
        readMinecraftDownloads,
        writeMinecraftDownloads,
        listMinecraftFiles,
        createDownloadId,
        sanitizeAdminText,
        sanitizePanelUrl,
        sanitizeServerId,
        sanitizeCommandTemplate,
        sanitizeWhitelistKey,
        sanitizeGamertag,
        normalizeGamertag,
        buildWhitelistCommand,
        buildWhitelistRemoveCommand,
        buildStrengthEffectCommands,
        whitelistStatements,
        touchAndListRecentUsers,
        recentUsersDefaultLimit,
        furinaQuotesFile
    } = deps;

    app.get('/api/user-info', (req, res) => {
        if (req.session && req.session.user) {
            const userId = String(req.session.user.id || '').trim();
            res.json({
                loggedIn: true,
                username: req.session.user.username,
                avatar: req.session.user.avatar,
                id: userId,
                isAdmin: isAdminUserId(userId)
            });
        } else {
            res.json({ loggedIn: false, isAdmin: false });
        }
    });

    app.get('/api/user/bits', (req, res) => {
        if (!req.session?.user?.id) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        return res.json({ success: true, bits: 0 });
    });

    app.get('/api/config/site-settings', async (_req, res) => {
        try {
            const payload = await getPublicSiteSettings();
            return res.json({ success: true, ...payload });
        } catch (error) {
            console.error('Load public site settings error:', error);
            return res.status(500).json({ success: false, error: 'Khong the tai cau hinh cong khai.' });
        }
    });

    app.get('/api/config/server-status', async (_req, res) => {
        const fallback = { maxPlayers: 50 };
        const parsed = await readJsonWithFallback(serverStatusFile, fallback);
        const publicSettings = await getPublicSiteSettings().catch(() => null);
        const payload = {
            ip: toSafeDisplayText(publicSettings?.minecraft?.ip, 120, PIKAMC_IP),
            port: toSafeDisplayText(publicSettings?.minecraft?.port, 12, PIKAMC_PORT),
            maxPlayers: Number.isFinite(Number(parsed?.maxPlayers))
                ? Math.max(1, Math.min(5000, Math.floor(Number(parsed.maxPlayers))))
                : fallback.maxPlayers
        };
        return res.json(payload);
    });

    app.get('/api/config/countdown-settings', async (_req, res) => {
        const fallback = { eventDate: '19/09/2026', eventTime: '00:00', eventDescription: 'VNA Event' };
        const parsed = await readJsonWithFallback(countdownSettingsFile, fallback);
        const payload = {
            eventDate: toSafeDisplayText(parsed?.eventDate, 20, fallback.eventDate),
            eventTime: toSafeDisplayText(parsed?.eventTime, 8, fallback.eventTime),
            eventDescription: toSafeDisplayText(parsed?.eventDescription, 120, fallback.eventDescription)
        };
        return res.json(payload);
    });

    app.post('/api/admin/countdown-settings', requireAdminPageAccess, async (req, res) => {
        try {
            const eventDate = sanitizeAdminText(req.body?.eventDate, 20);
            const eventTime = sanitizeAdminText(req.body?.eventTime, 8);
            const eventDescription = sanitizeAdminText(req.body?.eventDescription, 120);

            if (!eventDate || !eventTime) {
                return res.status(400).json({ success: false, error: 'Thiếu ngày hoặc giờ sự kiện.' });
            }

            const nextConfig = { eventDate, eventTime, eventDescription };
            await writeJson(countdownSettingsFile, nextConfig);

            return res.json({ success: true, data: nextConfig });
        } catch (error) {
            console.error('Save countdown settings error:', error);
            return res.status(500).json({ success: false, error: 'Không thể lưu cấu hình thời gian.' });
        }
    });

    app.get('/api/config/vapid-public', (_req, res) => {
        const vapidKey = process.env.VAPID_PUBLIC_KEY || defaultVapidPublicKey;
        res.json({ key: vapidKey });
    });

    app.get('/api/pikamc/status', async (_req, res) => {
        const publicSettings = await getPublicSiteSettings().catch(() => null);
        const ip = publicSettings?.minecraft?.ip || PIKAMC_IP;
        const port = publicSettings?.minecraft?.port || PIKAMC_PORT;
        const apiKey = process.env.PIKAMC_API_KEY || '';

        let ramUsageStr = '0 MB';
        const ramTotalStr = '4096 MB';

        try {
            if (apiKey) {
                const { data } = await getServerResources();
                if (data && data.attributes && data.attributes.resources) {
                    const memBytes = data.attributes.resources.memory_bytes || 0;
                    const memMB = Math.round(memBytes / (1024 * 1024));
                    ramUsageStr = `${memMB} MB`;
                } else {
                    throw new Error('Invalid Pterodactyl data');
                }
            } else {
                throw new Error('No API key');
            }
        } catch (_error) {
            const mockRamBase = apiKey ? 3100 : 2600;
            const randomFluctuation = Math.round(Math.random() * 500 - 200);
            ramUsageStr = `${mockRamBase + randomFluctuation} MB`;
        }

        res.json({
            success: true,
            ip,
            port,
            ram: {
                usage: ramUsageStr,
                total: ramTotalStr
            }
        });
    });

    app.get('/api/pikamc/server-resources', async (_req, res) => {
        try {
            const { data, cached } = await getServerResources();
            res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
            res.json(data);
        } catch (err) {
            console.error('Error fetching PikaMC resources:', err);
            res.status(500).json({ error: 'fetch_error', detail: err.message });
        }
    });

    app.get('/api/pterodactyl/server2/resources', async (_req, res) => {
        try {
            const { data, cached, configured } = await getSecondaryServerResources();
            res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
            if (!configured) {
                return res.status(503).json(data);
            }
            return res.json(data);
        } catch (err) {
            const statusCode = err.status || 500;
            console.error(`[SecondaryPterodactyl] Route error (status ${statusCode}):`, err.message);
            return res.status(statusCode).json({
                error: 'fetch_error',
                detail: err.message,
                configured: true
            });
        }
    });

    app.get('/api/players', async (_req, res) => {
        try {
            const stats = await getPlayerStats();
            res.json(stats);
        } catch (error) {
            console.error('Error fetching players:', error);
            res.status(500).json({ error: 'fetch_error', detail: error.message });
        }
    });

    app.get('/api/disk-usage', async (_req, res) => {
        try {
            const { targetPath, stats } = await getDiskUsageForAvailablePath();
            const total = stats.blocks * stats.bsize;
            const free = stats.bfree * stats.bsize;
            const used = total - free;

            res.json({
                success: true,
                path: targetPath,
                used,
                total,
                free
            });
        } catch (error) {
            console.error('Error getting disk usage:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.use('/api/facebook', snapsaveRoute);
    app.use('/api/status', statusRoute);
    app.use('/api/auth', authRoutes);
    app.get('/api/status/network-history', (_req, res) => {
        res.json(getNetworkHistory());
    });
    app.use('/api/album', albumRoutes);
    app.use('/api/cloud', cloudRoutes);

    app.post('/api/proxy-download', proxyDownloadUnified);
    app.post('/api/youtube-proxy', handleYoutubeDownload);
    app.get('/api/youtube-info', getYoutubeInfo);
    app.get('/api/soundcloud-info', getSoundCloudInfo);
    app.post('/api/soundcloud-proxy', handleSoundCloudDownload);

    app.use('/', ssrRoutes);

    app.get('/api/bot2/status', (_req, res) => {
        res.json({ ready: isBotReady() });
    });

    app.post('/api/discord/embed', requireEmbedAuthorization, async (req, res) => {
        try {
            const result = await sendEmbed(req.body);
            if (result.success) {
                res.json({ success: true, message: 'Embed sent successfully' });
            } else {
                res.status(500).json({ success: false, error: result.error });
            }
        } catch (error) {
            console.error('Error sending embed:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/minecraft-downloads', async (_req, res) => {
        try {
            const items = await readMinecraftDownloads();
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load minecraft downloads error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách.' });
        }
    });

    app.get('/api/admin/minecraft-downloads', requireAdminPageAccess, async (_req, res) => {
        try {
            const items = await readMinecraftDownloads();
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load admin minecraft downloads error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách.' });
        }
    });

    app.get('/api/admin/minecraft-files', requireAdminPageAccess, async (_req, res) => {
        try {
            const items = await listMinecraftFiles();
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load minecraft files error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách file.' });
        }
    });

    app.post('/api/admin/minecraft-downloads', requireAdminPageAccess, async (req, res) => {
        try {
            const title = sanitizeAdminText(req.body?.title, 120);
            const version = sanitizeAdminText(req.body?.version, 140);
            const url = sanitizeAdminText(req.body?.url, 500);

            if (!title || !url) {
                return res.status(400).json({ success: false, error: 'Thiếu tiêu đề hoặc link tải.' });
            }

            const urlOk = /^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(url);
            if (!urlOk) {
                return res.status(400).json({ success: false, error: 'Link tải không hợp lệ.' });
            }

            const items = await readMinecraftDownloads();
            if (items.some((item) => item?.url === url)) {
                return res.status(409).json({ success: false, error: 'Link này đã tồn tại.' });
            }

            const newItem = {
                id: createDownloadId(),
                title,
                version,
                url,
                createdAt: new Date().toISOString()
            };

            const nextItems = [newItem, ...items];
            await writeMinecraftDownloads(nextItems);

            return res.json({ success: true, item: newItem });
        } catch (error) {
            console.error('Add minecraft download error:', error);
            return res.status(500).json({ success: false, error: 'Không thể thêm nút tải.' });
        }
    });

    app.delete('/api/admin/minecraft-downloads/:id', requireAdminPageAccess, async (req, res) => {
        try {
            const id = String(req.params.id || '').trim();
            if (!id) {
                return res.status(400).json({ success: false, error: 'Thiếu id cần xóa.' });
            }

            const items = await readMinecraftDownloads();
            const nextItems = items.filter((item) => item?.id !== id);
            if (nextItems.length === items.length) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
            }

            await writeMinecraftDownloads(nextItems);
            return res.json({ success: true });
        } catch (error) {
            console.error('Delete minecraft download error:', error);
            return res.status(500).json({ success: false, error: 'Không thể xóa nút tải.' });
        }
    });

    app.get('/api/admin/pikamc-config', requireAdminPageAccess, async (_req, res) => {
        try {
            const config = await getPikamcConfig();
            return res.json({ success: true, data: toPublicConfig(config) });
        } catch (error) {
            console.error('Load PikaMC config error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải cấu hình PikaMC.' });
        }
    });

    app.post('/api/admin/pikamc-config', requireAdminPageAccess, async (req, res) => {
        try {
            const current = await getPikamcConfig();
            const overrides = {
                panelUrl: sanitizePanelUrl(req.body?.panelUrl),
                serverId: sanitizeServerId(req.body?.serverId),
                apiKey: sanitizeAdminText(req.body?.apiKey, 200),
                whitelistCommandTemplate: sanitizeCommandTemplate(req.body?.whitelistCommandTemplate),
                whitelistRemoveCommandTemplate: sanitizeCommandTemplate(req.body?.whitelistRemoveCommandTemplate)
            };

            const next = applyConfigOverrides(current, overrides);
            if (!next.panelUrl) {
                return res.status(400).json({ success: false, error: 'Link panel không hợp lệ.' });
            }
            if (!next.serverId) {
                return res.status(400).json({ success: false, error: 'Server ID không hợp lệ.' });
            }
            if (!next.apiKey) {
                return res.status(400).json({ success: false, error: 'API key không được để trống.' });
            }

            const saved = await savePikamcConfig({
                ...next,
                whitelistCommandTemplate: next.whitelistCommandTemplate || WHITELIST_COMMAND_TEMPLATE,
                whitelistRemoveCommandTemplate: next.whitelistRemoveCommandTemplate || WHITELIST_REMOVE_COMMAND_TEMPLATE
            });

            return res.json({ success: true, data: toPublicConfig(saved) });
        } catch (error) {
            console.error('Save PikaMC config error:', error);
            return res.status(500).json({ success: false, error: 'Không thể lưu cấu hình PikaMC.' });
        }
    });

    app.get('/api/admin/site-settings', requireAdminPageAccess, async (_req, res) => {
        try {
            const items = await getSiteSettings();
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load admin site settings error:', error);
            return res.status(500).json({ success: false, error: 'Khong the tai danh sach thong so.' });
        }
    });

    app.put('/api/admin/site-settings', requireAdminPageAccess, async (req, res) => {
        try {
            const inputItems = Array.isArray(req.body?.items) ? req.body.items : [];
            if (inputItems.length === 0) {
                return res.status(400).json({ success: false, error: 'Khong co thong so nao de luu.' });
            }

            const items = await upsertSiteSettings(inputItems);
            const itemMap = new Map(items.map((item) => [item.key, item.value]));
            const currentPikamcConfig = await getPikamcConfig();
            const nextPanelUrl = String(itemMap.get('hosting_panel_url') || '').trim();
            const nextServerId = String(itemMap.get('hosting_server_id') || '').trim();

            if (nextPanelUrl || nextServerId) {
                await savePikamcConfig({
                    ...currentPikamcConfig,
                    panelUrl: nextPanelUrl || currentPikamcConfig.panelUrl,
                    serverId: nextServerId || currentPikamcConfig.serverId
                });
            }

            return res.json({ success: true, items });
        } catch (error) {
            console.error('Save site settings error:', error);
            const message = error?.message || 'Khong the luu thong so.';
            const status = /Khong co thong so|Key khong hop le|Gia tri cua|Port Minecraft|IP Minecraft/i.test(message)
                ? 400
                : 500;
            return res.status(status).json({
                success: false,
                error: message
            });
        }
    });

    app.delete('/api/admin/site-settings/:key', requireAdminPageAccess, async (req, res) => {
        try {
            const result = await deleteSiteSetting(req.params.key);

            if (result.item?.key === 'hosting_panel_url' || result.item?.key === 'hosting_server_id') {
                const currentPikamcConfig = await getPikamcConfig();
                await savePikamcConfig({
                    ...currentPikamcConfig,
                    panelUrl: result.item.key === 'hosting_panel_url'
                        ? result.item.value || currentPikamcConfig.panelUrl
                        : currentPikamcConfig.panelUrl,
                    serverId: result.item.key === 'hosting_server_id'
                        ? result.item.value || currentPikamcConfig.serverId
                        : currentPikamcConfig.serverId
                });
            }

            return res.json({
                success: true,
                resetToDefault: result.resetToDefault,
                item: result.item
            });
        } catch (error) {
            console.error('Delete site setting error:', error);
            const message = error?.message || 'Khong the xoa thong so.';
            const status = message.includes('Khong tim thay') ? 404 : 400;
            return res.status(status).json({ success: false, error: message });
        }
    });

    app.get('/api/admin/whitelist-keys', requireAdminPageAccess, (_req, res) => {
        try {
            const items = whitelistStatements.list.all();
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load whitelist keys error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách whitelist.' });
        }
    });

    app.get('/api/whitelist/list', (_req, res) => {
        try {
            const items = whitelistStatements.list.all().map((item) => ({
                gamertag: item.gamertag,
                activated: item.status === 'used'
            }));
            return res.json({ success: true, items });
        } catch (error) {
            console.error('Load public whitelist list error:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách thành viên whitelist.' });
        }
    });

    app.post('/api/admin/whitelist-keys', requireAdminPageAccess, (req, res) => {
        try {
            const key = sanitizeWhitelistKey(req.body?.key, 64);
            const gamertag = sanitizeGamertag(req.body?.gamertag, 32);

            if (!key) {
                return res.status(400).json({ success: false, error: 'Mã không hợp lệ. Chỉ cho phép chữ/số/dấu _ - (4-64 ký tự).' });
            }
            if (!gamertag) {
                return res.status(400).json({ success: false, error: 'Gamertag không hợp lệ.' });
            }

            const existing = whitelistStatements.byKey.get(key);
            if (existing) {
                return res.status(409).json({ success: false, error: 'Mã này đã tồn tại.' });
            }

            const createdAt = new Date().toISOString();
            const gamertagNorm = normalizeGamertag(gamertag);
            const result = whitelistStatements.insert.run(key, gamertag, gamertagNorm, 'pending', createdAt);

            return res.json({
                success: true,
                item: {
                    id: result.lastInsertRowid,
                    key,
                    gamertag,
                    status: 'pending',
                    created_at: createdAt,
                    used_at: null
                }
            });
        } catch (error) {
            console.error('Add whitelist key error:', error);
            return res.status(500).json({ success: false, error: 'Không thể thêm whitelist.' });
        }
    });

    app.delete('/api/admin/whitelist-keys/:id', requireAdminPageAccess, async (req, res) => {
        try {
            const id = Number.parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(id)) {
                return res.status(400).json({ success: false, error: 'Id không hợp lệ.' });
            }

            const record = whitelistStatements.byId.get(id);
            if (!record) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
            }
            if (record.status === 'processing') {
                return res.status(409).json({ success: false, error: 'Mã này đang được kích hoạt. Vui lòng thử lại sau vài giây.' });
            }

            let removedFromServer = false;
            if (record.status === 'used') {
                const pikamcConfig = await getPikamcConfig();
                const command = buildWhitelistRemoveCommand(
                    record.gamertag,
                    pikamcConfig?.whitelistRemoveCommandTemplate,
                    pikamcConfig?.whitelistCommandTemplate
                );
                if (!command) {
                    return res.status(500).json({ success: false, error: 'Không thể tạo lệnh xóa whitelist trên server.' });
                }

                const consoleResult = await sendConsoleCommand(command);
                if (!consoleResult.success) {
                    return res.status(502).json({
                        success: false,
                        error: 'Không thể gửi lệnh xóa whitelist lên panel. Chưa xóa dữ liệu local để tránh lệch trạng thái.'
                    });
                }

                removedFromServer = true;
            }

            const result = whitelistStatements.deleteById.run(id);
            if (result.changes === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy mục cần xóa.' });
            }

            return res.json({
                success: true,
                removedFromServer
            });
        } catch (error) {
            console.error('Delete whitelist key error:', error);
            return res.status(500).json({ success: false, error: 'Không thể xóa whitelist.' });
        }
    });

    app.post('/api/admin/commands/strength', requireAdminPageAccess, async (req, res) => {
        try {
            const gamertag = sanitizeGamertag(req.body?.gamertag, 32);
            if (!gamertag) {
                return res.status(400).json({ success: false, error: 'Tên người dùng không hợp lệ.' });
            }

            const commands = buildStrengthEffectCommands(gamertag);
            if (!commands.length) {
                return res.status(500).json({ success: false, error: 'Không thể tạo lệnh Strength.' });
            }

            for (const command of commands) {
                const result = await sendConsoleCommand(command);
                if (!result.success) {
                    return res.status(502).json({
                        success: false,
                        error: 'Không thể gửi lệnh Strength lên hosting.'
                    });
                }
            }

            return res.json({ success: true, message: 'Đã gửi lệnh Strength thành công.' });
        } catch (error) {
            console.error('Strength command error:', error);
            return res.status(500).json({ success: false, error: 'Lỗi server khi gửi lệnh.' });
        }
    });

    app.post('/api/whitelist/activate', async (req, res) => {
        let claimedRecordId = null;
        let commandAccepted = false;
        let activationFinished = false;

        try {
            const key = sanitizeWhitelistKey(req.body?.key, 64);
            const gamertag = sanitizeGamertag(req.body?.gamertag, 32);

            if (!key || !gamertag) {
                return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ mã và gamertag hợp lệ.' });
            }

            const record = whitelistStatements.byKey.get(key);
            if (!record) {
                return res.status(404).json({ success: false, error: 'Mã không tồn tại.' });
            }

            if (record.status !== 'pending') {
                const statusMessage = record.status === 'processing'
                    ? 'Mã này đang được kích hoạt. Vui lòng đợi vài giây rồi thử lại.'
                    : 'Mã này đã được kích hoạt.';
                return res.status(409).json({ success: false, error: statusMessage });
            }

            const inputNorm = normalizeGamertag(gamertag);
            const recordNorm = normalizeGamertag(record.gamertag_norm || record.gamertag);
            if (inputNorm !== recordNorm) {
                return res.status(403).json({ success: false, error: 'Gamertag không khớp với mã.' });
            }

            const claim = whitelistStatements.claimProcessing.run('processing', record.id, 'pending');
            if (claim.changes === 0) {
                const latestRecord = whitelistStatements.byId.get(record.id);
                if (latestRecord?.status === 'used') {
                    return res.status(409).json({ success: false, error: 'Mã này đã được kích hoạt.' });
                }
                return res.status(409).json({ success: false, error: 'Mã này đang được kích hoạt. Vui lòng đợi vài giây rồi thử lại.' });
            }
            claimedRecordId = record.id;

            const pikamcConfig = await getPikamcConfig();
            const command = buildWhitelistCommand(record.gamertag, pikamcConfig?.whitelistCommandTemplate);
            if (!command) {
                return res.status(500).json({ success: false, error: 'Lỗi tạo lệnh whitelist.' });
            }

            const result = await sendConsoleCommand(command);
            if (!result.success) {
                return res.status(502).json({ success: false, error: 'Không thể gửi lệnh whitelist. Vui lòng thử lại sau.' });
            }
            commandAccepted = true;

            const usedAt = new Date().toISOString();
            const update = whitelistStatements.markUsed.run('used', usedAt, record.id, 'processing');
            if (update.changes === 0) {
                return res.status(500).json({
                    success: false,
                    error: 'Đã gửi lệnh whitelist nhưng không thể cập nhật trạng thái mã. Vui lòng báo admin kiểm tra.'
                });
            }

            activationFinished = true;
            return res.json({ success: true, message: 'Đã whitelist thành công!', gamertag: record.gamertag });
        } catch (error) {
            console.error('Whitelist activate error:', error);
            return res.status(500).json({ success: false, error: 'Không thể kích hoạt whitelist.' });
        } finally {
            if (claimedRecordId && !activationFinished && !commandAccepted) {
                try {
                    whitelistStatements.revertProcessing.run('pending', claimedRecordId, 'processing');
                } catch (rollbackError) {
                    console.error('Whitelist rollback error:', rollbackError);
                }
            }
        }
    });

    app.get('/api/leaderboard/tool-usage', async (_req, res) => {
        try {
            const summary = await getToolUsageSummary();
            return res.json({ success: true, data: summary });
        } catch (error) {
            console.error('Error loading tool usage leaderboard:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải dữ liệu leaderboard.' });
        }
    });

    app.get('/api/recent-users', async (req, res) => {
        try {
            const rawLimit = Number.parseInt(String(req.query.limit ?? recentUsersDefaultLimit), 10);
            const limit = Number.isFinite(rawLimit)
                ? Math.min(Math.max(rawLimit, 1), 20)
                : recentUsersDefaultLimit;

            const users = await touchAndListRecentUsers(req, limit);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, users });
        } catch (error) {
            console.error('Error handling recent users:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải danh sách người dùng gần đây.' });
        }
    });

    app.get('/api/donations', async (_req, res) => {
        try {
            const data = await getDonations(50);
            res.json({ success: true, ...data });
        } catch (error) {
            console.error('Error fetching donations:', error);
            res.status(500).json({ success: false, error: 'Không thể tải danh sách donate.' });
        }
    });

    app.get('/api/furina/quotes', async (_req, res) => {
        try {
            const raw = await readFile(furinaQuotesFile, 'utf8');
            const parsed = JSON.parse(raw);
            const quotes = Array.isArray(parsed?.quotes)
                ? parsed.quotes
                    .filter((quote) => typeof quote === 'string')
                    .map((quote) => quote.trim())
                    .filter(Boolean)
                : [];

            if (quotes.length === 0) {
                return res.status(404).json({ success: false, error: 'Không tìm thấy câu nói Furina.' });
            }

            res.setHeader('Cache-Control', 'public, max-age=60');
            return res.json({ success: true, quotes });
        } catch (error) {
            console.error('Error loading Furina quotes:', error);
            return res.status(500).json({ success: false, error: 'Không thể tải câu nói Furina.' });
        }
    });
}
