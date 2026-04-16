(function () {
    const DEFAULT_IP = 'vanhmcpe.my-land.fun:25702';

    function normalizePath(pathname) {
        const value = String(pathname || '/').toLowerCase();
        if (value.length > 1 && value.endsWith('/')) return value.slice(0, -1);
        return value || '/';
    }

    function isActivePath(currentPath, candidates) {
        return candidates.some((candidate) => normalizePath(candidate) === currentPath);
    }

    function navLink(iconClass, label, href, active) {
        if (active) {
            return `
                <div class="flex items-center gap-3 p-3 rounded-xl bg-[#007bff] text-white font-medium shadow-lg shadow-blue-100">
                    <i class="${iconClass}"></i> ${label}
                </div>
            `;
        }
        return `
            <a class="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-[#007bff] hover:text-white transition-all text-gray-600 font-medium" href="${href}">
                <i class="${iconClass}"></i> ${label}
            </a>
        `;
    }

    function navButton(iconClass, label) {
        return `
            <button type="button" onclick="copyIP()" class="w-full text-left flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-[#007bff] hover:text-white transition-all text-gray-600 font-medium">
                <i class="${iconClass}"></i> ${label}
            </button>
        `;
    }

    function toolTile(iconClass, label, href, active) {
        return `
            <a class="tool-tile${active ? ' is-active' : ''}" href="${href}">
                <i class="${iconClass}"></i>
                <span>${label}</span>
            </a>
        `;
    }

    async function fetchUserInfo() {
        try {
            const response = await fetch('/api/user-info', { credentials: 'same-origin' });
            if (!response.ok) {
                return { loggedIn: false, isAdmin: false };
            }
            const data = await response.json();
            return {
                loggedIn: Boolean(data?.loggedIn),
                isAdmin: Boolean(data?.loggedIn && data?.isAdmin)
            };
        } catch (_error) {
            return { loggedIn: false, isAdmin: false };
        }
    }

    function ensureCopyIP() {
        if (typeof window.copyIP === 'function') return;
        window.copyIP = function copyIP() {
            if (!navigator.clipboard) {
                alert('Không thể copy IP, vui lòng thử lại.');
                return;
            }
            navigator.clipboard.writeText(DEFAULT_IP)
                .then(() => alert(`Đã copy IP: ${DEFAULT_IP}`))
                .catch(() => alert('Không thể copy IP, vui lòng thử lại.'));
        };
    }

    function closeSidebarOnMobile() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('overlay');
        if (!sidebar || !overlay) return;
        if (window.innerWidth >= 1024) return;
        sidebar.classList.remove('left-0');
        sidebar.classList.add('-left-[260px]');
        overlay.classList.add('hidden');
    }

    function renderSidebar(userInfo) {
        // Skip pages that use a dedicated custom sidebar (e.g. Cloud file manager).
        if (document.getElementById('all-files-link') || document.body?.dataset?.sidebar === 'custom') {
            return false;
        }

        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return false;
        const nav = sidebar.querySelector('nav');
        if (!nav) return false;

        const currentPath = normalizePath(window.location.pathname);
        const isAdmin = Boolean(userInfo?.loggedIn && userInfo?.isAdmin);

        const active = {
            home: isActivePath(currentPath, ['/', '/html/index.html']),
            statusServer: isActivePath(currentPath, ['/html/status-server.html']),
            chat: isActivePath(currentPath, ['/a11/chat.html']),
            streak: isActivePath(currentPath, ['/a11/streak.html']),
            cloud: isActivePath(currentPath, ['/cloud', '/p/cloud.html']),
            leaderboard: isActivePath(currentPath, ['/leaderboard', '/html/leaderboard.html']),
            donate: isActivePath(currentPath, ['/a11/donet.html', '/A11/donet.html']),
            kho: isActivePath(currentPath, ['/p/kho.html']),
            facebook: isActivePath(currentPath, ['/p/snapsave.html']),
            tiktok: isActivePath(currentPath, ['/html/tiktok.html']),
            youtube: isActivePath(currentPath, ['/html/youtube.html']),
            x: isActivePath(currentPath, ['/x', '/twitter', '/html/x.html']),
            minecraft: isActivePath(currentPath, ['/html/dowloadmc.html']),
            whitelist: isActivePath(currentPath, ['/whitelist', '/html/whitelist.html']),
            bedrockViewer: isActivePath(currentPath, ['/html/bedrock-world-viewer.html']),
            embedAdmin: isActivePath(currentPath, ['/admin/e.html', '/embed-admin', '/admin06082008']),
            whitelistAdmin: isActivePath(currentPath, ['/admin/whitelist.html']),
            mcAdmin: isActivePath(currentPath, ['/admin/p.html', '/admin/p'])
        };

        nav.innerHTML = `
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-3">Hệ thống</div>
            ${navLink('fas fa-home', 'Trang chủ', '/', active.home)}
            ${navButton('fas fa-copy', 'Copy IP')}
            ${navLink('fas fa-chart-line w-5', 'Status server', '/html/status-server.html', active.statusServer)}
            ${navLink('fas fa-comments w-5', 'Chat', '/A11/chat.html', active.chat)}
            ${navLink('fas fa-fire w-5', 'Streak', '/A11/streak.html', active.streak)}
            ${navLink('fas fa-cloud w-5', 'Cloud', '/cloud', active.cloud)}
            ${navLink('fas fa-trophy w-5', 'Leaderboard', '/leaderboard', active.leaderboard)}
            ${navLink('fas fa-gem w-5', 'Donate', '/A11/donet.html', active.donate)}

            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-3 mt-2">Tiện ích</div>
            <div class="tool-grid-sidebar">
                ${toolTile('fa-brands fa-facebook-f', 'Facebook', '/p/snapsave.html', active.facebook)}
                ${toolTile('fa-brands fa-tiktok', 'TikTok', '/html/tiktok.html', active.tiktok)}
                ${toolTile('fa-brands fa-youtube', 'YouTube', '/html/youtube.html', active.youtube)}
                ${toolTile('fa-brands fa-twitter', 'X', '/x', active.x)}
                ${toolTile('fas fa-download', 'Minecraft', '/html/dowloadmc.html', active.minecraft)}
                ${toolTile('fas fa-user-check', 'Whitelist', '/whitelist', active.whitelist)}
                ${toolTile('fas fa-map', 'World Map', '/html/bedrock-world-viewer.html', active.bedrockViewer)}
            </div>

            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-3 mt-2">Kho rác</div>
            ${navLink('fas fa-toolbox', 'Kho công cụ', '/p/kho.html', active.kho)}
            ${isAdmin ? `
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-3 mt-2">Quản trị</div>
            ${navLink('fas fa-bullhorn', 'Thông báo Discord', '/admin/e.html', active.embedAdmin)}
            ${navLink('fas fa-user-shield', 'Whitelist Admin', '/admin/whitelist.html', active.whitelistAdmin)}
            ${navLink('fas fa-plus-square', 'Thêm Nút Minecraft', '/admin/p.html', active.mcAdmin)}
            ` : ''}
        `;

        nav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', closeSidebarOnMobile);
        });
        return true;
    }

    async function init() {
        ensureCopyIP();
        const userInfo = await fetchUserInfo();
        return renderSidebar(userInfo);
    }

    function start() {
        init().catch(() => {
            renderSidebar({ loggedIn: false, isAdmin: false });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();