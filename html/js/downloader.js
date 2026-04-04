/**
 * MC Note Downloader Utilities
 * Shared utilities for all downloader pages
 */

class DownloaderUtils {
    constructor() {
        this.cache = new Map();
        this.rateLimitMap = new Map();
        this.initDarkMode();
        this.initToastContainer();
    }

    // ==================== DARK MODE ====================
    initDarkMode() {
        const savedMode = localStorage.getItem('darkMode');
        if (savedMode === 'true') {
            document.documentElement.classList.add('dark');
        }
    }

    toggleDarkMode() {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('darkMode', isDark);
        this.showToast(isDark ? 'Đã bật chế độ tối' : 'Đã bật chế độ sáng', 'info');
    }

    // ==================== TOAST NOTIFICATIONS ====================
    initToastContainer() {
        if (!document.getElementById('toastContainer')) {
            const container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'fixed top-4 right-4 z-[9999] space-y-2';
            document.body.appendChild(container);
        }
    }

    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        
        const colors = {
            success: 'bg-green-500',
            error: 'bg-red-500',
            warning: 'bg-yellow-500',
            info: 'bg-blue-500'
        };
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        toast.className = `${colors[type]} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 transform translate-x-full transition-transform duration-300 min-w-[300px]`;
        toast.innerHTML = `
            <i class="fas ${icons[type]}"></i>
            <span class="font-medium">${message}</span>
            <button onclick="this.parentElement.remove()" class="ml-auto hover:opacity-70">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(toast);
        
        // Animate in
        setTimeout(() => toast.classList.remove('translate-x-full'), 100);
        
        // Auto remove
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ==================== RATE LIMITING ====================
    checkRateLimit(key, maxRequests = 3, windowMs = 60000) {
        const now = Date.now();
        const userRequests = this.rateLimitMap.get(key) || [];
        
        // Clean old requests
        const validRequests = userRequests.filter(time => now - time < windowMs);
        
        if (validRequests.length >= maxRequests) {
            const oldestRequest = validRequests[0];
            const waitTime = Math.ceil((windowMs - (now - oldestRequest)) / 1000);
            return { allowed: false, waitTime };
        }
        
        validRequests.push(now);
        this.rateLimitMap.set(key, validRequests);
        return { allowed: true, remaining: maxRequests - validRequests.length };
    }

    // ==================== DEBOUNCE ====================
    debounce(func, wait = 500) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // ==================== RETRY MECHANISM ====================
    async fetchWithRetry(url, options = {}, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                throw new Error(`HTTP ${response.status}`);
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await this.sleep(delay * (i + 1)); // Exponential backoff
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== CACHE ====================
    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        const now = Date.now();
        if (now - cached.timestamp > cached.ttl) {
            this.cache.delete(key);
            return null;
        }
        return cached.data;
    }

    setCache(key, data, ttlMinutes = 5) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: ttlMinutes * 60 * 1000
        });
        
        // Also save to localStorage for persistence
        try {
            const storageKey = `dl_cache_${key}`;
            localStorage.setItem(storageKey, JSON.stringify({
                data,
                timestamp: Date.now(),
                ttl: ttlMinutes * 60 * 1000
            }));
        } catch (e) {
            // Ignore localStorage errors
        }
    }

    getLocalStorageCache(key) {
        try {
            const storageKey = `dl_cache_${key}`;
            const cached = JSON.parse(localStorage.getItem(storageKey));
            if (!cached) return null;
            
            const now = Date.now();
            if (now - cached.timestamp > cached.ttl) {
                localStorage.removeItem(storageKey);
                return null;
            }
            return cached.data;
        } catch (e) {
            return null;
        }
    }

    // ==================== HISTORY ====================
    addToHistory(item) {
        const history = this.getHistory();
        const newItem = {
            ...item,
            id: Date.now(),
            timestamp: new Date().toISOString()
        };
        
        // Add to beginning, limit to 50 items
        history.unshift(newItem);
        if (history.length > 50) history.pop();
        
        localStorage.setItem('downloadHistory', JSON.stringify(history));
        return newItem;
    }

    getHistory() {
        try {
            return JSON.parse(localStorage.getItem('downloadHistory')) || [];
        } catch (e) {
            return [];
        }
    }

    clearHistory() {
        localStorage.removeItem('downloadHistory');
    }

    // ==================== VALIDATION ====================
    sanitizeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(match) {
            const escape = {
                '&': '&amp;',
                '<': '<',
                '>': '>',
                '"': '"',
                "'": '&#39;'
            };
            return escape[match];
        });
    }

    forceHttps(url) {
        if (!url) return '';
        return url.replace(/^http:/i, 'https:');
    }

    // ==================== UI HELPERS ====================
    createSkeletonLoader(type = 'card') {
        const div = document.createElement('div');
        div.className = 'animate-pulse';
        
        if (type === 'card') {
            div.innerHTML = `
                <div class="h-48 bg-gray-200 rounded-xl mb-4"></div>
                <div class="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div class="h-4 bg-gray-200 rounded w-1/2"></div>
            `;
        } else if (type === 'text') {
            div.innerHTML = `
                <div class="h-4 bg-gray-200 rounded w-full mb-2"></div>
                <div class="h-4 bg-gray-200 rounded w-5/6 mb-2"></div>
                <div class="h-4 bg-gray-200 rounded w-4/6"></div>
            `;
        }
        
        return div;
    }

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ==================== DOWNLOAD HELPERS ====================
    async downloadFile(url, filename, onProgress = null) {
        const response = await fetch(url);
        const blob = await response.blob();
        
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
        }, 100);
        
        return true;
    }

    // ==================== DRAG & DROP ====================
    initDragDrop(element, onDrop) {
        element.addEventListener('dragover', (e) => {
            e.preventDefault();
            element.classList.add('border-blue-500', 'bg-blue-50');
        });

        element.addEventListener('dragleave', () => {
            element.classList.remove('border-blue-500', 'bg-blue-50');
        });

        element.addEventListener('drop', (e) => {
            e.preventDefault();
            element.classList.remove('border-blue-500', 'bg-blue-50');
            
            const text = e.dataTransfer.getData('text');
            if (text) onDrop(text);
        });
    }
}

// Create global instance
const dlUtils = new DownloaderUtils();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DownloaderUtils, dlUtils };
}
