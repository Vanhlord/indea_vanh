const form = document.getElementById('downloadForm');
        const statusMessage = document.getElementById('statusMessage');
        const downloadList = document.getElementById('downloadList');
        const refreshListBtn = document.getElementById('refreshList');
        const filePicker = document.getElementById('filePicker');
        const refreshFilesBtn = document.getElementById('refreshFiles');
        const urlInput = document.getElementById('url');

        function setStatus(text, ok = true) {
            statusMessage.textContent = text;
            statusMessage.className = 'mt-4 text-sm font-medium ' + (ok ? 'text-emerald-600' : 'text-red-600');
            statusMessage.classList.remove('hidden');
        }

        async function loadDownloads() {
            if (!downloadList) return;
            downloadList.textContent = 'Đang tải danh sách...';
            try {
                const res = await fetch('/api/admin/minecraft-downloads');
                const data = await res.json();
                if (!res.ok || !data.success) {
                    downloadList.textContent = data.error || 'Không thể tải danh sách.';
                    return;
                }

                if (!data.items || data.items.length === 0) {
                    downloadList.textContent = 'Chưa có nút tải nào.';
                    return;
                }

                downloadList.innerHTML = '';
                data.items.forEach((item) => {
                    const row = document.createElement('div');
                    row.className = 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl border border-gray-200 p-4 bg-gray-50';

                    const info = document.createElement('div');
                    info.className = 'min-w-0';
                    const title = document.createElement('div');
                    title.className = 'font-semibold text-gray-900 truncate';
                    title.textContent = item.title || 'Không có tiêu đề';
                    const meta = document.createElement('div');
                    meta.className = 'text-xs text-gray-500 mt-1 break-all';
                    meta.textContent = `${item.version || 'Không có mô tả'} • ${item.url || ''}`;
                    info.appendChild(title);
                    info.appendChild(meta);

                    const actions = document.createElement('div');
                    actions.className = 'flex items-center gap-2';
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600';
                    delBtn.textContent = 'Xóa';
                    delBtn.addEventListener('click', async () => {
                        if (!confirm('Xóa nút tải này?')) return;
                        try {
                            const resp = await fetch(`/api/admin/minecraft-downloads/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                            const respData = await resp.json().catch(() => ({}));
                            if (!resp.ok || !respData.success) {
                                setStatus(respData.error || 'Không thể xóa.', false);
                                return;
                            }
                            setStatus('Đã xóa nút tải.');
                            loadDownloads();
                        } catch (_err) {
                            setStatus('Lỗi kết nối máy chủ.', false);
                        }
                    });

                    actions.appendChild(delBtn);
                    row.appendChild(info);
                    row.appendChild(actions);
                    downloadList.appendChild(row);
                });
            } catch (_error) {
                downloadList.textContent = 'Lỗi kết nối máy chủ.';
            }
        }

        function formatBytes(bytes) {
            const value = Number(bytes || 0);
            if (!Number.isFinite(value) || value <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            let idx = 0;
            let num = value;
            while (num >= 1024 && idx < units.length - 1) {
                num /= 1024;
                idx += 1;
            }
            return `${num.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
        }

        async function loadMinecraftFiles() {
            if (!filePicker) return;
            filePicker.innerHTML = '<option value="">-- Chọn file có sẵn --</option>';
            try {
                const res = await fetch('/api/admin/minecraft-files');
                const data = await res.json();
                if (!res.ok || !data.success) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = data.error || 'Không thể tải danh sách file.';
                    opt.disabled = true;
                    filePicker.appendChild(opt);
                    return;
                }

                if (!data.items || data.items.length === 0) {
                    const opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'Thư mục Minecraft chưa có file.';
                    opt.disabled = true;
                    filePicker.appendChild(opt);
                    return;
                }

                data.items.forEach((item) => {
                    const opt = document.createElement('option');
                    opt.value = item.url || '';
                    const sizeLabel = formatBytes(item.size);
                    opt.textContent = `${item.name} (${sizeLabel})`;
                    filePicker.appendChild(opt);
                });
            } catch (_error) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'Lỗi kết nối máy chủ.';
                opt.disabled = true;
                filePicker.appendChild(opt);
            }
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const payload = {
                title: document.getElementById('title').value.trim(),
                version: document.getElementById('version').value.trim(),
                url: document.getElementById('url').value.trim()
            };

            try {
                const res = await fetch('/api/admin/minecraft-downloads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    setStatus(data.error || 'Không thể thêm nút tải.', false);
                    return;
                }
                setStatus('Đã thêm nút tải thành công!');
                form.reset();
                loadDownloads();
            } catch (err) {
                setStatus('Lỗi kết nối máy chủ.', false);
            }
        });

        if (refreshListBtn) {
            refreshListBtn.addEventListener('click', () => loadDownloads());
        }
        loadDownloads();

        if (filePicker && urlInput) {
            filePicker.addEventListener('change', () => {
                if (filePicker.value) {
                    urlInput.value = filePicker.value;
                }
            });
        }
        if (refreshFilesBtn) {
            refreshFilesBtn.addEventListener('click', () => loadMinecraftFiles());
        }
        loadMinecraftFiles();