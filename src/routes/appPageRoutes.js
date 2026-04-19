import express from 'express';
import path from 'path';

export function registerAppPageRoutes(app, deps) {
    const {
        __dirname,
        staticPublicOptions,
        requireAdminPageAccess
    } = deps;

    app.get(['/cloud', '/cloud/'], (_req, res) => res.sendFile(path.join(__dirname, 'p/cloud.html')));

    app.use('/cloud', (req, res, next) => {
        if (req.path === '/' || req.path === '') {
            return next();
        }
        return res.status(403).json({ success: false, error: 'Forbidden' });
    });

    app.use('/temp/cloud', (_req, res) => {
        return res.status(403).json({ success: false, error: 'Forbidden' });
    });

    app.get('/admin/e.html', requireAdminPageAccess, (_req, res) => {
        res.sendFile(path.join(__dirname, 'admin/e.html'));
    });
    app.get('/admin/p.html', requireAdminPageAccess, (_req, res) => {
        res.sendFile(path.join(__dirname, 'admin/p.html'));
    });
    app.get('/admin/whitelist.html', requireAdminPageAccess, (_req, res) => {
        res.sendFile(path.join(__dirname, 'admin/whitelist.html'));
    });
    app.get('/admin/notifications.html', requireAdminPageAccess, (_req, res) => {
        res.sendFile(path.join(__dirname, 'admin/notifications.html'));
    });

    app.use('/album', express.static(path.join(__dirname, 'album')));
    app.get('/sw.js', (_req, res) => res.sendFile(path.join(__dirname, 'html/sw.js')));
    app.use('/html', express.static(path.join(__dirname, 'html'), staticPublicOptions));
    app.use('/photos', express.static(path.join(__dirname, 'photos'), staticPublicOptions));
    app.use('/p', express.static(path.join(__dirname, 'p'), staticPublicOptions));
    app.use('/A11', express.static(path.join(__dirname, 'A11'), staticPublicOptions));
    app.use('/tools', express.static(path.join(__dirname, 'tools'), staticPublicOptions));
    app.use('/admin', requireAdminPageAccess, express.static(path.join(__dirname, 'admin'), staticPublicOptions));
    app.use('/minecraft', express.static(path.join(__dirname, 'Minecraft'), staticPublicOptions));
    app.use('/Minecraft', express.static(path.join(__dirname, 'Minecraft'), staticPublicOptions));

    app.get('/leaderboard', (_req, res) => res.sendFile(path.join(__dirname, 'html/leaderboard.html')));
    app.get('/youtube', (_req, res) => res.sendFile(path.join(__dirname, 'html/youtube.html')));
    app.get('/tiktok', (_req, res) => res.sendFile(path.join(__dirname, 'html/tiktok.html')));
    app.get('/x', (_req, res) => res.sendFile(path.join(__dirname, 'html/x.html')));
    app.get('/twitter', (_req, res) => res.sendFile(path.join(__dirname, 'html/x.html')));
    app.get('/whitelist', (_req, res) => res.sendFile(path.join(__dirname, 'html/whitelist.html')));

    app.get('/embed-admin', requireAdminPageAccess, (_req, res) => res.sendFile(path.join(__dirname, 'admin/e.html')));

    app.get('/', (_req, res) => {
        res.setHeader('Accept-Ranges', 'none');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(__dirname, 'html/index.html'));
    });

    app.get('/photos/raw/anh-nhom/raw-2026.png', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
        res.sendFile(path.join(__dirname, 'photos/raw/anh-nhom/raw-2026.png'));
    });
}
