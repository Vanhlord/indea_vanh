// ========== SIDEBAR & NAVIGATION ==========
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
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

// ========== PROGRESS & STATUS UTILS ==========
function updateProgress(percent, text) {
    const progressBar = document.getElementById('progress-bar');
    const progressPercent = document.getElementById('progress-percent');
    const progressText = document.getElementById('progress-text');
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressPercent) progressPercent.textContent = percent + '%';
    if (progressText) progressText.textContent = text;
}

function showStatus(message, type = 'success') {
    const statusDiv = document.getElementById('status-message');
    if (!statusDiv) return;
    statusDiv.className = `mt-6 p-4 rounded-2xl border-2 border-dashed font-bold ${type === 'success' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`;
    statusDiv.textContent = message;
    statusDiv.classList.remove('hidden');
}

function hideStatus() {
    document.getElementById('status-message')?.classList.add('hidden');
}

// ========== CLOCK ==========
function updateTime() {
    const now = new Date();
    const el = document.getElementById('currentTime');
    if (el) el.textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateTime();
setInterval(updateTime, 1000);

// ========== FETCH REAL STATS ==========
async function updateFBStats() {
    try {
        const response = await fetch('/api/leaderboard/tool-usage', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        const ranking = payload?.data?.ranking || [];
        const fbData = ranking.find(item => item.tool === 'facebook');
        if (fbData && fbData.downloads) {
            const el = document.getElementById('fbDownloads');
            if (el) el.textContent = Number(fbData.downloads).toLocaleString('vi-VN');
        }
    } catch (err) { console.error('Failed to fetch FB stats:', err); }
}
updateFBStats();
setInterval(updateFBStats, 30000);

// ========== DOWNLOAD LOGIC ==========
// Make it globally accessible for onClick events since CSP script-src-attr 'unsafe-inline' is still active
window.startDownload = async function startDownload() {
    const urlInput = document.getElementById('fb-url');
    const url = urlInput.value.trim();
    const downloadBtn = document.getElementById('download-btn');
    const progressContainer = document.getElementById('progress-container');

    if (!url) { alert('Vui lòng nhập link video Facebook!'); return; }
    if (!url.includes('facebook.com')) { alert('Link không hợp lệ! Phải là link Facebook.'); return; }

    hideStatus();
    progressContainer.classList.remove('hidden');
    downloadBtn.disabled = true;
    const originalBtnHtml = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ĐANG XỬ LÝ...';

    try {
        updateProgress(15, 'Đang phân tích video...');
        
        const response = await fetch('/api/facebook/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Server không thể tải video này.');

        updateProgress(65, 'Đang chuẩn bị file tải về...');
        
        const downloadUrl = `/api/facebook/download/${data.fileName}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = data.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        updateProgress(100, 'Tải về máy thành công!');
        showStatus('Đã gửi yêu cầu tải về file: ' + data.fileName);

        setTimeout(() => {
            progressContainer.classList.add('hidden');
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = originalBtnHtml;
            urlInput.value = '';
            updateProgress(0, 'Sẵn sàng');
        }, 4000);

    } catch (error) {
        console.error('Download error:', error);
        showStatus('Lỗi: ' + error.message, 'error');
        progressContainer.classList.add('hidden');
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalBtnHtml;
    }
}

// Ensure toggleSidebar is global too
window.toggleSidebar = toggleSidebar;

// Enter Key Support
document.getElementById('fb-url')?.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') window.startDownload();
});
