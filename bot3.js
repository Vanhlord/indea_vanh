import 'dotenv/config';
import bedrock from 'bedrock-protocol';
import { initDiscord, sendToDiscord } from './discord.js';
import io from 'socket.io-client';

// Configuration from environment variables
const MINECRAFT_HOST = process.env.MINECRAFT_HOST || 'vanhmcpe.my-land.fun';
const MINECRAFT_PORT = parseInt(process.env.MINECRAFT_PORT) || 25702;
const MINECRAFT_VERSION = process.env.MINECRAFT_VERSION || '1.26';
const MINECRAFT_USERNAME = process.env.MINECRAFT_USERNAME || '';
const MINECRAFT_AUTH = process.env.MINECRAFT_AUTH || 'microsoft';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:3000';
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY) || 5000;

// Validate required config
if (!MINECRAFT_USERNAME) {
    console.error('❌ CRITICAL: MINECRAFT_USERNAME is not set in environment variables!');
    console.error('Please add MINECRAFT_USERNAME to your .env file');
    process.exit(1);
}

const socket = io(SOCKET_URL);

// Socket error handling
socket.on('connect_error', (err) => {
    console.error('❌ Socket connection error:', err.message);
});

socket.on('disconnect', (reason) => {
    console.log('⚠️  Socket disconnected:', reason);
});

socket.on('error', (err) => {
    console.error('❌ Socket error:', err.message);
});

let bot = null;
let reconnectTimeout = null;

function createBot() {
    console.log(`🎮 Connecting to Minecraft server ${MINECRAFT_HOST}:${MINECRAFT_PORT}...`);
    
    bot = bedrock.createClient({
        host: MINECRAFT_HOST,
        port: MINECRAFT_PORT,
        version: MINECRAFT_VERSION,
        username: MINECRAFT_USERNAME,
        auth: MINECRAFT_AUTH
    });

    // Khi đã vào server thành công
    bot.on('join', () => {
        console.log('💎 Bot đã kết nối thành công đến server! Đang bắt đầu lắng nghe...');
        // Clear any pending reconnect timeout
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    });

    bot.on('text', (packet) => {
        try {
            let msg = packet.message;
            if (msg.startsWith('{')) {
                msg = JSON.parse(msg).rawtext.map(i => i.text).join('');
            }

            // Dọn rác: mã màu và mấy ký tự hệ thống
            const cleanMsg = msg.replace(/§[0-9a-fk-or]/g, '').replace('%multiplayer.player.joined', 'Có người chơi vừa vào').replace('%multiplayer.player.left', 'Một người chơi đã rời đi').trim();
            const sender = packet.source_name || 'Hệ thống';
            if (cleanMsg.includes('[Server]')) return;

            sendToDiscord(sender, cleanMsg);
            console.log(`[LOG] ${sender}: ${cleanMsg}`);

            // Send to web chat
            socket.emit('mc-chat-from-bot', { user: sender, text: cleanMsg });
        } catch (e) { console.log('Lỗi:', e.message); }
    });

    // Xử lý khi bị kick hoặc lỗi
    bot.on('error', (err) => {
        console.error('❌ Bot error:', err.message);
    });

    // Handle disconnect with reconnection logic
    bot.on('disconnect', (reason) => {
        console.log('⚠️  Bot disconnected:', reason);
        console.log(`🔄 Will attempt to reconnect in ${RECONNECT_DELAY}ms...`);
        
        // Schedule reconnection
        reconnectTimeout = setTimeout(() => {
            console.log('🔄 Attempting to reconnect...');
            createBot();
        }, RECONNECT_DELAY);
    });

    // Handle kick
    bot.on('kick', (reason) => {
        console.error('❌ Bot was kicked:', reason);
        console.log(`🔄 Will attempt to reconnect in ${RECONNECT_DELAY}ms...`);
        
        reconnectTimeout = setTimeout(() => {
            console.log('🔄 Attempting to reconnect after kick...');
            createBot();
        }, RECONNECT_DELAY);
    });

    // Lắng nghe tin nhắn từ Web để gửi vào Game
    socket.on('web-chat-message', (data) => {
        if (!bot) {
            console.warn('⚠️  Cannot send message: bot is not connected');
            return;
        }
        
        // Validate input
        if (!data || !data.user || !data.content) {
            console.warn('⚠️  Invalid web-chat-message data received');
            return;
        }
        
        try {
            // Tạo gói tin chat để gửi vào server Minecraft
            const message = `[Web] ${data.user}: ${data.content}`;
            
            bot.queue('text', {
                type: 'chat', 
                needs_translation: false, 
                source_name: bot.username, 
                xuid: '', 
                platform_chat_id: '',
                message: message
            });
            
            console.log('✅ Đã chuyển tin nhắn từ Web vào Game!');
        } catch (err) {
            console.error('❌ Error sending message to game:', err.message);
        }
    });
}

// Initialize Discord and then create bot
initDiscord(() => {
    console.log('🚀 Discord initialized, starting Minecraft bot...');
    createBot();
});

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (bot) bot.disconnect?.();
    socket.disconnect();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (bot) bot.disconnect?.();
    socket.disconnect();
    process.exit(0);
});
