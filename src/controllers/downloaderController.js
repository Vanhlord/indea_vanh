/**
 * Downloader Controller
 * Handles HTTP requests for media downloads
 */

import {
    downloadFromPlatform,
    getMediaInfo,
    validateDownloadUrl,
    getSupportedFormats,
    proxyFileDownload,
    PLATFORMS
} from '../services/downloader/DownloaderService.js';

import { asyncHandler, sendSuccess } from '../middleware/errorHandler.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Download media from any supported platform
 * POST /api/download
 */
export const downloadMedia = asyncHandler(async (req, res) => {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const url = payload.url || payload.videoUrl || payload.trackUrl || payload.fileUrl;
    const platform = payload.platform;
    const type = payload.type || payload.format;
    const quality = payload.quality;
    const fileName = payload.fileName;

    if (!url) {
        throw new ValidationError('URL is required');
    }

    // Auto-detect platform if not specified
    let targetPlatform = platform;
    if (!targetPlatform) {
        const detection = validateDownloadUrl(url);
        if (!detection.valid) {
            throw new ValidationError('Could not detect platform from URL. Please specify platform.');
        }
        targetPlatform = detection.platform;
    }

    // Validate platform
    if (!Object.values(PLATFORMS).includes(targetPlatform)) {
        throw new ValidationError(`Unsupported platform: ${targetPlatform}`);
    }
    if (targetPlatform === PLATFORMS.FACEBOOK) {
        throw new ValidationError('Facebook currently uses /api/facebook/download endpoint.');
    }

    // Perform download
    await downloadFromPlatform(targetPlatform, {
        url,
        type,
        quality,
        fileName
    }, res);
});

/**
 * Get media info before downloading
 * GET /api/download/info
 */
export const getDownloadInfo = asyncHandler(async (req, res) => {
    const query = req.validatedQuery || {};
    const { url, platform } = query;

    if (!url) {
        throw new ValidationError('URL parameter is required');
    }

    // Auto-detect platform
    let targetPlatform = platform;
    if (!targetPlatform) {
        const detection = validateDownloadUrl(url);
        if (!detection.valid) {
            throw new ValidationError('Could not detect platform from URL');
        }
        targetPlatform = detection.platform;
    }

    const info = await getMediaInfo(targetPlatform, url);
    
    sendSuccess(res, {
        platform: targetPlatform,
        url,
        ...info
    }, 'Media info retrieved successfully');
});

/**
 * Validate download URL
 * POST /api/download/validate
 */
export const validateUrl = asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url) {
        throw new ValidationError('URL is required');
    }

    const result = validateDownloadUrl(url);
    
    sendSuccess(res, {
        url,
        ...result,
        supportedFormats: result.platform ? getSupportedFormats(result.platform) : []
    }, 'URL validation complete');
});

/**
 * Get supported platforms and formats
 * GET /api/download/platforms
 */
export const getPlatforms = asyncHandler(async (req, res) => {
    const platforms = Object.values(PLATFORMS)
        .filter((platform) => platform !== PLATFORMS.FACEBOOK)
        .map(platform => ({
            id: platform,
            name: platform.charAt(0).toUpperCase() + platform.slice(1),
            supportedFormats: getSupportedFormats(platform)
        }));

    sendSuccess(res, { platforms }, 'Supported platforms retrieved');
});

/**
 * Proxy download file from remote URL
 * POST /api/proxy-download
 */
export const proxyDownload = asyncHandler(async (req, res) => {
    const { fileUrl, type, fileName } = req.body;

    if (!fileUrl) {
        throw new ValidationError('fileUrl is required');
    }

    // Generate default filename if not provided
    let finalFileName = fileName;
    if (!finalFileName) {
        const ext = type === 'music' ? 'mp3' : (type === 'video' ? 'mp4' : 'jpg');
        finalFileName = `tiktok_${type}_${Date.now()}.${ext}`;
    }

    // Perform proxy download
    await proxyFileDownload(fileUrl, finalFileName, res);
});

