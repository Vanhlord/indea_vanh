import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
    getBedrockRenderJob,
    renderUploadedBedrockWorld,
    startBedrockRenderJob
} from '../services/bedrockWorldMapService.js';

const router = express.Router();

const uploadTempDir = path.join(os.tmpdir(), 'mcnote-bedrock-world-uploads');
if (!fs.existsSync(uploadTempDir)) {
    fs.mkdirSync(uploadTempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (_req, _file, cb) {
        cb(null, uploadTempDir);
    },
    filename: function (_req, file, cb) {
        const safeExt = path.extname(file.originalname || '').slice(0, 10);
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
        cb(null, unique);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 150 * 1024 * 1024,
        files: 4000
    }
});

function handleUpload(req, res, next) {
    upload.any()(req, res, (error) => {
        if (error) {
            const message = error.code === 'LIMIT_FILE_SIZE'
                ? 'File world quá lớn. Giới hạn hiện tại là 150MB cho mỗi file.'
                : error.message || 'Không thể nhận upload world.';
            return res.status(400).json({ success: false, error: message });
        }
        return next();
    });
}

function readRenderRequest(req) {
    const files = Array.isArray(req.files) ? req.files : [];
    const mode = String(req.body?.mode || '').trim().toLowerCase() === 'archive' ? 'archive' : 'folder';
    const relativePaths = Array.isArray(req.body?.relativePaths)
        ? req.body.relativePaths
        : typeof req.body?.relativePaths === 'string'
            ? [req.body.relativePaths]
            : [];

    return {
        files,
        mode,
        relativePaths
    };
}

router.post('/render/start', handleUpload, async (req, res) => {
    try {
        const data = await startBedrockRenderJob(readRenderRequest(req));
        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Bedrock render start error:', error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Không thể bắt đầu render Bedrock world.'
        });
    }
});

router.get('/render/jobs/:jobId', async (req, res) => {
    const job = getBedrockRenderJob(req.params.jobId);
    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'Không tìm thấy job render hoặc job đã hết hạn.'
        });
    }

    return res.json({
        success: true,
        data: job
    });
});

router.post('/render', handleUpload, async (req, res) => {
    try {
        const data = await renderUploadedBedrockWorld(readRenderRequest(req));

        return res.json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Bedrock world render error:', error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Không thể render Bedrock world.'
        });
    }
});

export default router;
