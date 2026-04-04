/**
 * Unified Downloader Service
 * Provides a consistent interface for all download platforms
 */

import { handleTikTokDownload, getTikTokInfo } from '../../modules/downloader/tiktok.js';

import { handleYoutubeDownload, getYoutubeInfoData } from '../../modules/downloader/youtube.js';
import { handleXDownload, getXInfoData } from '../../modules/downloader/x.js';
import { handleSoundCloudDownload, getSoundCloudInfoData } from '../../modules/downloader/soundcloud.js';
import { DownloadError } from '../../utils/errors.js';
import { assertSafeMediaUrl } from './urlSafety.js';

/**
 * Supported download platforms
 */
export const PLATFORMS = {
    TIKTOK: 'tiktok',
    YOUTUBE: 'youtube',
    X: 'x',
    SOUNDCLOUD: 'soundcloud',
    FACEBOOK: 'facebook'
};

/**
 * Download file from specified platform
 * @param {string} platform - Platform identifier
 * @param {Object} options - Download options
 * @param {string} options.url - URL to download
 * @param {string} options.type - File type (video, audio, image)
 * @param {string} [options.quality] - Quality preference
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 * @throws {DownloadError} When download fails
 */
export async function downloadFromPlatform(platform, options, res) {
    const { url, type, quality } = options;

    // Validate URL
    if (!url) {
        throw new DownloadError('URL is required', platform);
    }

    // Validate platform support
    if (!Object.values(PLATFORMS).includes(platform)) {
        throw new DownloadError(`Unsupported platform: ${platform}`, platform);
    }

    // Route to appropriate handler
    switch (platform) {
    case PLATFORMS.TIKTOK:
        return handleTikTokDownload(
            { body: { fileUrl: url, type, fileName: options.fileName } },
            res
        );

    case PLATFORMS.YOUTUBE: {
        // Legacy YouTube handler expects body.videoUrl + body.type ('video' | 'music')
        const youtubeType = ['video', 'mp4', 'webm'].includes(String(type || '').toLowerCase())
            ? 'video'
            : 'music';
        return handleYoutubeDownload(
            { body: { videoUrl: url, type: youtubeType, quality, fileName: options.fileName } },
            res
        );
    }

    case PLATFORMS.X:
        return handleXDownload(
            { body: { videoUrl: url, fileName: options.fileName } },
            res
        );

    case PLATFORMS.SOUNDCLOUD:
        // Legacy SoundCloud handler expects body.trackUrl
        return handleSoundCloudDownload(
            { body: { trackUrl: url, format: type, fileName: options.fileName } },
            res
        );

    default:
        throw new DownloadError(`Handler not implemented for ${platform}`, platform);
    }
}

/**
 * Get media info from URL
 * @param {string} platform - Platform identifier
 * @param {string} url - Media URL
 * @returns {Promise<Object>} Media metadata
 * @throws {DownloadError} When info fetch fails
 */
export async function getMediaInfo(platform, url) {
    if (!url) {
        throw new DownloadError('URL is required', platform);
    }

    try {
        switch (platform) {
        case PLATFORMS.YOUTUBE:
            return await getYoutubeInfoData(url);

        case PLATFORMS.SOUNDCLOUD:
            return await getSoundCloudInfoData(url);

        case PLATFORMS.X:
            return await getXInfoData(url);

        case PLATFORMS.TIKTOK: {
            const tiktokInfo = await getTikTokInfo(url);
            return {
                title: tiktokInfo.data.title,
                author: tiktokInfo.data.author,
                thumbnail: tiktokInfo.data.avatar,
                duration: tiktokInfo.data.duration,
                formats: [
                    { type: 'video', url: tiktokInfo.data.play, quality: 'HD' },
                    { type: 'music', url: tiktokInfo.data.music, quality: 'MP3' }
                ],
                images: tiktokInfo.data.images,
                raw: tiktokInfo.data
            };
        }

        default:
            throw new DownloadError(`Info fetch not supported for ${platform}`, platform);
        }
    } catch (error) {
        throw new DownloadError(
            `Failed to fetch media info: ${error.message}`,
            platform
        );
    }
}

/**
 * Validate download URL
 * @param {string} url - URL to validate
 * @returns {Object} Validation result
 */
export function validateDownloadUrl(url) {
    const patterns = {
        [PLATFORMS.TIKTOK]: /tiktok\.com/i,
        [PLATFORMS.YOUTUBE]: /youtube\.com|youtu\.be/i,
        [PLATFORMS.X]: /x\.com|twitter\.com|t\.co/i,
        [PLATFORMS.SOUNDCLOUD]: /soundcloud\.com/i,
        [PLATFORMS.FACEBOOK]: /facebook\.com|fb\.watch/i
    };

    for (const [platform, pattern] of Object.entries(patterns)) {
        if (pattern.test(url)) {
            return { valid: true, platform };
        }
    }

    return { valid: false, platform: null };
}

/**
 * Get supported formats for platform
 * @param {string} platform - Platform identifier
 * @returns {string[]} Array of supported formats
 */
export function getSupportedFormats(platform) {
    const formats = {
        [PLATFORMS.TIKTOK]: ['video', 'music', 'image'],
        [PLATFORMS.YOUTUBE]: ['mp4', 'mp3', 'webm'],
        [PLATFORMS.X]: ['mp4'],
        [PLATFORMS.SOUNDCLOUD]: ['mp3', 'wav'],
        [PLATFORMS.FACEBOOK]: ['mp4']
    };

    return formats[platform] || [];
}

/**
 * Proxy download file from remote URL
 * @param {string} fileUrl - Remote file URL to proxy
 * @param {string} fileName - Suggested filename for download
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 * @throws {DownloadError} When proxy download fails
 */
export async function proxyFileDownload(fileUrl, fileName, res) {
    if (!fileUrl) {
        throw new DownloadError('File URL is required', 'proxy');
    }

    try {
        // Validate URL + host safety
        let currentUrl = (await assertSafeMediaUrl(fileUrl)).toString();
        let response = null;
        let finalUrl = null;
        
        // Fetch file with controlled redirects (re-validate each hop)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        try {
            for (let i = 0; i <= 3; i++) {
                response = await fetch(currentUrl, {
                    signal: controller.signal,
                    redirect: 'manual',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive'
                    }
                });

                const isRedirect = response.status >= 300 && response.status < 400;
                if (!isRedirect) {
                    finalUrl = new URL(currentUrl);
                    break;
                }

                const location = response.headers.get('location');
                if (!location) {
                    throw new DownloadError('Redirect response missing location header', 'proxy');
                }

                const nextUrl = new URL(location, currentUrl).toString();
                currentUrl = (await assertSafeMediaUrl(nextUrl)).toString();

                if (i === 3) {
                    throw new DownloadError('Too many redirects while downloading file', 'proxy');
                }
            }
        } finally {
            clearTimeout(timeout);
        }

        if (!response || !finalUrl) {
            throw new DownloadError('Unable to initialize file download stream', 'proxy');
        }

        if (!response.ok) {
            throw new DownloadError(`Failed to fetch file: ${response.status} ${response.statusText}`, 'proxy');
        }

        // Get content type and length from response
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const contentLength = response.headers.get('content-length');
        
        // Determine file extension based on content type or URL
        let finalFileName = fileName;
        if (!finalFileName) {
            const urlPath = finalUrl.pathname;
            const ext = urlPath.split('.').pop() || 'mp4';
            finalFileName = `download_${Date.now()}.${ext}`;
        }

        // Set response headers for file download
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalFileName)}"`);
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }
        
        // Stream the response to client
        const reader = response.body.getReader();
        
        let streamDone = false;
        while (!streamDone) {
            const { done, value } = await reader.read();
            if (done) {
                streamDone = true;
                continue;
            }
            res.write(Buffer.from(value));
        }
        
        res.end();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new DownloadError('Download timeout - file too large or slow connection', 'proxy');
        }
        throw new DownloadError(`Proxy download failed: ${error.message}`, 'proxy');
    }
}

