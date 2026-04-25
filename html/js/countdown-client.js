(function() {
    const countdownEl = document.getElementById('countdown-dynamic');
    if (!countdownEl) return;

    let targetDate = null;
    let eventDesc = '';
    let eventDateStr = '';

    async function initCountdown() {
        console.log('[Countdown] Initializing dynamic timer...');
        try {
            const response = await fetch('/api/config/countdown-settings');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data && data.eventDate && data.eventTime) {
                // Parse DD/MM/YYYY HH:mm
                const [day, month, year] = data.eventDate.split('/');
                const [hour, minute] = data.eventTime.split(':');
                targetDate = new Date(year, month - 1, day, hour, minute);
                eventDesc = data.eventDescription || 'Sự kiện';
                eventDateStr = data.eventDate;
                
                console.log(`[Countdown] Target: ${data.eventDate} ${data.eventTime} (${eventDesc})`);

                // Update popup date if present
                const popupDateEl = document.getElementById('popupEventDate');
                if (popupDateEl) {
                    popupDateEl.textContent = data.eventDate;
                }

                updateCountdown();
                setInterval(updateCountdown, 1000);
            }
        } catch (error) {
            console.error('[Countdown] Failed to init:', error);
        }
    }

    function updateCountdown() {
        if (!targetDate) return;

        // Re-query in case DOM changed
        const el = document.getElementById('countdown-dynamic');
        if (!el) return;

        const now = new Date();
        const diff = targetDate - now;

        if (diff <= 0) {
            el.innerHTML = `<span class="text-emerald-500 font-bold animate-pulse">${eventDesc} ĐANG DIỄN RA!</span>`;
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        let html = `${String(days).padStart(2, '0')} : `;
        html += `${String(hours).padStart(2, '0')} : `;
        html += `${String(minutes).padStart(2, '0')} : `;
        html += `${String(seconds).padStart(2, '0')}`;
        html += ` <span class="opacity-60 text-xs sm:text-sm ml-3 font-sans tracking-normal italic">(Ngày kết thúc: ${eventDateStr})</span>`;

        el.innerHTML = html;
    }

    initCountdown();
})();
