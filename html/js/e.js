function escapeHtmlForMarkdown(input) {
            return String(input || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function formatText(symbol) {
            const textarea = document.getElementById('content');
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            const selectedText = text.substring(start, end);
            textarea.value = text.substring(0, start) + symbol + selectedText + symbol + text.substring(end);
            const newCursorPos = start + symbol.length + selectedText.length;
            textarea.focus();
            textarea.setSelectionRange(newCursorPos, newCursorPos);
            updatePreview();
        }

        function updatePreview() {
            const title = document.getElementById('title').value;
            const content = document.getElementById('content').value;
            const color = document.getElementById('color').value;
            const imgUrl = document.getElementById('imageUrl').value;

            document.getElementById('previewTitle').innerText = title || 'Tiêu đề trống';
            document.getElementById('previewBorder').style.backgroundColor = color;
            
            const previewContent = document.getElementById('previewContent');
            if (content) {
                marked.setOptions({ breaks: true, gfm: true });
                const safeMarkdown = escapeHtmlForMarkdown(content);
                // Render Markdown + Xử lý Spoiler
                let html = marked.parse(safeMarkdown);
                html = html.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler" onclick="this.classList.add(\'revealed\')">$1</span>');
                previewContent.innerHTML = html;
            } else {
                previewContent.innerText = 'Đang chờ nội dung...';
            }

            const imgPreview = document.getElementById('previewImage');
            if(imgUrl) {
                imgPreview.src = imgUrl;
                imgPreview.classList.remove('hidden');
            } else {
                imgPreview.classList.add('hidden');
            }
        }

        async function sendEmbed() {
            const btn = document.getElementById('btnSend');
            const data = {
                title: document.getElementById('title').value,
                content: document.getElementById('content').value,
                color: document.getElementById('color').value,
                image: document.getElementById('imageUrl').value,
                channel: document.getElementById('channel').value
            };
            if(!data.content) return alert('Vui lòng nhập nội dung.');

            btn.disabled = true;
            const originalText = btn.innerHTML;
            btn.innerHTML = 'ĐANG GỬI...';
            try {
                const res = await fetch('/api/discord/embed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                let body = {};
                try { body = await res.json(); } catch (e) { /* ignore */ }

                if (res.ok) {
                    alert('Gửi thành công.');
                } else {
                    console.error('Server error sending embed:', body);
                    alert('Lỗi khi gửi: ' + (body.error || body.message || 'Không rõ'));
                }
            } catch (e) {
                console.error('Network error sending embed:', e);
                alert('Lỗi mạng khi gửi embed.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }

        document.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', updatePreview));
        updatePreview(); // Chạy lần đầu

        // Bot status polling
        async function updateBotStatus() {
            const el = document.getElementById('botStatus');
            try {
                const res = await fetch('/api/bot2/status');
                const data = await res.json();
                if (data.ready) {
                    el.className = 'bg-green-500/10 text-green-500 px-4 py-2 rounded-full border border-green-500/20 text-xs font-bold';
                    el.innerText = '● BOT READY';
                } else {
                    el.className = 'bg-red-500/10 text-red-500 px-4 py-2 rounded-full border border-red-500/20 text-xs font-bold';
                    el.innerText = '● BOT NOT READY';
                }
            } catch (e) {
                el.className = 'bg-yellow-500/10 text-yellow-500 px-4 py-2 rounded-full border border-yellow-500/20 text-xs font-bold';
                el.innerText = '● Không thể kiểm tra trạng thái';
            }
        }
        updateBotStatus();
        setInterval(updateBotStatus, 5000);