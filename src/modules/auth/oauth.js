import axios from 'axios';
import crypto from 'crypto';
import express from 'express';
import { logPlayer } from '../../services/playerService.js';
import {
    SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAME_SITE,
    SESSION_COOKIE_SECURE,
    SESSION_COOKIE_DOMAIN
} from '../../config/index.js';

const router = express.Router();

// OAuth config (do not hard-code secrets in source).
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1453755454873141350';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://vanhmcpe.top/api/auth/callback';

const OAUTH_STATE_SESSION_KEY = 'discordOAuthState';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function hasOAuthConfig() {
    return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

function generateOAuthState() {
    return crypto.randomBytes(24).toString('hex');
}

function safeStateEquals(expected, received) {
    const left = Buffer.from(String(expected || ''), 'utf8');
    const right = Buffer.from(String(received || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function consumeAndValidateOAuthState(req, incomingState) {
    const record = req.session?.[OAUTH_STATE_SESSION_KEY];
    if (req.session) {
        delete req.session[OAUTH_STATE_SESSION_KEY];
    }

    if (!record || typeof record !== 'object') return false;
    const storedState = String(record.value || '');
    const createdAt = Number(record.createdAt || 0);
    if (!storedState || !createdAt) return false;
    if ((Date.now() - createdAt) > OAUTH_STATE_TTL_MS) return false;

    return safeStateEquals(storedState, String(incomingState || ''));
}

function getSessionCookieClearOptions() {
    const options = {
        path: '/',
        httpOnly: true,
        secure: SESSION_COOKIE_SECURE,
        sameSite: SESSION_COOKIE_SAME_SITE
    };
    if (SESSION_COOKIE_DOMAIN) {
        options.domain = SESSION_COOKIE_DOMAIN;
    }
    return options;
}

// 1. Route bắt đầu đăng nhập
router.get('/discord', async (req, res) => {
    if (!hasOAuthConfig()) {
        return res.status(500).send('OAuth Discord chưa được cấu hình đầy đủ trên server.');
    }
    if (!req.session) {
        return res.status(500).send('Không thể khởi tạo phiên đăng nhập.');
    }

    try {
        const state = generateOAuthState();
        req.session[OAUTH_STATE_SESSION_KEY] = {
            value: state,
            createdAt: Date.now()
        };
        await saveSession(req);

        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`;
        return res.redirect(url);
    } catch (error) {
        console.error('❌ Lỗi tạo OAuth state:', error);
        return res.status(500).send('Không thể khởi tạo đăng nhập Discord, vui lòng thử lại.');
    }
});

// 2. Route Callback xử lý sau khi Discord trả code về
router.get('/callback', async (req, res) => {
    if (!hasOAuthConfig()) {
        return res.status(500).send('OAuth Discord chưa được cấu hình đầy đủ trên server.');
    }

    const { code, error: oauthError, state } = req.query;
    const stateValid = consumeAndValidateOAuthState(req, state);
    try {
        if (req.session) {
            await saveSession(req);
        }
    } catch (_error) {
        // Ignore state cleanup save errors.
    }

    if (!stateValid) {
        console.error('❌ OAuth state invalid or expired');
        return res.status(400).send('Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.');
    }

    console.log('🔄 OAuth Callback nhận được:', { code: code ? 'YES' : 'NO', error: oauthError });

    if (oauthError) {
        console.error('❌ OAuth Error từ Discord:', oauthError);
        return res.status(400).send('Bạn đã hủy quyền đăng nhập Discord!');
    }

    if (!code) {
        console.error('❌ Không nhận được code từ Discord');
        return res.status(400).send('Đăng nhập thất bại hoặc bạn đã hủy quyền!');
    }

    try {
        console.log('🔄 Đang trao đổi code lấy access token...');

        // Trao đổi Code lấy Token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;
        console.log('✅ Đã nhận access token thành công');

        // Lấy thông tin User từ Discord
        console.log('🔄 Đang lấy thông tin user từ Discord...');
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const user = userResponse.data;
        console.log('✅ Đã lấy thông tin user:', user.username);

        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;

        // Generate banner URL if user has Nitro banner
        const bannerUrl = user.banner
            ? `https://cdn.discordapp.com/banners/${user.id}/${user.banner}.png?size=600`
            : null;

        const playerData = {
            id: user.id,
            username: user.username,
            avatar: avatarUrl,
            banner: bannerUrl,
            lastLogin: new Date().toISOString()
        };

        console.log('💾 Đang lưu session cho user:', playerData.username);

        // LƯU VÀO SESSION - Bước quan trọng nhất
        req.session.user = playerData;

        // Ép Session phải ghi xuống bộ nhớ/file trước khi Redirect (Chống lỗi mất session trên Cloudflare)
        req.session.save(async (err) => {
            if (err) {
                console.error('❌ Lỗi lưu Session:', err);
                return res.status(500).send('Lỗi lưu phiên đăng nhập!');
            }

            // Log player vào danh sách (chỉ log nếu chưa tồn tại)
            try {
                const logResult = await logPlayer({
                    id: playerData.id,
                    username: playerData.username,
                    avatar: playerData.avatar
                });
                if (logResult.isNew) {
                    console.log(`✅ ${logResult.message}: ${playerData.username}`);
                } else {
                    console.log(`ℹ️ ${logResult.message}: ${playerData.username}`);
                }
            } catch (logErr) {
                console.error('⚠️ Lỗi khi log player:', logErr);
            }

            console.log(`🎉 ${playerData.username} đã đăng nhập thành công!`);

            res.redirect('/');
        });

    } catch (error) {
        console.error('❌ Lỗi OAuth:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        res.status(500).send('Hệ thống Discord đang trục trặc, vui lòng thử lại sau!');
    }
});

// 3. Đăng xuất - Xóa sạch dấu vết
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Lỗi khi đăng xuất:', err);
        const clearOptions = getSessionCookieClearOptions();
        res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
        // Backward compatibility for old session cookie name.
        res.clearCookie('connect.sid', clearOptions);
        res.redirect('/');
    });
});

export default router;

