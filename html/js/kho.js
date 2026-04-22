function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('overlay');
            if (!sidebar || !overlay) return;

            if (sidebar.classList.contains('-left-[260px]')) {
                sidebar.classList.remove('-left-[260px]');
                sidebar.classList.add('left-0');
                overlay.classList.remove('hidden');
            } else {
                sidebar.classList.add('-left-[260px]');
                sidebar.classList.remove('left-0');
                overlay.classList.add('hidden');
            }
        }

        async function copyIP() {
            const ip = await (window.SiteSettingsUtils?.getMinecraftAddressAsync?.()
                || Promise.resolve('vna.vanhmcpe.top:25003'));
            navigator.clipboard.writeText(ip)
                .then(() => alert('Đã copy IP: ' + ip))
                .catch(() => alert('Không thể copy IP, hãy thử lại.'));
        }

        const searchInput = document.getElementById('toolSearch');
        const cards = Array.from(document.querySelectorAll('#toolGrid a[data-tool]'));

        searchInput.addEventListener('input', () => {
            const keyword = searchInput.value.trim().toLowerCase();
            cards.forEach((card) => {
                const text = card.dataset.tool || '';
                card.classList.toggle('hidden', keyword && !text.includes(keyword));
            });
        });

        document.addEventListener('click', (event) => {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('overlay');
            const menuBtn = document.querySelector('.hamburger');
            if (!sidebar || !overlay) return;
            if (window.innerWidth >= 1024) return;

            const isOpen = sidebar.classList.contains('left-0');
            const clickedInsideSidebar = sidebar.contains(event.target);
            const clickedMenu = menuBtn && menuBtn.contains(event.target);
            if (isOpen && !clickedInsideSidebar && !clickedMenu) {
                toggleSidebar();
            }
        });
             document.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', updatePreview));
        updatePreview();

        // Show admin card if user is admin
        (async () => {
            try {
                const res = await fetch('/api/user-info');
                const data = await res.json();
                if (data.isAdmin) {
                    document.getElementById('adminMinecraftCard')?.classList.remove('hidden');
                }
            } catch (e) {
                console.error('Failed to fetch user info for admin card:', e);
            }
        })();
