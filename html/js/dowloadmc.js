// Robust sidebar implementation (overrides broken versions and adds diagnostics)
        window.toggleSidebar = function toggleSidebarImpl() {
            try {
                console.debug('[sidebar] toggleSidebar called');
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('overlay');
                if (!sidebar || !overlay) {
                    console.warn('[sidebar] missing elements', { sidebar, overlay });
                    return;
                }

                // Check if sidebar is in "closed" state by checking if it has -left-[260px]
                const isClosed = sidebar.classList.contains('-left-[260px]');
                
                if (isClosed) {
                    // Open sidebar
                    sidebar.classList.remove('-left-[260px]');
                    sidebar.classList.add('left-0');
                    overlay.classList.remove('hidden');
                    document.body.style.overflow = 'hidden';
                } else {
                    // Close sidebar
                    sidebar.classList.add('-left-[260px]');
                    sidebar.classList.remove('left-0');
                    overlay.classList.add('hidden');
                    document.body.style.overflow = '';
                }
            } catch (err) {
                console.error('[sidebar] toggle error', err);
            }
        };

        function initSidebarLogic() {
            console.debug('[sidebar] initSidebarLogic');

            // Any data-toggle triggers
            document.querySelectorAll('[data-toggle="sidebar"]').forEach(btn => {
                btn.removeEventListener('click', window.toggleSidebar);
                btn.addEventListener('click', window.toggleSidebar);
            });

            // Overlay click to close
            const overlay = document.getElementById('overlay');
            if (overlay) {
                overlay.removeEventListener('click', window.toggleSidebar);
                overlay.addEventListener('click', window.toggleSidebar);
            }

            // Close on Escape
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar && !sidebar.classList.contains('-left-[260px]')) {
                        window.toggleSidebar();
                    }
                }
            });
        }

        // Initialize
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initSidebarLogic);
        } else {
            initSidebarLogic();
        }

        // Diagnostic helper to check DOM elements from console: run __sidebar_check()
        window.__sidebar_check = function () {
            return {
                sidebar: document.getElementById('sidebar'),
                overlay: document.getElementById('overlay'),
                hamburger: document.querySelector('.hamburger')
            };
        };

        async function copyIP() {
            const ip = await (window.SiteSettingsUtils?.getMinecraftAddressAsync?.()
                || Promise.resolve('vna.vanhmcpe.top:25003'));
            navigator.clipboard.writeText(ip).then(() => {
                showToast('✓ Đã copy IP server', 'success');
            }).catch(err => {
                console.error('Không thể copy IP:', err);
                // Fallback cho trình duyệt cũ
                const textArea = document.createElement('textarea');
                textArea.value = ip;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showToast('✓ Đã copy IP server', 'success');
            });
        }

        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white font-medium shadow-lg z-[2000] animate-fade-in-up ${
                type === 'success' ? 'bg-green-500' : 'bg-blue-500'
            }`;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.remove();
            }, 3000);
        }

        async function loadServerStats() {
            try {
                console.log('[Stats] Starting to load server stats...');
                
                // Check if elements exist
                const playerCountEl = document.getElementById('player-count');
                const ramUsageEl = document.getElementById('ram-usage');
                if (!playerCountEl || !ramUsageEl) {
                    console.error('[Stats] Missing DOM elements');
                    return;
                }
                
                // Get server status (players online + RAM usage)
                const statusRes = await fetch('/api/pikamc/status');
                console.log('[Stats] /api/pikamc/status response:', statusRes.status);
                
                if (!statusRes.ok) {
                    console.warn('[Stats] API failed:', statusRes.status);
                    playerCountEl.textContent = 'Offline';
                    ramUsageEl.textContent = 'N/A';
                    return;
                }
                
                const statusData = await statusRes.json();
                console.log('[Stats] statusData:', statusData);
                
                if (!statusData) {
                    console.warn('[Stats] statusData is null');
                    return;
                }

                // Try mcsrvstat API first for live player count
                let playerCountSet = false;
                if (statusData.ip && statusData.port) {
                    try {
                        const mcUrl = `https://api.mcsrvstat.us/bedrock/3/${statusData.ip}:${statusData.port}`;
                        console.log('[Stats] Fetching from mcsrvstat:', mcUrl);
                        const mcRes = await fetch(mcUrl);
                        const mcData = await mcRes.json();
                        console.log('[Stats] mcsrvstat data:', mcData);
                        
                        if (mcData.online && mcData.players) {
                            playerCountEl.textContent = `${mcData.players.online}/${mcData.players.max}`;
                            playerCountSet = true;
                            console.log('[Stats] Player count set from mcsrvstat:', mcData.players.online, '/', mcData.players.max);
                        }
                    } catch (mcError) {
                        console.warn('[Stats] mcsrvstat error:', mcError.message);
                    }
                }

                // Fallback: use data from /api/pikamc/status
                if (!playerCountSet && statusData.players) {
                    const online = statusData.players.online || 0;
                    const max = statusData.players.max || 20;
                    playerCountEl.textContent = `${online}/${max}`;
                    console.log('[Stats] Player count set from API fallback:', online, '/', max);
                }
                
                // Update RAM usage
                if (statusData.ram) {
                    const ramText = typeof statusData.ram === 'object' 
                        ? statusData.ram.usage 
                        : statusData.ram;
                    ramUsageEl.textContent = ramText || 'N/A';
                    console.log('[Stats] RAM set to:', ramText);
                } else {
                    ramUsageEl.textContent = 'N/A';
                }
            } catch (error) {
                console.error('[Stats] Fatal error:', error);
                const playerCountEl = document.getElementById('player-count');
                const ramUsageEl = document.getElementById('ram-usage');
                if (playerCountEl) playerCountEl.textContent = 'Error';
                if (ramUsageEl) ramUsageEl.textContent = 'Error';
            }
        }

        async function loadMinecraftDownloads() {
            const container = document.getElementById('dynamic-downloads');
            if (!container) return;
            try {
                const res = await fetch('/api/minecraft-downloads');
                const data = await res.json();
                if (!res.ok || !data.success || !Array.isArray(data.items)) {
                    return;
                }

                container.innerHTML = '';
                data.items.forEach((item, index) => {
                    if (!item?.title || !item?.url) return;
                    
                    const link = document.createElement('a');
                    link.href = item.url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.className = 'download-card flex flex-col p-6 glass border-white/10 rounded-[1.5rem] hover:border-emerald-500/50 transition-all duration-500 group relative overflow-hidden';
                    link.style.animationDelay = `${index * 100}ms`;

                    // Hover effect background
                    const hoverBg = document.createElement('div');
                    hoverBg.className = 'absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500';
                    link.appendChild(hoverBg);

                    const top = document.createElement('div');
                    top.className = 'flex items-center gap-4 mb-4 relative z-10';

                    const iconWrap = document.createElement('div');
                    iconWrap.className = 'w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform';
                    const icon = document.createElement('i');
                    icon.className = 'fa-brands fa-android text-2xl';
                    iconWrap.appendChild(icon);

                    const textWrap = document.createElement('div');
                    textWrap.className = 'flex-1';
                    const title = document.createElement('h3');
                    title.className = 'font-bold text-gray-800 text-lg leading-tight group-hover:text-emerald-600 transition-colors';
                    title.textContent = item.title;
                    textWrap.appendChild(title);

                    if (item.version) {
                        const ver = document.createElement('span');
                        ver.className = 'text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-md mt-1 inline-block';
                        ver.textContent = `v${item.version}`;
                        textWrap.appendChild(ver);
                    }

                    top.appendChild(iconWrap);
                    top.appendChild(textWrap);

                    const bottom = document.createElement('div');
                    bottom.className = 'flex items-center justify-between mt-auto relative z-10';
                    
                    const label = document.createElement('span');
                    label.className = 'text-xs font-bold text-gray-400 uppercase tracking-widest';
                    label.textContent = item.size || 'APK File';

                    const btn = document.createElement('div');
                    btn.className = 'bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold group-hover:bg-emerald-600 transition-colors flex items-center gap-2';
                    btn.innerHTML = 'Download <i class="fas fa-arrow-right"></i>';

                    bottom.appendChild(label);
                    bottom.appendChild(btn);

                    link.appendChild(top);
                    link.appendChild(bottom);

                    container.appendChild(link);
                });
            } catch (_err) {
                console.debug('Failed to load minecraft downloads. This is OK if API is not available');
            }
        }

        // Hàm cập nhật thời gian thực
        function updateTime() {
            const timeDisplay = document.getElementById('headerTime');
            if (timeDisplay) {
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                timeDisplay.innerText = `${hours}:${minutes}:${seconds}`;
            }
        }

        // Chạy ngay lập tức và lặp lại mỗi giây
        setInterval(updateTime, 1000);
        updateTime();

        // Load downloads khi trang load xong
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('[Init] DOM loaded, loading data...');
                loadMinecraftDownloads();
                loadServerStats();
                // Refresh stats every 10 seconds
                setInterval(loadServerStats, 10000);
                console.log('[Init] Initialization complete');
            });
        } else {
            console.log('[Init] DOM already loaded, loading data...');
            loadMinecraftDownloads();
            loadServerStats();
            // Refresh stats every 10 seconds
            setInterval(loadServerStats, 10000);
            console.log('[Init] Initialization complete');
        }

        // Add some CSS animations
        const style = document.createElement('style');
        style.textContent = `
            .download-card {
                animation: fade-in-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
                -webkit-animation: fade-in-up 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
                opacity: 1; /* Default to visible for mobile safety */
            }

            @keyframes fade-in-up {
                0% {
                    opacity: 0;
                    transform: translateY(20px);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @-webkit-keyframes fade-in-up {
                0% {
                    opacity: 0;
                    -webkit-transform: translateY(20px);
                }
                100% {
                    opacity: 1;
                    -webkit-transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
