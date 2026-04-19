// ===== SIDEBAR =====
        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('overlay');
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
        function closeSidebar() {
            document.getElementById('sidebar').classList.remove('left-0');
            document.getElementById('sidebar').classList.add('-left-[260px]');
            document.getElementById('overlay').classList.add('hidden');
        }

        // ===== COPY IP =====
        function copyIP() {
            const ip = 'vna.vanhmcpe.top:25702';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(ip)
                    .then(() => showToast('Đã copy IP: ' + ip))
                    .catch(() => showToast('Không thể copy IP', 'error'));
            } else {
                showToast('Trình duyệt không hỗ trợ clipboard', 'error');
            }
        }

        // ===== TOAST =====
        function showToast(message, type = 'success') {
            let toast = document.getElementById('toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toast';
                toast.style.cssText = "position:fixed;bottom:20px;right:20px;padding:12px 25px;border-radius:12px;color:white;z-index:10000;transition:0.5s;opacity:0;font-weight:600;box-shadow:0 4px 15px rgba(0,0,0,0.2);";
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.style.backgroundColor = type === 'success' ? '#28a745' : '#dc3545';
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
            setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; }, 3000);
        }

        // ===== LOGOUT =====
        async function logout() {
            if (confirm('Muốn đăng xuất rồi à!')) {
                window.location.href = '/api/auth/logout';
            }
        }

        // ===== AUTH =====
        async function checkLoginStatus() {
            try {
                const res = await fetch('/api/user-info');
                const data = await res.json();
                if (data.loggedIn && data.username) {
                    document.getElementById('userGuest').classList.add('hidden');
                    document.getElementById('userLogged').classList.remove('hidden');
                    document.getElementById('userName').textContent = data.username;
                    document.getElementById('userAvatar').src = data.avatar;
                    localStorage.setItem('user', JSON.stringify({ id: data.id, username: data.username, avatar: data.avatar }));
                } else {
                    localStorage.removeItem('user');
                    document.getElementById('userGuest').classList.remove('hidden');
                    document.getElementById('userLogged').classList.add('hidden');
                }
            } catch(e) { 
                console.error(e); 
            }
        }

        // ===== TIME =====
        function updateTime() {
            const now = new Date();
            const el = document.getElementById('currentTime');
            if (el) el.textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // ===== DONATE API =====
        const API_URL = '/api/donations';
        
        function formatCurrency(amount) {
            return amount.toLocaleString('vi-VN') + 'đ';
        }

        function escapeHtml(value) {
            const div = document.createElement('div');
            div.textContent = String(value || '');
            return div.innerHTML;
        }
        
        function getRankStyle(index) {
            const styles = [
                { bg: 'bg-yellow-50', border: 'border-yellow-400', text: 'text-yellow-600', icon: '👑', badge: 'bg-yellow-400' },
                { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700', icon: '🥈', badge: 'bg-gray-400' },
                { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-600', icon: '🥉', badge: 'bg-orange-400' }
            ];
            return styles[index] || { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-600', icon: '✨', badge: 'bg-gray-300' };
        }
        
        function renderDonor(donor, index) {
            const style = getRankStyle(index);
            const isTop3 = index < 3;
            const safeName = escapeHtml(donor?.name || 'Ẩn danh');
            const donationCount = Math.max(0, Number(donor?.donationCount || 0));
            const amount = Number(donor?.amount || 0);
            
            return `
                <div class="donor-item flex items-center justify-between p-4 ${style.bg} rounded-xl border-l-4 ${style.border} ${isTop3 ? 'shadow-sm' : ''}">
                    <div class="flex items-center gap-3">
                        <span class="text-2xl">${style.icon}</span>
                        <div>
                            <span class="font-${isTop3 ? 'bold' : 'semibold'} ${isTop3 ? 'text-gray-800' : 'text-gray-600'} block">${safeName}</span>
                            ${donationCount > 1 ? `<span class="text-xs ${style.badge} text-white px-2 py-0.5 rounded-full">${donationCount} lần</span>` : ''}
                        </div>
                    </div>
                    <span class="${isTop3 ? style.text : 'text-gray-700'} font-${isTop3 ? 'extrabold text-lg' : 'bold'}">${formatCurrency(amount)}</span>
                </div>
            `;
        }
        
        function renderEmpty() {
            return `
                <div class="text-center text-gray-400 py-8">
                    <i class="fas fa-heart-broken text-4xl mb-3"></i>
                    <p>Chưa có donate nào 😢</p>
                    <p class="text-sm mt-2">Hãy là người đầu tiên ủng hộ!</p>
                </div>
            `;
        }
        
        async function loadDonations() {
            try {
                const response = await fetch(API_URL);
                const data = await response.json();
                
                if (data.success && data.donations) {
                    renderDonations(data.donations, data.total);
                } else {
                    document.getElementById('donors-list').innerHTML = renderEmpty();
                }
            } catch (error) {
                console.error('Error loading donations:', error);
                document.getElementById('donors-list').innerHTML = `
                    <div class="text-center text-red-400 py-8">
                        <i class="fas fa-exclamation-circle text-4xl mb-3"></i>
                        <p>Không thể tải danh sách 😢</p>
                        <p class="text-sm mt-2">Vui lòng thử lại sau</p>
                    </div>
                `;
            }
        }
        
        function renderDonations(donations, total) {
            const listEl = document.getElementById('donors-list');
            const totalEl = document.getElementById('total-donate');
            const lastUpdatedEl = document.getElementById('last-updated');
            
            if (!donations || donations.length === 0) {
                listEl.innerHTML = renderEmpty();
            } else {
                listEl.innerHTML = donations.map((donor, index) => renderDonor(donor, index)).join('');
            }
            
            if (totalEl) {
                totalEl.textContent = `Tổng: ${formatCurrency(total || 0)}`;
            }
            
            if (lastUpdatedEl) {
                const now = new Date();
                lastUpdatedEl.textContent = `Cập nhật: ${now.toLocaleTimeString('vi-VN')}`;
            }
        }
        
        function initSocketIO() {
            const socket = io();
            
            socket.on('connect', () => {
                console.log('[Donate] Socket connected');
            });
            
            socket.on('donation-update', (data) => {
                console.log('[Donate] Real-time update received:', data);
                
                showNotification(data.donor.name, data.donor.amount);
                
                if (data.topDonors) {
                    const total = data.topDonors.reduce((sum, d) => sum + d.amount, 0);
                    renderDonations(data.topDonors, total);
                } else {
                    loadDonations();
                }
            });
            
            socket.on('disconnect', () => {
                console.log('[Donate] Socket disconnected');
            });
        }
        
        function showNotification(name, amount) {
            const safeName = escapeHtml(name || 'Ẩn danh');
            const notif = document.createElement('div');
            notif.className = 'fixed top-4 right-4 bg-gradient-to-r from-pink-500 to-rose-500 text-white p-4 rounded-xl shadow-lg z-50 animate-bounce';
            notif.innerHTML = `
                <p class="font-bold flex items-center gap-2">
                    <i class="fas fa-gem"></i>
                    Donate mới!
                </p>
                <p>${safeName}: +${formatCurrency(Number(amount || 0))}</p>
            `;
            
            document.body.appendChild(notif);
            
            setTimeout(() => {
                notif.remove();
            }, 3000);
        }

        // ===== DONATE POPUP =====
        function openDonatePopup() {
            const popup = document.getElementById('donatePopup');
            popup.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeDonatePopup(event) {
            if (event && event.target !== event.currentTarget) return;
            const popup = document.getElementById('donatePopup');
            popup.classList.add('hidden');
            document.body.style.overflow = '';
        }

        // Close popup with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeDonatePopup();
            }
        });

        // ===== INIT =====

        document.addEventListener('DOMContentLoaded', async () => {
            await checkLoginStatus();
            loadDonations();
            initSocketIO();
            updateTime();
            
            setInterval(updateTime, 1000);
            setInterval(loadDonations, 30000);
        });