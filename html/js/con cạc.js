const QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.getElementById('sidebar');
        const createFileBtn = document.getElementById('create-file-btn');
        const createFolderBtn = document.getElementById('create-folder-btn');
        const uploadBtn = document.getElementById('upload-btn');
        const uploadInput = document.getElementById('upload-input');
        const searchInput = document.getElementById('search-input');
        const fileListBody = document.getElementById('file-list-body');
        const gridView = document.getElementById('grid-view');
        const listView = document.getElementById('list-view');
        const viewListBtn = document.getElementById('view-list-btn');
        const viewGridBtn = document.getElementById('view-grid-btn');
        const allFilesLink = document.getElementById('all-files-link');
        const recentFilesLink = document.getElementById('recent-files-link');
        const trashFilesLink = document.getElementById('trash-files-link');
        const breadcrumb = document.getElementById('breadcrumb');
        const pageTitle = document.getElementById('page-title');
        const statusLine = document.getElementById('status-line');
        const storageLabel = document.getElementById('storage-label');
        const storageBar = document.getElementById('storage-bar');
        const rowActionMenu = document.getElementById('row-action-menu');
        const menuPrimary = document.getElementById('menu-primary');
        const menuSecondary = document.getElementById('menu-secondary');
        const menuTertiary = document.getElementById('menu-tertiary');
        const previewModal = document.getElementById('preview-modal');
        const previewTitle = document.getElementById('preview-title');
        const previewBody = document.getElementById('preview-body');
        const previewCloseBtn = document.getElementById('preview-close-btn');
        const userAvatarWrap = document.getElementById('user-avatar-wrap');
        const userAvatarImg = document.getElementById('user-avatar-img');
        const userAvatarFallback = document.getElementById('user-avatar-fallback');
        const editorModal = document.getElementById('editor-modal');
        const editorTitle = document.getElementById('editor-title');
        const editorStatus = document.getElementById('editor-status');
        const editorTextarea = document.getElementById('editor-textarea');
        const editorHistory = document.getElementById('editor-history');
        const editorCloseBtn = document.getElementById('editor-close-btn');
        const editorCancelBtn = document.getElementById('editor-cancel-btn');
        const editorSaveBtn = document.getElementById('editor-save-btn');
        const state = {
            currentPath: '/', currentSidebarMode: 'all', currentViewMode: 'list', currentQuery: '',
            activeItems: [], trashItems: [], menuTargetItem: null, previewUrl: null, editorTargetItem: null
        };

        function showStatus(message, isError = false) {
            statusLine.textContent = message || '';
            statusLine.className = isError ? 'px-3 pb-2 text-xs text-red-500' : 'px-3 pb-2 text-xs text-gray-400';
        }

        function normalizeClientPath(input) {
            const raw = String(input || '/').replace(/\\/g, '/').trim();
            if (!raw || raw === '/') return '/';
            return `/${raw.replace(/^\/+/, '').replace(/\/+/g, '/')}`;
        }
        function toRelativePath(clientPath) {
            const clean = normalizeClientPath(clientPath);
            return clean === '/' ? '' : clean.replace(/^\//, '');
        }
        function escapeHtml(value) {
            return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }
        function formatSize(bytes) {
            if (bytes === null || bytes === undefined) return '--';
            const n = Number(bytes);
            if (!Number.isFinite(n) || n <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            const idx = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
            const val = n / Math.pow(1024, idx);
            return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
        }
        function formatDateLabel(isoDate) {
            if (!isoDate) return '--';
            const date = new Date(isoDate);
            if (Number.isNaN(date.getTime())) return '--';
            const diffMs = Date.now() - date.getTime();
            const minute = 60000; const hour = 3600000; const day = 86400000;
            if (diffMs < minute) return 'Vừa xong';
            if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} phút trước`;
            if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} giờ trước`;
            if (diffMs < 7 * day) return `${Math.max(1, Math.floor(diffMs / day))} ngày trước`;
            return date.toLocaleDateString('vi-VN');
        }
        async function apiRequest(url, options = {}) {
            const headers = options.headers ? { ...options.headers } : {};
            const init = { credentials: 'include', ...options, headers };
            if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
                init.headers['Content-Type'] = 'application/json';
            }
            const response = await fetch(url, init);
            const text = await response.text();
            let payload = null;
            try { payload = text ? JSON.parse(text) : null; } catch (_err) { payload = null; }
            if (!response.ok || (payload && payload.success === false)) {
                throw new Error(payload?.error || `Lỗi HTTP ${response.status}`);
            }
            return payload?.data ?? null;
        }

        function getCurrentItems() {
            if (state.currentSidebarMode === 'trash') return state.trashItems;
            if (state.currentSidebarMode === 'recent') return [...state.activeItems].sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
            return state.activeItems;
        }

        function getInitials(name = '') {
            const words = String(name || '').trim().split(/\s+/).filter(Boolean);
            if (!words.length) return 'DC';
            const first = words[0]?.[0] || '';
            const second = words.length > 1 ? (words[1]?.[0] || '') : '';
            return `${first}${second}`.toUpperCase() || 'DC';
        }

        function setUserAvatar(userInfo = {}) {
            const username = String(userInfo?.username || '').trim();
            const avatar = String(userInfo?.avatar || '').trim();
            userAvatarWrap.title = username ? `@${username}` : 'Tài khoản';
            userAvatarFallback.textContent = getInitials(username);
            userAvatarImg.classList.add('hidden');
            userAvatarFallback.classList.remove('hidden');
            userAvatarImg.removeAttribute('src');
            if (avatar) {
                userAvatarImg.src = avatar;
                userAvatarImg.classList.remove('hidden');
                userAvatarFallback.classList.add('hidden');
            }
        }

        function setActiveSidebarLink(mode) {
            allFilesLink.className = 'flex items-center gap-3 p-3 text-gray-500 hover:bg-gray-50 rounded-xl transition-all';
            recentFilesLink.className = 'flex items-center gap-3 p-3 text-gray-500 hover:bg-gray-50 hover:text-blue-500 rounded-xl transition-all';
            trashFilesLink.className = 'flex items-center gap-3 p-3 text-gray-500 hover:bg-gray-50 rounded-xl transition-all';
            if (mode === 'recent') { recentFilesLink.className = 'flex items-center gap-3 p-3 bg-blue-50 text-blue-600 rounded-xl font-semibold'; return; }
            if (mode === 'trash') { trashFilesLink.className = 'flex items-center gap-3 p-3 bg-blue-50 text-blue-600 rounded-xl font-semibold'; return; }
            allFilesLink.className = 'flex items-center gap-3 p-3 bg-blue-50 text-blue-600 rounded-xl font-semibold';
        }

        function renderHeader() {
            const cleanPath = normalizeClientPath(state.currentPath);
            breadcrumb.textContent = cleanPath;
            if (state.currentSidebarMode === 'trash') pageTitle.textContent = 'Thùng rác';
            else if (state.currentSidebarMode === 'recent') pageTitle.textContent = 'Tệp gần đây';
            else pageTitle.textContent = `Tệp tin: ${cleanPath}`;
        }

        function buildRow(item) {
            const row = document.createElement('tr');
            row.className = 'hover:bg-blue-50/40 transition-all cursor-pointer group';
            if (item.id) row.dataset.id = item.id;
            if (item.path) row.dataset.path = item.path;
            if (item.trashedPath) row.dataset.trashedPath = item.trashedPath;
            const visual = getItemVisual(item);
            const dateLabel = formatDateLabel(item.deletedAt || item.modifiedAt);
            const sizeLabel = formatSize(item.size);
            row.innerHTML = `
                <td class="px-4 py-2 flex items-center gap-3"><i class="fas ${visual.icon} ${visual.iconColor} ${visual.sizeClass || 'text-base'}"></i><span class="font-medium text-gray-600 truncate max-w-[200px] md:max-w-xs">${escapeHtml(item.name || 'Không tên')}</span></td>
                <td class="px-4 py-2 text-gray-400 italic">${escapeHtml(dateLabel)}</td>
                <td class="px-4 py-2 text-gray-400 text-right font-mono text-xs">${escapeHtml(sizeLabel)}</td>
                <td class="px-4 py-2 text-right"><button class="row-actions-btn text-gray-300 hover:text-blue-600"><i class="fas fa-ellipsis-h"></i></button></td>
            `;
            return row;
        }

        function renderListView(items) {
            fileListBody.innerHTML = '';
            if (!items.length) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="4" class="px-4 py-6 text-center text-gray-400 text-sm">Không có dữ liệu.</td>';
                fileListBody.appendChild(row);
                return;
            }
            items.forEach((item) => fileListBody.appendChild(buildRow(item)));
        }

        function renderGridView(items) {
            gridView.innerHTML = '';
            if (!items.length) {
                gridView.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-6">Không có dữ liệu.</div>';
                return;
            }
            items.forEach((item) => {
                const visual = getItemVisual(item);
                const dateLabel = formatDateLabel(item.deletedAt || item.modifiedAt);
                const sizeLabel = formatSize(item.size);
                const idAttr = item.id ? `data-item-id="${escapeHtml(item.id)}"` : '';
                const pathAttr = item.path ? `data-item-path="${escapeHtml(item.path)}"` : '';
                const trashedPathAttr = item.trashedPath ? `data-item-trashed-path="${escapeHtml(item.trashedPath)}"` : '';
                const card = document.createElement('article');
                card.className = 'cursor-pointer rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50/40 transition-all';
                if (item.id) card.dataset.itemId = item.id;
                if (item.path) card.dataset.itemPath = item.path;
                if (item.trashedPath) card.dataset.itemTrashedPath = item.trashedPath;
                card.innerHTML = `
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-center gap-2 min-w-0"><div class="${visual.bg} rounded-md p-2"><i class="fas ${visual.icon} ${visual.iconColor} ${visual.sizeClass || 'text-base'}"></i></div><p class="font-medium text-gray-700 truncate">${escapeHtml(item.name || 'Không tên')}</p></div>
                        <button class="grid-actions-btn text-gray-300 hover:text-blue-600" ${idAttr} ${pathAttr} ${trashedPathAttr}><i class="fas fa-ellipsis-h"></i></button>
                    </div>
                    <div class="mt-3 text-xs text-gray-400 flex items-center justify-between"><span class="italic">${escapeHtml(dateLabel)}</span><span class="font-mono">${escapeHtml(sizeLabel)}</span></div>
                `;
                gridView.appendChild(card);
            });
        }

        function setViewMode(mode) {
            state.currentViewMode = mode;
            const isGrid = mode === 'grid';
            listView.classList.toggle('hidden', isGrid);
            gridView.classList.toggle('hidden', !isGrid);
            viewListBtn.className = isGrid ? 'px-2 py-1 text-gray-400 hover:text-blue-500 rounded-md transition-all' : 'px-2 py-1 text-blue-600 bg-white shadow-sm rounded-md transition-all';
            viewGridBtn.className = isGrid ? 'px-2 py-1 text-blue-600 bg-white shadow-sm rounded-md transition-all' : 'px-2 py-1 text-gray-400 hover:text-blue-500 rounded-md transition-all';
        }

        function closeActionMenu() { rowActionMenu.classList.add('hidden'); state.menuTargetItem = null; }
        function clearPreviewUrl() {
            if (state.previewUrl) {
                URL.revokeObjectURL(state.previewUrl);
                state.previewUrl = null;
            }
        }

        function closePreviewModal() {
            previewModal.classList.add('hidden');
            previewBody.innerHTML = '';
            clearPreviewUrl();
        }

        function getFileExtension(name = '') {
            const parts = String(name || '').toLowerCase().split('.');
            return parts.length > 1 ? parts.pop() : '';
        }

        function getPreviewKind(item) {
            const ext = getFileExtension(item?.name || '');
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
            if (ext === 'pdf') return 'pdf';
            if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return 'video';
            if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
            if (['txt', 'md', 'log', 'json', 'csv', 'xml', 'html', 'css', 'js', 'ts'].includes(ext)) return 'text';
            return 'none';
        }

        function getItemVisual(item) {
            if (item?.type === 'folder') return { icon: 'fa-folder', iconColor: 'text-amber-500', bg: 'bg-amber-50', accent: 'text-amber-600' };
            const ext = getFileExtension(item?.name || '');
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return { icon: 'fa-file-image', iconColor: 'text-emerald-500', bg: 'bg-emerald-50', accent: 'text-emerald-600' };
            if (['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) return { icon: 'fa-file-video', iconColor: 'text-rose-500', bg: 'bg-rose-50', accent: 'text-rose-600' };
            if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return { icon: 'fa-file-audio', iconColor: 'text-fuchsia-500', bg: 'bg-fuchsia-50', accent: 'text-fuchsia-600' };
            if (ext === 'pdf') return { icon: 'fa-file-pdf', iconColor: 'text-red-500', bg: 'bg-red-50', accent: 'text-red-600' };
            if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return { icon: 'fa-file-word', iconColor: 'text-blue-500', bg: 'bg-blue-50', accent: 'text-blue-600' };
            if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return { icon: 'fa-file-excel', iconColor: 'text-green-500', bg: 'bg-green-50', accent: 'text-green-600' };
            if (['ppt', 'pptx', 'odp'].includes(ext)) return { icon: 'fa-file-powerpoint', iconColor: 'text-orange-500', bg: 'bg-orange-50', accent: 'text-orange-600' };
            if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { icon: 'fa-file-zipper', iconColor: 'text-yellow-600', bg: 'bg-yellow-50', accent: 'text-yellow-700' };
            if (['js', 'ts'].includes(ext)) return { icon: 'fa-file-code', iconColor: 'text-yellow-500', bg: 'bg-yellow-50', accent: 'text-yellow-600' };
            if (ext === 'html') return { icon: 'fa-code', iconColor: 'text-orange-500', bg: 'bg-orange-50', accent: 'text-orange-600', sizeClass: 'text-sm', previewSizeClass: 'text-base' };
            if (['css', 'json', 'xml'].includes(ext)) return { icon: 'fa-file-code', iconColor: 'text-indigo-500', bg: 'bg-indigo-50', accent: 'text-indigo-600' };
            if (['md', 'txt', 'log'].includes(ext)) return { icon: 'fa-file-lines', iconColor: 'text-slate-500', bg: 'bg-slate-100', accent: 'text-slate-600' };
            return { icon: 'fa-file-lines', iconColor: 'text-slate-500', bg: 'bg-slate-100', accent: 'text-slate-600', sizeClass: 'text-base', previewSizeClass: 'text-lg' };
        }

        function isEditableTextFile(item) {
            return getPreviewKind(item) === 'text';
        }

        async function loadEditHistory(itemPath) {
            if (!itemPath) return [];
            try {
                const relPath = toRelativePath(itemPath);
                const data = await apiRequest(`/api/cloud/history?path=${encodeURIComponent(relPath)}`);
                return data?.items || [];
            } catch (_error) {
                return [];
            }
        }

        function renderHistoryHtml(items = []) {
            if (!Array.isArray(items) || !items.length) {
                return '<div class="text-xs text-gray-400">Chưa có lịch sử chỉnh sửa.</div>';
            }
            const rows = items.map((entry) => {
                const editor = escapeHtml(entry?.editor || 'unknown');
                const at = escapeHtml(formatDateLabel(entry?.editedAt));
                const size = escapeHtml(formatSize(entry?.size));
                return `<li class="text-xs text-gray-600 flex items-center justify-between gap-2"><span class="truncate"><i class="fas fa-pen-to-square text-blue-400 mr-1"></i>${editor}</span><span class="text-gray-400 whitespace-nowrap">${at} • ${size}</span></li>`;
            }).join('');
            return `<ul class="space-y-1.5">${rows}</ul>`;
        }

        function getDownloadUrl(item) {
            const relPath = toRelativePath(item?.path || '');
            return `/api/cloud/download?path=${encodeURIComponent(relPath)}`;
        }

        async function openPreviewModal(item) {
            if (!item || item.type !== 'file' || !item.path) return;
            closeActionMenu();
            previewModal.classList.remove('hidden');
            previewTitle.textContent = item.name || 'Xem trước';
            previewBody.innerHTML = '<div class="text-sm text-gray-400">Đang tải xem trước...</div>';

            const downloadUrl = getDownloadUrl(item);
            const visual = getItemVisual(item);
            const previewKind = getPreviewKind(item);
            const historyPromise = loadEditHistory(item.path);
            const metaHtml = `
                <div class="text-xs text-gray-400 mt-2">Dung lượng: ${escapeHtml(formatSize(item.size))} • Sửa lần cuối: ${escapeHtml(formatDateLabel(item.modifiedAt))}</div>
            `;

            if (previewKind !== 'none') {
                try {
                    const historyItems = await historyPromise;
                    let historyHtml = renderHistoryHtml(historyItems);
                    let previewContent = '';
                    if (previewKind === 'text') {
                        let content = '';
                        try {
                            const relPath = toRelativePath(item.path);
                            const textData = await apiRequest(`/api/cloud/content?path=${encodeURIComponent(relPath)}`);
                            content = String(textData?.content ?? '');
                            historyHtml = renderHistoryHtml(textData?.items || historyItems);
                        } catch (_contentError) {
                            // Fallback: preview text directly from download endpoint if content API is unavailable.
                            const fallbackResponse = await fetch(downloadUrl, { credentials: 'include' });
                            if (!fallbackResponse.ok) throw new Error(`Lỗi HTTP ${fallbackResponse.status}`);
                            content = await fallbackResponse.text();
                        }
                        previewContent = `
                            <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                <pre class="text-xs md:text-sm text-gray-700 whitespace-pre max-h-[65vh] overflow-auto font-mono">${escapeHtml(content)}</pre>
                            </div>
                        `;
                    } else {
                        clearPreviewUrl();
                        const response = await fetch(downloadUrl, { credentials: 'include' });
                        if (!response.ok) throw new Error(`Lỗi HTTP ${response.status}`);
                        const blob = await response.blob();
                        state.previewUrl = URL.createObjectURL(blob);
                        if (previewKind === 'image') {
                            previewContent = `
                                <div class="max-h-[65vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-2 flex items-center justify-center">
                                    <img src="${escapeHtml(state.previewUrl)}" alt="${escapeHtml(item.name || 'Ảnh xem trước')}" class="max-w-full max-h-[62vh] object-contain rounded-md">
                                </div>
                            `;
                        } else if (previewKind === 'pdf') {
                            previewContent = `
                                <div class="rounded-lg border border-gray-200 overflow-hidden bg-gray-100">
                                    <iframe src="${escapeHtml(state.previewUrl)}" title="${escapeHtml(item.name || 'PDF preview')}" class="w-full h-[65vh]"></iframe>
                                </div>
                            `;
                        } else if (previewKind === 'video') {
                            previewContent = `
                                <div class="rounded-lg border border-gray-200 overflow-hidden bg-black">
                                    <video src="${escapeHtml(state.previewUrl)}" controls class="w-full max-h-[65vh] bg-black"></video>
                                </div>
                            `;
                        } else if (previewKind === 'audio') {
                            previewContent = `
                                <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                                    <div class="text-sm text-gray-500 mb-3">Phát thử audio:</div>
                                    <audio src="${escapeHtml(state.previewUrl)}" controls class="w-full"></audio>
                                </div>
                            `;
                        }
                    }
                    previewBody.innerHTML = `
                        <div class="space-y-3">
                            ${previewContent}
                            ${metaHtml}
                            <div class="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Nhật ký chỉnh sửa</div>
                                ${historyHtml}
                            </div>
                            <div>
                                <a href="${escapeHtml(downloadUrl)}" class="inline-flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors">
                                    <i class="fas fa-download"></i>Tải file
                                </a>
                            </div>
                        </div>
                    `;
                    return;
                } catch (error) {
                    previewBody.innerHTML = `
                        <div class="text-sm text-red-500 mb-2">Không thể tải preview file: ${escapeHtml(error.message || 'Lỗi không xác định')}</div>
                        <a href="${escapeHtml(downloadUrl)}" class="inline-flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors">
                            <i class="fas fa-download"></i>Tải file
                        </a>
                    `;
                    return;
                }
            }

            previewBody.innerHTML = `
                <div class="rounded-lg border border-gray-200 bg-gray-50 p-5">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-lg ${visual.bg} border border-gray-200 flex items-center justify-center ${visual.accent}">
                            <i class="fas ${visual.icon} ${visual.previewSizeClass || 'text-lg'}"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-gray-700 truncate">${escapeHtml(item.name || 'Không tên')}</div>
                            ${metaHtml}
                        </div>
                    </div>
                    <div class="mt-4">
                        <a href="${escapeHtml(downloadUrl)}" class="inline-flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors">
                            <i class="fas fa-download"></i>Tải file
                        </a>
                    </div>
                </div>
            `;
        }

        function closeEditorModal() {
            editorModal.classList.add('hidden');
            editorTitle.textContent = 'Chỉnh sửa file';
            editorStatus.textContent = '';
            editorStatus.className = 'text-xs text-gray-400';
            editorTextarea.value = '';
            editorHistory.innerHTML = '';
            state.editorTargetItem = null;
            editorSaveBtn.disabled = false;
            editorSaveBtn.className = 'px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors';
        }

        async function openEditorModal(item) {
            if (!item || item.type !== 'file' || !item.path || !isEditableTextFile(item)) return;
            closeActionMenu();
            closePreviewModal();
            state.editorTargetItem = item;
            editorModal.classList.remove('hidden');
            editorTitle.textContent = `Chỉnh sửa: ${item.name || 'Không tên'}`;
            editorStatus.textContent = 'Đang tải nội dung...';
            editorHistory.innerHTML = '<div class="text-xs text-gray-400">Đang tải nhật ký...</div>';
            try {
                const relPath = toRelativePath(item.path);
                const data = await apiRequest(`/api/cloud/content?path=${encodeURIComponent(relPath)}`);
                editorTextarea.value = String(data?.content ?? '');
                editorHistory.innerHTML = `
                    <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Nhật ký chỉnh sửa</div>
                    ${renderHistoryHtml(data?.items || [])}
                `;
                editorStatus.textContent = 'Sẵn sàng chỉnh sửa.';
                editorStatus.className = 'text-xs text-gray-400';
            } catch (error) {
                editorTextarea.value = '';
                editorStatus.textContent = error.message || 'Không thể tải nội dung file.';
                editorStatus.className = 'text-xs text-red-500';
            }
        }

        function openActionMenu(item, anchorElement) {
            state.menuTargetItem = item;
            const rect = anchorElement.getBoundingClientRect();
            rowActionMenu.style.left = `${Math.max(8, rect.right - 170)}px`;
            rowActionMenu.style.top = `${rect.bottom + 6}px`;
            if (state.currentSidebarMode === 'trash') {
                menuPrimary.innerHTML = '<i class="fas fa-rotate-left mr-2 text-blue-400"></i>Khôi phục';
                menuSecondary.innerHTML = '<i class="fas fa-trash-can mr-2 text-red-400"></i>Xóa vĩnh viễn';
                menuTertiary.classList.add('hidden');
            } else {
                menuPrimary.innerHTML = '<i class="fas fa-trash mr-2 text-red-400"></i>Bỏ vào thùng rác';
                menuSecondary.innerHTML = '<i class="fas fa-pen mr-2 text-blue-400"></i>Đổi tên';
                if (isEditableTextFile(item)) {
                    menuTertiary.innerHTML = '<i class="fas fa-pen-to-square mr-2 text-emerald-500"></i>Chỉnh sửa file';
                    menuTertiary.classList.remove('hidden');
                } else {
                    menuTertiary.classList.add('hidden');
                }
            }
            rowActionMenu.classList.remove('hidden');
        }

        function findItemByIdentity(identity = {}) {
            const list = getCurrentItems();
            if (identity.id) return list.find((item) => item.id === identity.id) || null;
            if (identity.path) return list.find((item) => item.path === identity.path) || null;
            if (identity.trashedPath) return list.find((item) => item.trashedPath === identity.trashedPath) || null;
            return null;
        }

        function renderAll() {
            renderHeader();
            const items = getCurrentItems();
            renderListView(items);
            renderGridView(items);
            showStatus(`Hiển thị ${items.length} mục`);
        }

        async function loadStorage() {
            try {
                const data = await apiRequest('/api/cloud/storage');
                const used = Number(data?.usedBytes || 0);
                const percent = Math.min(100, Math.max(0, (used / QUOTA_BYTES) * 100));
                storageLabel.textContent = `${percent.toFixed(1)}%`;
                storageBar.style.width = `${percent.toFixed(1)}%`;
            } catch (_error) {
                storageLabel.textContent = '--';
                storageBar.style.width = '0%';
            }
        }
        async function loadItems() {
            closePreviewModal();
            closeActionMenu();
            try {
                showStatus('Đang tải dữ liệu...');
                if (state.currentSidebarMode === 'trash') {
                    const trashData = await apiRequest(`/api/cloud/trash?q=${encodeURIComponent(state.currentQuery)}`);
                    state.trashItems = trashData?.items || [];
                } else {
                    const query = new URLSearchParams({ path: state.currentPath, q: state.currentQuery });
                    const fileData = await apiRequest(`/api/cloud/files?${query.toString()}`);
                    state.currentPath = normalizeClientPath(fileData?.currentPath || state.currentPath);
                    state.activeItems = fileData?.items || [];
                }
                renderAll();
            } catch (error) {
                renderListView([]);
                renderGridView([]);
                showStatus(error.message, true);
                if (String(error.message).toLowerCase().includes('đăng nhập')) {
                    setTimeout(() => { window.location.href = '/'; }, 800);
                }
            }
        }

        async function refreshAll() { await Promise.all([loadStorage(), loadItems()]); }

        async function handleOpenItem(item) {
            if (state.currentSidebarMode === 'trash' || !item) return;
            if (item.type === 'folder') {
                state.currentPath = normalizeClientPath(item.path || '/');
                state.currentSidebarMode = 'all';
                setActiveSidebarLink('all');
                await loadItems();
                return;
            }
            await openPreviewModal(item);
        }

        function extractItemIdentityFromRow(row) {
            return { id: row?.dataset?.id, path: row?.dataset?.path, trashedPath: row?.dataset?.trashedPath };
        }
        function extractItemIdentityFromButton(btn) {
            return { id: btn?.dataset?.itemId, path: btn?.dataset?.itemPath, trashedPath: btn?.dataset?.itemTrashedPath };
        }

        menuToggle.addEventListener('click', () => { sidebar.classList.toggle('-translate-x-full'); });
        breadcrumb.addEventListener('click', async () => {
            if (state.currentSidebarMode === 'trash') return;
            const rel = toRelativePath(state.currentPath);
            if (!rel) return;
            const parts = rel.split('/').filter(Boolean);
            parts.pop();
            state.currentPath = parts.length ? `/${parts.join('/')}` : '/';
            state.currentSidebarMode = 'all';
            setActiveSidebarLink('all');
            await loadItems();
        });

        document.addEventListener('click', (event) => {
            if (window.innerWidth >= 768) return;
            const clickedInsideSidebar = event.target.closest('#sidebar');
            const clickedMenuToggle = event.target.closest('#menu-toggle');
            const isSidebarOpen = !sidebar.classList.contains('-translate-x-full');
            if (isSidebarOpen && !clickedInsideSidebar && !clickedMenuToggle) sidebar.classList.add('-translate-x-full');
        });

        allFilesLink.addEventListener('click', async (event) => {
            event.preventDefault();
            state.currentSidebarMode = 'all';
            state.currentQuery = searchInput.value.trim();
            setActiveSidebarLink('all');
            await loadItems();
        });

        recentFilesLink.addEventListener('click', async (event) => {
            event.preventDefault();
            state.currentSidebarMode = 'recent';
            state.currentQuery = searchInput.value.trim();
            setActiveSidebarLink('recent');
            await loadItems();
        });

        trashFilesLink.addEventListener('click', async (event) => {
            event.preventDefault();
            state.currentSidebarMode = 'trash';
            state.currentQuery = searchInput.value.trim();
            setActiveSidebarLink('trash');
            await loadItems();
        });

        viewListBtn.addEventListener('click', () => setViewMode('list'));
        viewGridBtn.addEventListener('click', () => setViewMode('grid'));

        createFolderBtn.addEventListener('click', async () => {
            if (state.currentSidebarMode === 'trash') return;
            const folderName = prompt('Nhập tên folder mới:', 'Folder_moi');
            if (!folderName || !folderName.trim()) return;
            try {
                await apiRequest('/api/cloud/folder', { method: 'POST', body: JSON.stringify({ path: state.currentPath, name: folderName.trim() }) });
                await refreshAll();
            } catch (error) { showStatus(error.message, true); }
        });

        createFileBtn.addEventListener('click', async () => {
            if (state.currentSidebarMode === 'trash') return;
            const fileName = prompt('Nhập tên file mới:', 'Tep_moi.txt');
            if (!fileName || !fileName.trim()) return;
            try {
                await apiRequest('/api/cloud/file', { method: 'POST', body: JSON.stringify({ path: state.currentPath, name: fileName.trim() }) });
                await refreshAll();
            } catch (error) { showStatus(error.message, true); }
        });

        uploadBtn.addEventListener('click', () => { if (state.currentSidebarMode !== 'trash') uploadInput.click(); });

        uploadInput.addEventListener('change', async () => {
            const files = Array.from(uploadInput.files || []);
            if (!files.length) return;
            const form = new FormData();
            form.append('path', state.currentPath);
            files.forEach((file) => form.append('files', file));
            try {
                await apiRequest('/api/cloud/upload', { method: 'POST', body: form });
                await refreshAll();
            } catch (error) {
                showStatus(error.message, true);
            } finally {
                uploadInput.value = '';
            }
        });

        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                state.currentQuery = searchInput.value.trim();
                await loadItems();
            }, 250);
        });
        menuPrimary.addEventListener('click', async () => {
            const item = state.menuTargetItem;
            if (!item) return;
            try {
                if (state.currentSidebarMode === 'trash') {
                    await apiRequest('/api/cloud/trash/restore', { method: 'POST', body: JSON.stringify({ id: item.id }) });
                } else {
                    await apiRequest('/api/cloud/move-to-trash', { method: 'POST', body: JSON.stringify({ path: toRelativePath(item.path) }) });
                }
                closeActionMenu();
                await refreshAll();
            } catch (error) { showStatus(error.message, true); }
        });

        menuSecondary.addEventListener('click', async () => {
            const item = state.menuTargetItem;
            if (!item) return;
            try {
                if (state.currentSidebarMode === 'trash') {
                    await apiRequest(`/api/cloud/trash/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                } else {
                    const nextName = prompt('Nhập tên mới:', item.name || '');
                    if (!nextName || !nextName.trim()) { closeActionMenu(); return; }
                    await apiRequest('/api/cloud/rename', { method: 'PATCH', body: JSON.stringify({ path: toRelativePath(item.path), newName: nextName.trim() }) });
                }
                closeActionMenu();
                await refreshAll();
            } catch (error) { showStatus(error.message, true); }
        });
        menuTertiary.addEventListener('click', async () => {
            const item = state.menuTargetItem;
            if (!item || state.currentSidebarMode === 'trash') return;
            await openEditorModal(item);
        });

        fileListBody.addEventListener('click', async (event) => {
            const actionsBtn = event.target.closest('.row-actions-btn');
            if (actionsBtn) {
                const row = actionsBtn.closest('tr');
                const item = findItemByIdentity(extractItemIdentityFromRow(row));
                if (!item) return;
                openActionMenu(item, actionsBtn);
                return;
            }
            const row = event.target.closest('tr');
            if (!row || event.target.closest('button')) return;
            const item = findItemByIdentity(extractItemIdentityFromRow(row));
            if (item) await handleOpenItem(item);
        });

        gridView.addEventListener('click', async (event) => {
            const actionsBtn = event.target.closest('.grid-actions-btn');
            if (actionsBtn) {
                const item = findItemByIdentity(extractItemIdentityFromButton(actionsBtn));
                if (!item) return;
                openActionMenu(item, actionsBtn);
                return;
            }
            const card = event.target.closest('article');
            if (!card || event.target.closest('button')) return;
            const item = findItemByIdentity({ id: card.dataset.itemId, path: card.dataset.itemPath, trashedPath: card.dataset.itemTrashedPath });
            if (item) await handleOpenItem(item);
        });

        document.addEventListener('click', (event) => {
            const clickedMenu = event.target.closest('#row-action-menu');
            const clickedActionsBtn = event.target.closest('.row-actions-btn, .grid-actions-btn');
            if (!clickedMenu && !clickedActionsBtn) closeActionMenu();
        });

        previewCloseBtn.addEventListener('click', closePreviewModal);
        previewModal.addEventListener('click', (event) => {
            if (event.target === previewModal) closePreviewModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !previewModal.classList.contains('hidden')) closePreviewModal();
            if (event.key === 'Escape' && !editorModal.classList.contains('hidden')) closeEditorModal();
        });

        editorCloseBtn.addEventListener('click', closeEditorModal);
        editorCancelBtn.addEventListener('click', closeEditorModal);
        editorModal.addEventListener('click', (event) => {
            if (event.target === editorModal) closeEditorModal();
        });
        editorSaveBtn.addEventListener('click', async () => {
            const item = state.editorTargetItem;
            if (!item || !item.path) return;
            editorSaveBtn.disabled = true;
            editorSaveBtn.className = 'px-3 py-2 text-sm rounded-lg bg-blue-300 text-white transition-colors cursor-not-allowed';
            editorStatus.textContent = 'Đang lưu thay đổi...';
            editorStatus.className = 'text-xs text-gray-400';
            try {
                const data = await apiRequest('/api/cloud/content', {
                    method: 'PATCH',
                    body: JSON.stringify({
                        path: item.path,
                        content: editorTextarea.value
                    })
                });
                editorStatus.textContent = 'Đã lưu thành công.';
                editorStatus.className = 'text-xs text-emerald-600';
                editorHistory.innerHTML = `
                    <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Nhật ký chỉnh sửa</div>
                    ${renderHistoryHtml(data?.items || [])}
                `;
                await refreshAll();
            } catch (error) {
                editorStatus.textContent = error.message || 'Không thể lưu file.';
                editorStatus.className = 'text-xs text-red-500';
            } finally {
                editorSaveBtn.disabled = false;
                editorSaveBtn.className = 'px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors';
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) sidebar.classList.remove('-translate-x-full');
            else sidebar.classList.add('-translate-x-full');
            closeActionMenu();
        });

        async function bootstrap() {
            setViewMode('list');
            setActiveSidebarLink('all');
            try {
                const userInfo = await fetch('/api/user-info', { credentials: 'include' }).then((res) => res.json());
                if (!userInfo?.loggedIn) {
                    showStatus('Bạn chưa đăng nhập. Đang chuyển hướng...', true);
                    setTimeout(() => { window.location.href = '/'; }, 800);
                    return;
                }
                setUserAvatar(userInfo);
            } catch (_error) {
                showStatus('Không kiểm tra được đăng nhập.', true);
            }
            await refreshAll();
        }

        userAvatarImg.addEventListener('error', () => {
            userAvatarImg.classList.add('hidden');
            userAvatarFallback.classList.remove('hidden');
        });

        bootstrap();