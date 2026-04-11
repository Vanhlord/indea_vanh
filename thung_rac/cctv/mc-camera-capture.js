import { chromium } from 'playwright';
import { EventEmitter } from 'events';

export class MCCameraCapture extends EventEmitter {
    constructor(viewerUrl = 'http://localhost:3001/html/mc-viewer.html', interval = 500) {
        super();
        this.viewerUrl = viewerUrl;
        this.interval = interval;
        this.browser = null;
        this.page = null;
        this.active = false;
        this.timer = null;
    }

    async start() {
        console.log(`[Camera-Capture] Launching Playwright on ${this.viewerUrl}...`);
        try {
            this.browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--use-gl=swiftshader', // Allow CPU WebGL fallback
                    '--disable-dev-shm-usage',
                    '--ignore-gpu-blocklist' // Force WebGL even if headless
                ]
            });
            this.page = await this.browser.newPage({
                viewport: { width: 640, height: 360 } // Standard CCTV Resolution
            });

            // Log browser console messages for debugging
            this.page.on('console', msg => {
                console.log(`[CCTV-Browser] ${msg.text()}`);
            });

            // Log browser errors
            this.page.on('pageerror', err => {
                console.error(`[CCTV-Browser Error] ${err.message}`);
            });

            await this.page.goto(this.viewerUrl);
            await this.page.waitForLoadState('networkidle');

            this.active = true;
            this.scheduleCapture();
            console.log('[Camera-Capture] Started periodic screenshots');
        } catch (error) {
            console.error('[Camera-Capture] Failed to start:', error);
        }
    }

    scheduleCapture() {
        if (!this.active) return;

        this.timer = setTimeout(async () => {
            if (!this.active) return;
            try {
                // Capture screenshot as buffer and convert to base64
                const buffer = await this.page.screenshot({ 
                    type: 'jpeg', 
                    quality: 40 // Low quality for speed
                });
                const base64 = buffer.toString('base64');
                this.emit('frame', base64);
                
                // Debug log every 10 frames
                this.frameCount = (this.frameCount || 0) + 1;
                if (this.frameCount % 10 === 0) {
                    console.log(`[Camera-Capture] Captured ${this.frameCount} frames...`);
                }

            } catch (err) {
                console.error('[Camera-Capture] Screenshot failed:', err.message);
            }
            this.scheduleCapture();
        }, this.interval);
    }

    async stop() {
        this.active = false;
        if (this.timer) clearTimeout(this.timer);
        if (this.browser) await this.browser.close();
        console.log('[Camera-Capture] Stopped');
    }
}
