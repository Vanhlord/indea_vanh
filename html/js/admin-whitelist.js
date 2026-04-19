const form = document.getElementById('whitelistForm');
        const listEl = document.getElementById('whitelistList');
        const statusEl = document.getElementById('statusMessage');
        const refreshBtn = document.getElementById('refreshBtn');
        const generateKeyBtn = document.getElementById('generateKeyBtn');
        const configForm = document.getElementById('configForm');
        const configStatus = document.getElementById('configStatus');
        const keyInput = document.getElementById('keyInput');
        const suggestedKeysEl = document.getElementById('suggestedKeys');
        const panelUrlInput = document.getElementById('panelUrlInput');
        const serverIdInput = document.getElementById('serverIdInput');
        const apiKeyInput = document.getElementById('apiKeyInput');
        const commandInput = document.getElementById('commandInput');
        const removeCommandInput = document.getElementById('removeCommandInput');
        const formSubmitBtn = form.querySelector('button[type="submit"]');
        const configSubmitBtn = configForm.querySelector('button[type="submit"]');
        const effectForm = document.getElementById('effectForm');
        const effectStatus = document.getElementById('effectStatus');
        const effectGamertagInput = document.getElementById('effectGamertagInput');
        const effectSubmitBtn = effectForm.querySelector('button[type="submit"]');
        const terminalStatus = document.getElementById('terminalStatus');
        const terminalOutput = document.getElementById('terminalOutput');
        const terminalConnectBtn = document.getElementById('terminalConnectBtn');
        const terminalDisconnectBtn = document.getElementById('terminalDisconnectBtn');
        const terminalClearBtn = document.getElementById('terminalClearBtn');
        const terminalPowerStatus = document.getElementById('terminalPowerStatus');
        const adminSocket = typeof io === 'function' ? io() : null;
        const terminalLines = [];
        const TERMINAL_LINE_LIMIT = 300;
        let terminalSubscribed = false;
        let currentWhitelistItems = [];

        function setStatus(text, ok = true) {
            if (!text) {
                statusEl.textContent = '';
                statusEl.className = 'status';
                return;
            }
            statusEl.textContent = text;
            statusEl.className = `status ${ok ? 'ok' : 'err'}`;
        }

        function formatTime(value) {
            if (!value) return '-';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return value;
            return date.toLocaleString('vi-VN');
        }

        function setConfigStatus(text, ok = true) {
            if (!text) {
                configStatus.textContent = '';
                configStatus.className = 'status';
                return;
            }
            configStatus.textContent = text;
            configStatus.className = `status ${ok ? 'ok' : 'err'}`;
        }

        function setEffectStatus(text, ok = true) {
            if (!text) {
                effectStatus.textContent = '';
                effectStatus.className = 'status';
                return;
            }
            effectStatus.textContent = text;
            effectStatus.className = `status ${ok ? 'ok' : 'err'}`;
        }

        function setTerminalStatus(text, ok = true) {
            if (!text) {
                terminalStatus.textContent = '';
                terminalStatus.className = 'status';
                return;
            }
            terminalStatus.textContent = text;
            terminalStatus.className = `status ${ok ? 'ok' : 'err'}`;
        }

        function renderTerminal() {
            if (terminalLines.length === 0) {
                terminalOutput.textContent = 'Đang chờ kết nối terminal realtime...';
                terminalOutput.classList.add('terminal-empty');
                return;
            }

            terminalOutput.classList.remove('terminal-empty');
            terminalOutput.textContent = terminalLines.join('\n');
            terminalOutput.scrollTop = terminalOutput.scrollHeight;
        }

        function appendTerminalLine(line) {
            const text = String(line ?? '').trimEnd();
            if (!text) return;

            terminalLines.push(text);
            if (terminalLines.length > TERMINAL_LINE_LIMIT) {
                terminalLines.splice(0, terminalLines.length - TERMINAL_LINE_LIMIT);
            }
            renderTerminal();
        }

        function replaceTerminalLines(lines) {
            terminalLines.length = 0;
            (Array.isArray(lines) ? lines : []).forEach((item) => {
                const text = typeof item === 'string' ? item : item?.line;
                if (text) {
                    terminalLines.push(String(text).trimEnd());
                }
            });

            if (terminalLines.length > TERMINAL_LINE_LIMIT) {
                terminalLines.splice(0, terminalLines.length - TERMINAL_LINE_LIMIT);
            }
            renderTerminal();
        }

        function setTerminalPowerBadge(status) {
            const normalized = String(status || '').trim().toLowerCase();
            const label = normalized || 'unknown';
            terminalPowerStatus.textContent = `Server: ${label}`;
            terminalPowerStatus.className = `badge ${normalized === 'running' ? 'pending' : normalized === 'offline' ? 'used' : 'processing'}`;
        }

        function subscribeTerminal(force = false) {
            if (!adminSocket) {
                setTerminalStatus('Socket realtime không khả dụng trên trang này.', false);
                return;
            }
            if (terminalSubscribed && !force) {
                return;
            }
            terminalSubscribed = true;
            setTerminalStatus('Đang yêu cầu kết nối terminal realtime...', true);
            adminSocket.emit('admin-console:subscribe');
        }

        function unsubscribeTerminal() {
            if (!adminSocket || !terminalSubscribed) return;
            terminalSubscribed = false;
            adminSocket.emit('admin-console:unsubscribe');
            setTerminalStatus('Đã ngắt terminal realtime.', true);
        }

        function clearSuggestedKeys() {
            suggestedKeysEl.innerHTML = '';
            suggestedKeysEl.hidden = true;
        }

        function buildSuggestedWhitelistKeys(items, count = 6) {
            const existingKeys = new Set(
                (Array.isArray(items) ? items : [])
                    .map((item) => String(item?.key || '').trim())
                    .filter(Boolean)
            );
            const generatedKeys = new Set();
            let attempts = 0;
            const maxAttempts = 5000;

            while (generatedKeys.size < count && attempts < maxAttempts) {
                const candidate = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
                attempts += 1;

                if (existingKeys.has(candidate) || generatedKeys.has(candidate)) {
                    continue;
                }

                generatedKeys.add(candidate);
            }

            return Array.from(generatedKeys);
        }

        function renderSuggestedKeys(keys) {
            clearSuggestedKeys();
            if (!Array.isArray(keys) || keys.length === 0) {
                return;
            }

            suggestedKeysEl.hidden = false;

            keys.forEach((key) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'suggestion-chip';
                chip.textContent = key;
                chip.addEventListener('click', () => {
                    keyInput.value = key;
                    keyInput.focus();
                    keyInput.setSelectionRange(key.length, key.length);
                    suggestedKeysEl.querySelectorAll('.suggestion-chip').forEach((item) => item.classList.remove('active'));
                    chip.classList.add('active');
                    setStatus(`Đã chọn mã: ${key}`, true);
                });
                suggestedKeysEl.appendChild(chip);
            });
        }

        async function loadConfig() {
            try {
                const resp = await fetch('/api/admin/pikamc-config');
                const data = await resp.json();
                if (!resp.ok || !data.success) {
                    setConfigStatus(data.error || 'Không thể tải cấu hình.', false);
                    return;
                }
                const cfg = data.data || {};
                panelUrlInput.value = cfg.panelUrl || '';
                serverIdInput.value = cfg.serverId || '';
                commandInput.value = cfg.whitelistCommandTemplate || 'whitelist add \"{gamertag}\"';
                removeCommandInput.value = cfg.whitelistRemoveCommandTemplate || 'whitelist remove \"{gamertag}\"';
                if (cfg.hasApiKey) {
                    apiKeyInput.placeholder = cfg.apiKeyMasked ? `Đã lưu (${cfg.apiKeyMasked})` : 'Đã lưu';
                } else {
                    apiKeyInput.placeholder = 'Chưa có API key';
                }
                setConfigStatus('');
            } catch (_err) {
                setConfigStatus('Lỗi kết nối máy chủ.', false);
            }
        }

        function renderList(items) {
            currentWhitelistItems = Array.isArray(items) ? items : [];
            listEl.innerHTML = '';
            if (!items || items.length === 0) {
                listEl.innerHTML = '<div class="empty">Chưa có whitelist nào.</div>';
                return;
            }

            items.forEach((item) => {
                const card = document.createElement('div');
                card.className = 'list-card';

                const info = document.createElement('div');
                const title = document.createElement('h3');
                title.textContent = `${item.key} · ${item.gamertag}`;

                const meta = document.createElement('div');
                meta.className = 'meta';

                const statusBadge = document.createElement('span');
                const statusName = item.status === 'used'
                    ? 'used'
                    : item.status === 'processing'
                        ? 'processing'
                        : 'pending';
                statusBadge.className = `badge ${statusName}`;
                statusBadge.textContent = item.status === 'used'
                    ? 'Đã kích hoạt'
                    : item.status === 'processing'
                        ? 'Đang xử lý'
                        : 'Chưa kích hoạt';

                const created = document.createElement('span');
                created.textContent = `Tạo: ${formatTime(item.created_at)}`;

                const used = document.createElement('span');
                used.textContent = `Kích hoạt: ${formatTime(item.used_at)}`;

                meta.appendChild(statusBadge);
                meta.appendChild(created);
                meta.appendChild(used);

                info.appendChild(title);
                info.appendChild(meta);

                const action = document.createElement('div');
                const delBtn = document.createElement('button');
                delBtn.className = 'btn-delete';
                delBtn.textContent = item.status === 'processing' ? 'Đang xử lý' : 'Xóa';
                delBtn.disabled = item.status === 'processing';
                delBtn.addEventListener('click', async () => {
                    if (!confirm(`Xóa whitelist cho ${item.gamertag}?`)) return;
                    delBtn.disabled = true;
                    delBtn.textContent = 'Đang xóa...';
                    try {
                        const resp = await fetch(`/api/admin/whitelist-keys/${item.id}`, { method: 'DELETE' });
                        const data = await resp.json().catch(() => ({}));
                        if (!resp.ok || !data.success) {
                            setStatus(data.error || 'Không thể xóa.', false);
                            return;
                        }
                        setStatus('Đã xóa whitelist.', true);
                        await loadList();
                    } catch (_err) {
                        setStatus('Lỗi kết nối máy chủ.', false);
                        delBtn.disabled = false;
                        delBtn.textContent = 'Xóa';
                    }
                });
                action.appendChild(delBtn);

                card.appendChild(info);
                card.appendChild(action);
                listEl.appendChild(card);
            });
        }

        async function loadList() {
            currentWhitelistItems = [];
            clearSuggestedKeys();
            listEl.innerHTML = '<div class="empty">Đang tải dữ liệu...</div>';
            try {
                const resp = await fetch('/api/admin/whitelist-keys');
                const data = await resp.json();
                if (!resp.ok || !data.success) {
                    listEl.innerHTML = `<div class="empty">${data.error || 'Không thể tải danh sách.'}</div>`;
                    return;
                }
                renderList(data.items);
            } catch (_err) {
                listEl.innerHTML = '<div class="empty">Lỗi kết nối máy chủ.</div>';
            }
        }

        generateKeyBtn.addEventListener('click', () => {
            const suggestedKeys = buildSuggestedWhitelistKeys(currentWhitelistItems, 6);
            if (suggestedKeys.length === 0) {
                setStatus('Không thể tạo mã ngẫu nhiên lúc này.', false);
                return;
            }

            renderSuggestedKeys(suggestedKeys);
            keyInput.focus();
            setStatus('Đã tạo 6 mã số ngẫu nhiên chưa bị trùng. Chạm vào một mã để điền nhanh.', true);
        });

        function setFormSubmitting(isSubmitting) {
            formSubmitBtn.disabled = isSubmitting;
            refreshBtn.disabled = isSubmitting;
            generateKeyBtn.disabled = isSubmitting;
            formSubmitBtn.innerHTML = isSubmitting
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Đang thêm...'
                : '<i class="fa-solid fa-plus"></i> Thêm whitelist';
        }

        function setConfigSubmitting(isSubmitting) {
            configSubmitBtn.disabled = isSubmitting;
            configSubmitBtn.innerHTML = isSubmitting
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...'
                : '<i class="fa-solid fa-floppy-disk"></i> Lưu cấu hình';
        }

        function setEffectSubmitting(isSubmitting) {
            effectSubmitBtn.disabled = isSubmitting;
            effectGamertagInput.disabled = isSubmitting;
            effectSubmitBtn.innerHTML = isSubmitting
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi...'
                : '<i class="fa-solid fa-bolt"></i> Thêm hiệu ứng sức mạnh';
        }

        terminalConnectBtn.addEventListener('click', () => subscribeTerminal(true));
        terminalDisconnectBtn.addEventListener('click', () => unsubscribeTerminal());
        terminalClearBtn.addEventListener('click', () => {
            terminalLines.length = 0;
            renderTerminal();
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const payload = {
                key: document.getElementById('keyInput').value.trim(),
                gamertag: document.getElementById('gamertagInput').value.trim()
            };

            setFormSubmitting(true);
            setStatus('Đang thêm whitelist...', true);

            try {
                const resp = await fetch('/api/admin/whitelist-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) {
                    setStatus(data.error || 'Không thể thêm whitelist.', false);
                    return;
                }
                setStatus('Thêm whitelist thành công!', true);
                form.reset();
                clearSuggestedKeys();
                await loadList();
            } catch (_err) {
                setStatus('Lỗi kết nối máy chủ.', false);
            } finally {
                setFormSubmitting(false);
            }
        });

        configForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const payload = {
                panelUrl: panelUrlInput.value.trim(),
                serverId: serverIdInput.value.trim(),
                apiKey: apiKeyInput.value.trim(),
                whitelistCommandTemplate: commandInput.value.trim(),
                whitelistRemoveCommandTemplate: removeCommandInput.value.trim()
            };

            setConfigSubmitting(true);
            setConfigStatus('Đang lưu cấu hình...', true);

            try {
                const resp = await fetch('/api/admin/pikamc-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) {
                    setConfigStatus(data.error || 'Không thể lưu cấu hình.', false);
                    return;
                }
                apiKeyInput.value = '';
                const cfg = data.data || {};
                commandInput.value = cfg.whitelistCommandTemplate || commandInput.value;
                removeCommandInput.value = cfg.whitelistRemoveCommandTemplate || removeCommandInput.value;
                if (cfg.hasApiKey) {
                    apiKeyInput.placeholder = cfg.apiKeyMasked ? `Đã lưu (${cfg.apiKeyMasked})` : 'Đã lưu';
                }
                setConfigStatus('Đã lưu cấu hình PikaMC!', true);
            } catch (_err) {
                setConfigStatus('Lỗi kết nối máy chủ.', false);
            } finally {
                setConfigSubmitting(false);
            }
        });

        effectForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const payload = {
                gamertag: effectGamertagInput.value.trim()
            };

            setEffectSubmitting(true);
            setEffectStatus('Đang gửi lệnh Strength...', true);

            try {
                const resp = await fetch('/api/admin/commands/strength', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || !data.success) {
                    setEffectStatus(data.error || 'Không thể gửi lệnh Strength.', false);
                    return;
                }

                setEffectStatus(`Đã gửi Strength cho ${data.gamertag}.`, true);
                effectForm.reset();
            } catch (_err) {
                setEffectStatus('Lỗi kết nối máy chủ.', false);
            } finally {
                setEffectSubmitting(false);
            }
        });

        if (adminSocket) {
            adminSocket.on('connect', () => {
                setTerminalStatus('Socket web đã kết nối. Đang nối terminal...', true);
                if (terminalSubscribed) {
                    adminSocket.emit('admin-console:subscribe');
                }
            });

            adminSocket.on('disconnect', () => {
                setTerminalStatus('Socket web bị ngắt. Chờ tự nối lại...', false);
            });

            adminSocket.on('admin-console:status', (payload) => {
                const state = String(payload?.state || '').trim().toLowerCase();
                const message = String(payload?.message || '').trim();
                const okStates = new Set(['connected', 'connecting', 'reconnecting', 'idle', 'disconnected']);
                setTerminalStatus(message || 'Terminal realtime đã cập nhật trạng thái.', okStates.has(state));
            });

            adminSocket.on('admin-console:buffer', (payload) => {
                replaceTerminalLines(payload?.lines);
            });

            adminSocket.on('admin-console:line', (payload) => {
                appendTerminalLine(payload?.line);
            });

            adminSocket.on('admin-console:power-status', (payload) => {
                setTerminalPowerBadge(payload?.status);
            });

            adminSocket.on('admin-console:event', (payload) => {
                const eventName = String(payload?.event || '').trim();
                if (!eventName) return;
                appendTerminalLine(`[event] ${eventName}`);
            });

            subscribeTerminal();
        } else {
            setTerminalStatus('Không khởi tạo được socket realtime.', false);
        }

        refreshBtn.addEventListener('click', () => loadList());
        loadList();
        loadConfig();
        renderTerminal();

// --- Split ---

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