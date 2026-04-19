function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('overlay');
            if (!sidebar || !overlay) return;

            const isClosed = sidebar.classList.contains('-left-[260px]');
            if (isClosed) {
                sidebar.classList.remove('-left-[260px]');
                sidebar.classList.add('left-0');
                overlay.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            } else {
                sidebar.classList.add('-left-[260px]');
                sidebar.classList.remove('left-0');
                overlay.classList.add('hidden');
                document.body.style.overflow = '';
            }
        }

        document.getElementById('overlay').addEventListener('click', toggleSidebar);

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderAlbums(albums) {
            const wrap = document.getElementById('albums');
            wrap.innerHTML = '';

            if (!albums.length) {
                wrap.innerHTML = '<p class="text-sm text-slate-500">Chua co album nao duoc tai len.</p>';
                return;
            }

            albums.forEach((album) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'text-left rounded-3xl overflow-hidden border border-slate-200 bg-slate-50 hover:bg-white hover:shadow-md transition';
                button.innerHTML = `
                    <div class="aspect-[4/3] bg-slate-200 overflow-hidden">
                        ${album.firstImage ? `<img src="${album.firstImage}" alt="${escapeHtml(album.username)}" class="w-full h-full object-cover">` : ''}
                    </div>
                    <div class="p-4">
                        <div class="flex items-center justify-between gap-3">
                            <h3 class="font-bold text-slate-800">${escapeHtml(album.username)}</h3>
                            <span class="text-xs font-bold text-sky-600 bg-sky-100 px-2 py-1 rounded-full">${album.imageCount || 0} anh</span>
                        </div>
                    </div>
                `;
                button.addEventListener('click', () => loadGallery(album.username));
                wrap.appendChild(button);
            });
        }

        function renderGallery(username, images) {
            document.getElementById('galleryTitle').textContent = `Album cua ${username}`;
            document.getElementById('galleryHint').textContent = `${images.length} anh dang hien thi`;

            const wrap = document.getElementById('gallery');
            wrap.innerHTML = '';

            if (!images.length) {
                wrap.innerHTML = '<p class="text-sm text-slate-500">Album nay chua co anh.</p>';
                return;
            }

            images.forEach((image) => {
                const card = document.createElement('article');
                card.className = 'rounded-3xl overflow-hidden border border-slate-200 bg-slate-50';
                card.innerHTML = `
                    <a href="${image.path}" target="_blank" rel="noopener noreferrer" class="block aspect-[4/3] bg-slate-200 overflow-hidden">
                        <img src="${image.path}" alt="${escapeHtml(image.filename)}" class="w-full h-full object-cover hover:scale-105 transition duration-300">
                    </a>
                    <div class="p-4 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-slate-800 truncate">${escapeHtml(image.filename)}</p>
                            <p class="text-xs text-slate-400">Nhan vao anh de mo tab moi</p>
                        </div>
                        <a href="${image.path}" target="_blank" rel="noopener noreferrer" class="text-sky-600 hover:text-sky-700">
                            <i class="fas fa-up-right-from-square"></i>
                        </a>
                    </div>
                `;
                wrap.appendChild(card);
            });
        }

        async function loadAlbums() {
            const wrap = document.getElementById('albums');
            wrap.innerHTML = '<p class="text-sm text-slate-500">Dang tai danh sach album...</p>';
            const response = await fetch('/api/album/list');
            const data = await response.json();
            renderAlbums(Array.isArray(data.albums) ? data.albums : []);
        }

        async function loadGallery(username) {
            const wrap = document.getElementById('gallery');
            wrap.innerHTML = '<p class="text-sm text-slate-500">Dang tai album...</p>';
            document.getElementById('galleryTitle').textContent = `Album cua ${username}`;
            document.getElementById('galleryHint').textContent = 'Dang tai danh sach anh';

            const response = await fetch(`/api/album/${encodeURIComponent(username)}`);
            const data = await response.json();
            renderGallery(username, Array.isArray(data.images) ? data.images : []);
        }

        document.getElementById('reloadBtn').addEventListener('click', () => {
            loadAlbums().catch(() => {
                document.getElementById('albums').innerHTML = '<p class="text-sm text-rose-600">Khong tai duoc danh sach album.</p>';
            });
        });

        loadAlbums().catch(() => {
            document.getElementById('albums').innerHTML = '<p class="text-sm text-rose-600">Khong tai duoc danh sach album.</p>';
        });