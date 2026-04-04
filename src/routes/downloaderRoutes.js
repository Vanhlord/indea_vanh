/**
 * Downloader Routes
 * API endpoints for media downloading
 */

import { Router } from 'express';
import {
    downloadMedia,
    getDownloadInfo,
    validateUrl,
    getPlatforms,
    proxyDownload
} from '../controllers/downloaderController.js';

import { validateBody, validateQuery } from '../middleware/validation.js';
import { z } from 'zod';

const router = Router();

// Validation schemas
const downloadSchema = z.object({
    url: z.string().url('Invalid URL format'),
    platform: z.enum(['tiktok', 'youtube', 'x', 'soundcloud']).optional(),
    type: z.string().optional(),
    quality: z.string().optional(),
    fileName: z.string().optional()
});

const proxyDownloadSchema = z.object({
    fileUrl: z.string().url('Invalid URL format'),
    type: z.string().optional(),
    fileName: z.string().optional()
});

const infoSchema = z.object({
    url: z.string().url('Invalid URL format'),
    platform: z.enum(['tiktok', 'youtube', 'x', 'soundcloud']).optional()
});

const validateSchema = z.object({
    url: z.string().url('Invalid URL format')
});

// Routes
router.post('/download', validateBody(downloadSchema), downloadMedia);
router.get('/info', validateQuery(infoSchema), getDownloadInfo);
router.post('/validate', validateBody(validateSchema), validateUrl);
router.get('/platforms', getPlatforms);

// Legacy platform-specific routes (backward compatibility)
router.post('/tiktok', validateBody(downloadSchema), (req, res, next) => {
    req.body.platform = 'tiktok';
    return downloadMedia(req, res, next);
});

router.post('/youtube', validateBody(downloadSchema), (req, res, next) => {
    req.body.platform = 'youtube';
    return downloadMedia(req, res, next);
});

router.post('/x', validateBody(downloadSchema), (req, res, next) => {
    req.body.platform = 'x';
    return downloadMedia(req, res, next);
});

router.post('/soundcloud', validateBody(downloadSchema), (req, res, next) => {
    req.body.platform = 'soundcloud';
    return downloadMedia(req, res, next);
});

// Proxy download route for direct file proxying
router.post('/proxy-download', validateBody(proxyDownloadSchema), proxyDownload);

export default router;
