import axios from 'axios';
import { getPikamcConfig } from './pikamcConfigService.js';

/**
 * Check if API is configured and valid
 * @param {object} config
 * @returns {boolean}
 */
function isApiConfigured(config) {
    if (!config?.apiKey || !config?.panelUrl || !config?.serverId) {
        return false;
    }

    // Ignore placeholder values
    if (config.serverId === '000000' || config.serverId === 'placeholder') {
        return false;
    }

    // Loopback prevention: Ignore if panelUrl points to the same server
    const host = 'vanhmcpe.top';
    if (config.panelUrl.includes(host)) {
        return false;
    }

    return true;
}

export async function getConsoleWebSocketAuth() {
    const config = await getPikamcConfig();
    if (!isApiConfigured(config)) {
        console.error('❌ Cannot get console websocket auth: PikaMC API is not configured');
        return { success: false, error: 'API not configured' };
    }

    try {
        const response = await axios.get(
            `${config.panelUrl}/api/client/servers/${config.serverId}/websocket`,
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Accept': 'Application/vnd.pterodactyl.v1+json'
                },
                timeout: 10000
            }
        );

        const payload = response.data?.data || response.data?.attributes || {};
        const token = String(payload?.token || '').trim();
        const socketUrl = String(payload?.socket || '').trim();

        if (!token || !socketUrl) {
            return { success: false, error: 'Invalid websocket credentials response' };
        }

        return {
            success: true,
            data: {
                token,
                socketUrl
            }
        };
    } catch (err) {
        console.error('❌ Lỗi lấy websocket auth PikaMC:', err.response ? err.response.data : err.message);
        return { success: false, error: err.message };
    }
}

// Send console command to Minecraft server
export async function sendConsoleCommand(command) {
    // Check if API is configured
    const config = await getPikamcConfig();
    if (!isApiConfigured(config)) {
        console.error('❌ Cannot send console command: PikaMC API is not configured');
        return { success: false, error: 'API not configured' };
    }

    try {
        await axios.post(
            `${config.panelUrl}/api/client/servers/${config.serverId}/command`,
            { command: command },
            {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'Application/vnd.pterodactyl.v1+json'
                },
                timeout: 10000 // 10 second timeout
            }
        );
        console.log(`✅ Đã gửi lệnh: ${command}`);
        return { success: true };
    } catch (err) {
        console.error('❌ Lỗi API PikaMC:', err.response ? err.response.data : err.message);
        return { success: false, error: err.message };
    }
}

// Cache for server resources
const pikamcCache = {
    timestamp: 0,
    data: null,
    ttl: 5000,
    inFlight: null,
    lock: false
};

// Get server resources with caching
export async function getServerResources() {
    // Check if API is configured
    const config = await getPikamcConfig();
    if (!isApiConfigured(config)) {
        return { 
            data: { 
                attributes: { 
                    resources: { memory_bytes: 0, cpu_absolute: 0, disk_bytes: 0, network_rx_bytes: 0, network_tx_bytes: 0 },
                    state: 'offline'
                } 
            }, 
            cached: false,
            configured: false,
            error: 'PikaMC API is not configured'
        };
    }

    const now = Date.now();

    // Return cached data if valid
    if (pikamcCache.data && (now - pikamcCache.timestamp) < pikamcCache.ttl) {
        return { data: pikamcCache.data, cached: true, configured: true };
    }

    // Wait if another request is in flight (simple lock)
    if (pikamcCache.inFlight) {
        try {
            const data = await pikamcCache.inFlight;
            return { data, cached: true, configured: true };
        } catch (err) {
            // Fall through to fetch
        }
    }

    // Create new request promise
    const fetchPromise = (async () => {
        try {
            const response = await axios.get(
                `${config.panelUrl}/api/client/servers/${config.serverId}/resources`,
                {
                    headers: {
                        'Authorization': `Bearer ${config.apiKey}`,
                        'Accept': 'Application/vnd.pterodactyl.v1+json'
                    },
                    timeout: 10000 // 10 second timeout
                }
            );

            const data = response.data;
            pikamcCache.data = data;
            pikamcCache.timestamp = Date.now();
            return data;
        } catch (err) {
            // Check if response is HTML (maintenance page)
            if (err.response && err.response.data && typeof err.response.data === 'string' && 
                err.response.data.includes('<!DOCTYPE html>')) {
                const error = new Error('PikaMC server đang bảo trì hoặc không khả dụng');
                error.status = err.response.status;
                throw error;
            }

            // Re-throw with better message
            const error = new Error(err.response?.data?.message || err.message || 'remote_error');
            error.status = err.response?.status || 500;
            throw error;
        }
    })();

    pikamcCache.inFlight = fetchPromise;

    try {
        const data = await pikamcCache.inFlight;
        pikamcCache.inFlight = null;
        return { data, cached: false, configured: true };
    } catch (err) {
        pikamcCache.inFlight = null;
        throw err;
    }
}
