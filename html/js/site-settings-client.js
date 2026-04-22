(function () {
    const FALLBACK = {
        settings: {
            server_display_name: 'VNA Server',
            minecraft_ip: 'vna.vanhmcpe.top',
            minecraft_port: '25003'
        },
        minecraft: {
            ip: 'vna.vanhmcpe.top',
            port: '25003',
            address: 'vna.vanhmcpe.top:25003',
            displayName: 'VNA Server'
        }
    };

    function normalizeSettings(payload) {
        const rawSettings = payload?.settings && typeof payload.settings === 'object'
            ? payload.settings
            : {};
        const ip = String(payload?.minecraft?.ip || rawSettings.minecraft_ip || FALLBACK.minecraft.ip).trim() || FALLBACK.minecraft.ip;
        const port = String(payload?.minecraft?.port || rawSettings.minecraft_port || FALLBACK.minecraft.port).trim() || FALLBACK.minecraft.port;
        const displayName = String(
            payload?.minecraft?.displayName
            || rawSettings.server_display_name
            || FALLBACK.minecraft.displayName
        ).trim() || FALLBACK.minecraft.displayName;

        return {
            settings: {
                ...rawSettings,
                minecraft_ip: ip,
                minecraft_port: port,
                server_display_name: displayName
            },
            minecraft: {
                ip,
                port,
                address: `${ip}:${port}`,
                displayName
            }
        };
    }

    function resolveSettingValue(snapshot, key) {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey) return '';

        if (normalizedKey === 'minecraft_ip') return snapshot.minecraft.ip;
        if (normalizedKey === 'minecraft_port') return snapshot.minecraft.port;
        if (normalizedKey === 'minecraft_address') return snapshot.minecraft.address;
        if (normalizedKey === 'server_display_name') return snapshot.minecraft.displayName;

        return snapshot.settings?.[normalizedKey] ?? '';
    }

    function applySiteSettingBindings(snapshot) {
        document.querySelectorAll('[data-site-setting]').forEach((element) => {
            const key = element.dataset.siteSetting;
            const value = resolveSettingValue(snapshot, key);
            if (value !== '') {
                element.textContent = value;
            }
        });
    }

    async function loadSiteSettings() {
        if (window.SiteSettingsUtils?.load) {
            try {
                const payload = await window.SiteSettingsUtils.load();
                return normalizeSettings(payload);
            } catch (_error) {
                return normalizeSettings(window.SiteSettingsUtils.getSnapshot?.() || FALLBACK);
            }
        }

        try {
            const response = await fetch('/api/config/site-settings', {
                credentials: 'same-origin'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            return normalizeSettings(payload);
        } catch (_error) {
            return normalizeSettings(FALLBACK);
        }
    }

    function start() {
        const initial = normalizeSettings(window.SiteSettingsUtils?.getSnapshot?.() || FALLBACK);
        applySiteSettingBindings(initial);

        loadSiteSettings().then((snapshot) => {
            applySiteSettingBindings(snapshot);
        });

        window.addEventListener('site-settings:updated', (event) => {
            applySiteSettingBindings(normalizeSettings(event.detail || FALLBACK));
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
