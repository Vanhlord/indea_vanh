import axios from 'axios';
import {
    SECONDARY_PTERODACTYL_PANEL_URL,
    SECONDARY_PTERODACTYL_API_KEY,
    SECONDARY_PTERODACTYL_SERVER_ID
} from '../config/index.js';

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function isConfigured() {
    return Boolean(
        normalizeBaseUrl(SECONDARY_PTERODACTYL_PANEL_URL)
        && String(SECONDARY_PTERODACTYL_API_KEY || '').trim()
        && String(SECONDARY_PTERODACTYL_SERVER_ID || '').trim()
    );
}

const cache = {
    timestamp: 0,
    data: null,
    ttl: 60 * 1000,
    inFlight: null
};

export async function getSecondaryServerResources() {
    if (!isConfigured()) {
        console.log('[SecondaryPterodactyl] Service not configured - skipping fetch');
        return {
            data: {
                error: 'secondary_pterodactyl_not_configured',
                message: 'Secondary Pterodactyl API is not configured. Please set SECONDARY_PTERODACTYL_PANEL_URL, SECONDARY_PTERODACTYL_API_KEY, and SECONDARY_PTERODACTYL_SERVER_ID environment variables.'
            },
            cached: false,
            configured: false
        };
    }

    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.ttl) {
        return { data: cache.data, cached: true, configured: true };
    }

    if (cache.inFlight) {
        try {
            const data = await cache.inFlight;
            return { data, cached: true, configured: true };
        } catch (_error) {
            // Continue to new fetch below.
        }
    }

    const baseUrl = normalizeBaseUrl(SECONDARY_PTERODACTYL_PANEL_URL);
    const apiKey = String(SECONDARY_PTERODACTYL_API_KEY || '').trim();
    const serverId = String(SECONDARY_PTERODACTYL_SERVER_ID || '').trim();

    // Log connection attempt (mask API key for security)
    const maskedKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'none';
    console.log(`[SecondaryPterodactyl] Connecting to ${baseUrl}/api/client/servers/${serverId}/resources (API key: ${maskedKey})`);

    const requestPromise = (async () => {
        try {
            const response = await axios.get(
                `${baseUrl}/api/client/servers/${serverId}/resources`,
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        Accept: 'application/json'
                    },
                    timeout: 10000
                }
            );
            cache.timestamp = Date.now();
            cache.data = response.data;
            console.log(`[SecondaryPterodactyl] Fetch successful for server ${serverId}`);
            return response.data;
        } catch (axiosError) {
            // Log detailed error information
            const status = axiosError?.response?.status;
            const statusText = axiosError?.response?.statusText;
            const errorDetail = axiosError?.response?.data?.errors?.[0]?.detail
                || axiosError?.response?.data?.message
                || axiosError?.message;

            console.error('[SecondaryPterodactyl] Connection failed:', {
                url: `${baseUrl}/api/client/servers/${serverId}/resources`,
                status: status || 'no response',
                statusText: statusText || 'unknown',
                error: errorDetail,
                code: axiosError?.code || 'unknown'
            });

            throw axiosError;
        }
    })();

    cache.inFlight = requestPromise;
    try {
        const data = await requestPromise;
        cache.inFlight = null;
        return { data, cached: false, configured: true };
    } catch (error) {
        cache.inFlight = null;
        const detail = error?.response?.data?.errors?.[0]?.detail
            || error?.response?.data?.message
            || error?.message
            || 'unknown_error';
        const wrapped = new Error(`secondary_pterodactyl_fetch_failed: ${detail}`);
        wrapped.status = error?.response?.status || 504; // Use 504 for gateway timeout/connection issues
        throw wrapped;
    }
}
