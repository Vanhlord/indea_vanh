import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configure multer for file upload (temp storage first)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Use temp folder first, then compress and move
        const tempPath = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true });
        }
        cb(null, tempPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for upload
    fileFilter: function (req, file, cb) {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file ảnh!'));
        }
    }
});

// Compress image function
async function compressImage(inputPath, outputPath, targetSizeMB = 5) {
    const targetBytes = targetSizeMB * 1024 * 1024;
    
    // Get original file stats
    const stats = fs.statSync(inputPath);
    const originalSize = stats.size;
    
    // If already under target size, just copy
    if (originalSize <= targetBytes) {
        fs.copyFileSync(inputPath, outputPath);
        return {
            compressed: false,
            originalSize,
            finalSize: originalSize
        };
    }
    
    // Need compression
    let quality = 90;
    let format = 'jpeg';
    
    // Determine format from extension
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.png') {
        format = 'png';
    } else if (ext === '.webp') {
        format = 'webp';
    } else if (ext === '.gif') {
        // GIF không nén được bằng sharp, copy nguyên
        fs.copyFileSync(inputPath, outputPath);
        return {
            compressed: false,
            originalSize,
            finalSize: originalSize,
            note: 'GIF không được nén'
        };
    }
    
    let finalSize = originalSize;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (finalSize > targetBytes && attempts < maxAttempts && quality > 10) {
        attempts++;
        
        if (format === 'jpeg' || format === 'webp') {
            await sharp(inputPath)
                .resize(2048, 2048, { 
                    fit: 'inside',
                    withoutEnlargement: true 
                })
                .jpeg({ quality, progressive: true })
                .toFile(outputPath);
        } else if (format === 'png') {
            await sharp(inputPath)
                .resize(2048, 2048, { 
                    fit: 'inside',
                    withoutEnlargement: true 
                })
                .png({ 
                    compressionLevel: Math.min(9, Math.floor((100 - quality) / 10)),
                    adaptiveFiltering: true
                })
                .toFile(outputPath);
        }
        
        finalSize = fs.statSync(outputPath).size;
        
        // Reduce quality for next attempt
        if (finalSize > targetBytes) {
            quality -= 10;
        }
    }
    
    // If still too big, resize more aggressively
    if (finalSize > targetBytes) {
        let width = 1920;
        while (finalSize > targetBytes && width > 800) {
            await sharp(inputPath)
                .resize(width, null, { 
                    fit: 'inside',
                    withoutEnlargement: true 
                })
                .jpeg({ quality: 80, progressive: true })
                .toFile(outputPath);
            
            finalSize = fs.statSync(outputPath).size;
            width -= 200;
        }
    }
    
    return {
        compressed: true,
        originalSize,
        finalSize,
        quality,
        attempts
    };
}

// Upload image - requires login
router.post('/upload', (req, res, next) => {
    // Check if user is logged in before processing upload
    if (!req.session || !req.session.user || !req.session.user.username) {
        return res.status(401).json({ error: 'Vui lòng đăng nhập để tạo album!' });
    }
    // Store username in req for multer to use
    req.username = req.session.user.username;
    next();
}, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Không có file nào được upload' });
        }
        
        const username = req.session.user.username;
        const tempPath = req.file.path;
        const originalname = req.file.originalname;
        
        // Create user album folder
        const uploadPath = path.join(__dirname, '../../album', username);
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        // Generate final filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const finalFilename = uniqueSuffix + path.extname(originalname).toLowerCase();
        const finalPath = path.join(uploadPath, finalFilename);
        
        // Compress image
        const compressionResult = await compressImage(tempPath, finalPath, 5);
        
        // Delete temp file
        fs.unlinkSync(tempPath);
        
        console.log(`📸 Upload: ${username}/${finalFilename}`);
        console.log(`   Original: ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Final: ${(compressionResult.finalSize / 1024 / 1024).toFixed(2)} MB`);
        if (compressionResult.compressed) {
            console.log(`   ✅ Đã nén xuống ${compressionResult.quality}% quality`);
        }
        
        res.json({
            success: true,
            message: 'Upload thành công!',
            filename: finalFilename,
            path: `/album/${username}/${finalFilename}`,
            username: username,
            compression: {
                compressed: compressionResult.compressed,
                originalSize: compressionResult.originalSize,
                finalSize: compressionResult.finalSize
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        // Clean up temp file if exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Lỗi khi upload file: ' + error.message });
    }
});

// Get all albums (list of users with their first image)
router.get('/list', (req, res) => {
    try {
        const albumPath = path.join(__dirname, '../../album');
        
        if (!fs.existsSync(albumPath)) {
            return res.json({ albums: [] });
        }
        
        const users = fs.readdirSync(albumPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => {
                const username = dirent.name;
                const userPath = path.join(albumPath, username);
                const files = fs.readdirSync(userPath)
                    .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
                
                return {
                    username: username,
                    firstImage: files.length > 0 ? `/album/${username}/${files[0]}` : null,
                    imageCount: files.length
                };
            })
            .filter(album => album.firstImage !== null); // Only show users with images
        
        res.json({ albums: users });
    } catch (error) {
        console.error('List albums error:', error);
        res.status(500).json({ error: 'Lỗi khi lấy danh sách album' });
    }
});

// Get all images from a specific user's album
router.get('/:username', (req, res) => {
    try {
        const username = req.params.username;
        const userPath = path.join(__dirname, '../../album', username);
        
        if (!fs.existsSync(userPath)) {
            return res.status(404).json({ error: 'Album không tồn tại' });
        }
        
        const files = fs.readdirSync(userPath)
            .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
            .map(file => ({
                filename: file,
                path: `/album/${username}/${file}`
            }));
        
        res.json({
            username: username,
            images: files
        });
    } catch (error) {
        console.error('Get album error:', error);
        res.status(500).json({ error: 'Lỗi khi lấy ảnh trong album' });
    }
});

export default router;
