function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('overlay');
            if (!sidebar || !overlay) return;

            const isOpen = sidebar.classList.contains('left-0');
            if (isOpen) {
                sidebar.classList.remove('left-0');
                sidebar.classList.add('-left-[260px]');
                overlay.classList.add('hidden');
            } else {
                sidebar.classList.add('left-0');
                sidebar.classList.remove('-left-[260px]');
                overlay.classList.remove('hidden');
            }
        }

        async function copyIP() {
            const text = 'vanhmcpe.my-land.fun:25702';
            const copyStatus = document.getElementById('copyStatus');

            try {
                await navigator.clipboard.writeText(text);
                if (copyStatus) copyStatus.textContent = `Đã copy IP: ${text}`;
            } catch (_error) {
                if (copyStatus) copyStatus.textContent = `Không thể tự động copy. Hãy copy tay: ${text}`;
            }
        }

        document.addEventListener('click', (event) => {
            if (window.innerWidth >= 1024) return;
            const clickedLink = event.target.closest('nav a');
            if (!clickedLink) return;

            const sidebar = document.getElementById('sidebar');
            if (sidebar && sidebar.classList.contains('left-0')) {
                toggleSidebar();
            }
        });