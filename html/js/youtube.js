let currentYoutubeUrl = "";

/**
 * Sidebar is handled centrally in `index.js` to avoid duplicate definitions.
 * Duplicate toggleSidebar implementations removed from page-level scripts.
 */

/**
 * 2. Copy IP/Domain với hiệu ứng xịn
 */
function copyIP() {
    const ip = "mcnote.io.vn";
    navigator.clipboard.writeText(ip).then(() => {
        const toast = document.createElement('div');
        toast.textContent = "🚀 Đã copy: " + ip;
        toast.className = "fixed bottom-5 right-5 px-6 py-3 bg-green-500 text-white rounded-xl shadow-lg z-[9999] font-bold animate-bounce";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    });
}

/**
 * 3. Tách lấy ID video từ link Youtube
 */
function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * 4. Xử lý khi nhấn nút PHÂN TÍCH VIDEO
 */
async function handleDownload() {
    const urlInput = document.getElementById('videoUrl');
    const url = urlInput.value.trim();
    const resultBox = document.getElementById('resultBox');
    const videoData = document.getElementById('videoData');
    const loader = document.getElementById('loader');

    if (!url) return alert('Bạn chưa dán link!');
    
    const videoId = extractVideoId(url);
    if (!videoId) return alert('Link YouTube không hợp lệ, vui lòng kiểm tra lại!');

    currentYoutubeUrl = url;
    
    // Reset giao diện
    loader.classList.remove('hidden');
    resultBox.classList.add('hidden');
    videoData.innerHTML = "";

    try {
        const response = await fetch(`/api/youtube-info?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data && data.title) {
            // Render kết quả với class Tailwind + Inline Style để ép màu
            videoData.innerHTML = `
                <div class="overflow-hidden rounded-2xl mb-6 shadow-md border border-gray-100">
                    <iframe class="w-full aspect-video" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe>
                </div>
                <h3 class="font-bold text-gray-800 mb-6 line-clamp-2 px-2 text-lg text-center">${data.title}</h3>
                
                <div class="flex flex-col gap-4 px-2 pb-2">
                    <button onclick="startDownload('video')"
                        class="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95">
                        <i class="fas fa-video"></i> Tải Video MP4
                    </button>

                    <button onclick="startDownload('music')"
                        class="w-full bg-gray-800 hover:bg-gray-900 text-white py-4 rounded-xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95">
                        <i class="fas fa-music"></i> Tải Nhạc MP3
                    </button>
                </div>
            `;
            resultBox.classList.remove('hidden');
        } else {
            alert('Không lấy được thông tin video, thử lại xem sao!');
        }
    } catch (e) {
        console.error(e);
        alert('Lỗi hệ thống hoặc link bị chặn rồi!');
    } finally {
        loader.classList.add('hidden');
    }
}

/**
 * 5. Xử lý tải file qua Proxy
 */
async function startDownload(type) {
    const modal = document.getElementById('progressModal');
    const bar = document.getElementById('progressBar');
    const status = document.getElementById('statusText');

    modal.classList.remove('hidden');
    modal.style.display = 'flex'; 
    bar.style.width = '0%';
    status.innerText = "Đang kết nối Server...";

    try {
        await moveBar(0, 35);
        status.innerText = "Đang mã hóa dữ liệu...";

        const response = await fetch('/api/youtube-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoUrl: currentYoutubeUrl, type: type })
        });

        if (!response.ok) throw new Error();

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        
        await moveBar(35, 100);
        status.innerText = "Sẵn sàng tải về!";

        const a = document.createElement('a');
        a.href = url;
        a.download = `mcnote_ytb_${type}_${Date.now()}.${type === 'video' ? 'mp4' : 'mp3'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        setTimeout(() => { modal.style.display = 'none'; }, 1200);
    } catch (e) {
        alert("Server bận hoặc video bị giới hạn rồi!");
        modal.style.display = 'none';
    }
}

/**
 * 6. Hiệu ứng thanh tiến trình (Progress Bar)
 */
function moveBar(from, to) {
    return new Promise(resolve => {
        let width = from;
        const interval = setInterval(() => {
            if (width >= to) { 
                clearInterval(interval); 
                resolve(); 
            } else { 
                width++; 
                document.getElementById('progressBar').style.width = width + '%'; 
            }
        }, 12);
    });
}
