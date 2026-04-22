(function() {
    const countdownEl = document.getElementById('countdown-dynamic');
    if (!countdownEl) return;

    let targetDate = null;
    let eventDesc = '';

    async function initCountdown() {
        try {
            const response = await fetch('/api/config/countdown-settings');
            const data = await response.json();

            if (data && data.eventDate && data.eventTime) {
                // Parse DD/MM/YYYY HH:mm
                const [day, month, year] = data.eventDate.split('/');
                const [hour, minute] = data.eventTime.split(':');
                targetDate = new Date(year, month - 1, day, hour, minute);
                eventDesc = data.eventDescription || 'Sự kiện';
                
                const popupDateEl = document.getElementById('popupEventDate');
                if (popupDateEl) {
                    popupDateEl.textContent = data.eventDate;
                }

                updateCountdown();
                setInterval(updateCountdown, 1000);
            }
        } catch (error) {
            console.error('Failed to init countdown:', error);
        }
    }

    function updateCountdown() {
        if (!targetDate) return;

        const now = new Date();
        const diff = targetDate - now;

        if (diff <= 0) {
            countdownEl.innerHTML = `<span class="text-emerald-500 font-bold">${eventDesc} ĐANG DIỄN RA!</span>`;
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        let html = `<span class="opacity-75 mr-2">${eventDesc}:</span>`;
        html += `${String(days).padStart(2, '0')} : `;
        html += `${String(hours).padStart(2, '0')} : `;
        html += `${String(minutes).padStart(2, '0')} : `;
        html += `${String(seconds).padStart(2, '0')}`;

        countdownEl.innerHTML = html;
    }

    initCountdown();
})();
