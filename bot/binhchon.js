import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { JSON_DIR } from '../src/config/index.js';

const router = express.Router();

// Use centralized JSON_DIR from config
const VOTE_FILE = path.join(JSON_DIR, 'binhchon.json');

// Lock mechanism to prevent race conditions
let isProcessing = false;

// Initialize vote file if it doesn't exist
async function initVoteFile() {
    try {
        await fs.access(VOTE_FILE);
    } catch {
        // File doesn't exist, create it
        const initialData = {
            giu_lai: 0,
            loai_bo: 0,
            voted_users: []
        };
        await fs.mkdir(path.dirname(VOTE_FILE), { recursive: true });
        await fs.writeFile(VOTE_FILE, JSON.stringify(initialData, null, 2));
    }
}

// Read vote data with error handling
async function readVoteData() {
    try {
        const data = await fs.readFile(VOTE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error reading vote file:', error);
        // Return default data if file is corrupted
        return {
            giu_lai: 0,
            loai_bo: 0,
            voted_users: []
        };
    }
}

// Write vote data with locking
async function writeVoteData(data) {
    while (isProcessing) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    isProcessing = true;
    try {
        await fs.writeFile(VOTE_FILE, JSON.stringify(data, null, 2));
    } finally {
        isProcessing = false;
    }
}

// Initialize on module load
initVoteFile().catch(console.error);

router.get('/binhchon/counts', async (req, res) => {
    try {
        const data = await readVoteData();
        res.json({
            giu_lai: data.giu_lai || 0,
            loai_bo: data.loai_bo || 0
        });
    } catch (error) {
        console.error('❌ Lỗi lấy số lượng bình chọn:', error);
        res.status(500).json({ message: 'Lỗi server!' });
    }
});

router.post('/binhchon', async (req, res) => {
    try {
        const { choice, userId, userName } = req.body;

        // Validate inputs
        if (!userId || typeof userId !== 'string') {
            return res.status(400).json({ message: 'Thiếu userId!' });
        }
        if (!choice || !['giu_lai', 'loai_bo'].includes(choice)) {
            return res.status(400).json({ message: 'Lựa chọn không hợp lệ!' });
        }

        // Sanitize inputs
        const sanitizedUserId = userId.trim();
        const sanitizedUserName = userName ? userName.trim().substring(0, 50) : 'Unknown';

        // Đọc file json
        const data = await readVoteData();

        // Kiểm tra xem người dùng này đã vote chưa dựa trên Discord ID
        const hasVoted = data.voted_users.some(u => u.id === sanitizedUserId);

        if (hasVoted) {
            return res.status(400).json({ 
                message: `Người dùng ${sanitizedUserName} đã bình chọn trước đó rồi! ✨` 
            });
        }

        // Tăng số lượng bình chọn
        if (choice === 'giu_lai') data.giu_lai++;
        else if (choice === 'loai_bo') data.loai_bo++;

        // Lưu thông tin người đã vote
        data.voted_users.push({
            id: sanitizedUserId,
            name: sanitizedUserName,
            timestamp: new Date().toISOString()
        });

        await writeVoteData(data);

        res.json({
            message: `Cảm ơn ${sanitizedUserName} đã góp ý kiến! ❤️`,
            counts: {
                giu_lai: data.giu_lai,
                loai_bo: data.loai_bo
            }
        });
    } catch (error) {
        console.error('❌ Lỗi xử lý bình chọn:', error);
        res.status(500).json({ message: 'Lỗi server! Vui lòng thử lại.' });
    }
});

export default router;
