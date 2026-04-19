const form = document.getElementById('notificationForm');
        const submitBtn = document.getElementById('submitBtn');
        const statusMsg = document.getElementById('statusMsg');

        function showMessage(text, type) {
            statusMsg.textContent = text;
            statusMsg.className = `p-4 rounded-2xl text-sm font-medium ${type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`;
            statusMsg.classList.remove('hidden');
            setTimeout(() => statusMsg.classList.add('hidden'), 5000);
        }

        async function fetchSubscriberCount() {
            try {
                const res = await fetch('/api/notifications/count');
                const result = await res.json();
                if (res.ok) {
                    document.getElementById('subscriberCount').innerHTML = `<i class="fas fa-users mr-2"></i>${result.count} thiết bị đã đăng ký`;
                } else {
                    document.getElementById('subscriberCount').innerHTML = `<i class="fas fa-exclamation-triangle mr-2 text-yellow-300"></i>Không thể tải số lượng`;
                }
            } catch (err) {
                console.error('Error fetching subscriber count:', err);
                document.getElementById('subscriberCount').innerHTML = `<i class="fas fa-exclamation-triangle mr-2 text-yellow-300"></i>Không thể tải số lượng`;
            }
        }

        window.addEventListener('load', fetchSubscriberCount);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const data = {
                title: document.getElementById('title').value.trim(),
                body: document.getElementById('body').value.trim(),
                icon: document.getElementById('icon').value.trim(),
                url: document.getElementById('url').value.trim()
            };

            if (!data.title || !data.body) {
                showMessage('Vui lòng nhập đầy đủ tiêu đề và nội dung!', 'error');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang gửi...';

            try {
                const res = await fetch('/api/notifications/broadcast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await res.json();
                if (res.ok) {
                    showMessage(`Đã gửi thành công đến ${result.successCount} thiết bị!`, 'success');
                    form.reset();
                } else {
                    showMessage(result.error || 'Gửi thất bại, vui lòng thử lại.', 'error');
                }
            } catch (err) {
                showMessage('Lỗi kết nối đến server!', 'error');
                console.error(err);
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-share-square"></i> Gửi thông báo ngay';
            }
        });