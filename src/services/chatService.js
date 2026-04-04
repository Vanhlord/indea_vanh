import { promises as fs } from 'fs';
import path from 'path';
import { CHAT_HISTORY_FILE, MAX_CHAT_HISTORY, BLOCKED_MESSAGE_PATTERNS } from '../config/index.js';

let chatHistory = [];
let isSaving = false; // Lock flag to prevent race conditions
let pendingSave = false; // Flag to indicate a save is pending

// Load chat history from file
export async function loadChatHistory() {
    try {
        const data = await fs.readFile(CHAT_HISTORY_FILE, 'utf8');
        chatHistory = JSON.parse(data);
        console.log(`✅ Đã nạp ${chatHistory.length} tin nhắn từ lịch sử`);
    } catch (error) {
        chatHistory = [];
        console.log('ℹ️ Chưa có lịch sử chat, tạo mới');
    }
}

// Save chat history to file with locking
export async function saveChatHistory() {
    // If already saving, mark as pending and return
    if (isSaving) {
        pendingSave = true;
        return;
    }

    isSaving = true;
    pendingSave = false;

    try {
        await fs.mkdir(path.dirname(CHAT_HISTORY_FILE), { recursive: true });
        await fs.writeFile(CHAT_HISTORY_FILE, JSON.stringify(chatHistory, null, 2));
    } catch (error) {
        console.error('❌ Lỗi lưu lịch sử chat:', error);
        throw error; // Propagate error so caller knows
    } finally {
        isSaving = false;
        
        // If another save was requested during this save, do it now
        if (pendingSave) {
            await saveChatHistory();
        }
    }
}

// Add message to history with validation
export async function addChatMessage(user, text, source = 'game') {
    // Validate inputs
    if (!user || typeof user !== 'string') {
        throw new Error('Invalid user: must be a non-empty string');
    }
    if (!text || typeof text !== 'string') {
        throw new Error('Invalid text: must be a non-empty string');
    }

    const message = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        user: user.trim(),
        text: text.trim(),
        source: ['web', 'game', 'discord'].includes(source) ? source : 'game',
        timestamp: new Date().toISOString()
    };
    
    chatHistory.push(message);
    
    // Trim to max size
    if (chatHistory.length > MAX_CHAT_HISTORY) {
        chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY);
    }
    
    await saveChatHistory();
    return message;
}

// Check if message should be blocked
export function shouldBlockMessage(message) {
    if (!message || typeof message !== 'string') return false;
    return BLOCKED_MESSAGE_PATTERNS.some(pattern => pattern.test(message));
}

// Get recent messages
export function getRecentMessages(count = 50) {
    const safeCount = Math.max(1, Math.min(count, MAX_CHAT_HISTORY));
    return chatHistory.slice(-safeCount);
}

// Get all messages (returns copy to prevent external modification)
export function getAllMessages() {
    return [...chatHistory];
}

// Clear history
export async function clearHistory() {
    chatHistory = [];
    await saveChatHistory();
}

// Get message count
export function getMessageCount() {
    return chatHistory.length;
}
