import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import axios from 'axios';

// Import config from centralized config
import { PANEL_URL, API_KEY, SERVER_ID, DISCORD_BOT_TOKEN } from './src/config/index.js';

// Validate required environment variables
if (!DISCORD_BOT_TOKEN) {
    console.error('❌ CRITICAL: DISCORD_BOT_TOKEN is not set in environment variables!');
    console.error('Please add DISCORD_BOT_TOKEN to your .env file');
}

if (!API_KEY) {
    console.error('❌ CRITICAL: PIKAMC_API_KEY is not set in environment variables!');
    console.error('Please add PIKAMC_API_KEY to your .env file');
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Hàm gửi tin nhắn - Đã vô hiệu hóa gửi Discord, chỉ log ra console
async function sendToDiscord(sender, message) {
    // Chỉ log ra console, không gửi vào Discord nữa
    console.log(`[Chat] ${sender}: ${message}`);
    // Không gửi gì vào Discord channel
}

function initDiscord(onReadyCallback) {
    // Check if token is available
    if (!DISCORD_BOT_TOKEN) {
        console.error('❌ Cannot start Discord bot: DISCORD_BOT_TOKEN is not set');
        return;
    }

    client.once('ready', () => {
        console.log(`🤖 Bot Discord ${client.user.tag} sẵn sàng! (Chỉ nhận lệnh, không gửi chat)`);
        if (onReadyCallback) onReadyCallback();
    });

    client.once('error', (err) => {
        console.error('❌ Discord client error:', err.message);
    });

    client.login(DISCORD_BOT_TOKEN).catch(err => {
        console.error('❌ Failed to login to Discord:', err.message);
    });
}

// Hàm gửi lệnh vào Console web - centralized in pikamcService
async function sendConsoleCommand(command) {
    // Check if API_KEY is available
    if (!API_KEY) {
        console.error('❌ Cannot send console command: PIKAMC_API_KEY is not set');
        return { success: false, error: 'API_KEY not configured' };
    }

    try {
        await axios.post(`${PANEL_URL}/api/client/servers/${SERVER_ID}/command`,
            { command: command },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'Application/vnd.pterodactyl.v1+json'
                }
            });
        return { success: true };
    } catch (err) {
        console.error('Lỗi API PikaMC:', err.response ? err.response.data : err.message);
        return { success: false, error: err.message };
    }
}

// Nghe tin nhắn từ Discord và gửi vào game qua lệnh /say
client.on('messageCreate', async (message) => {
    // Chỉ nghe tin nhắn từ người dùng thật
    if (message.author.bot) return;

    const author = message.author.username;
    const content = message.content;

    // Lệnh /say gửi vào Console
    const mcCommand = `say ${author}: ${content}`;

    try {
        // Gửi lệnh qua API PikaMC
        const result = await sendConsoleCommand(mcCommand);
        if (result.success) {
            // Thả dấu tích xanh
            await message.react('✅');
        } else {
            // Thả dấu X đỏ báo lỗi
            await message.react('❌');
        }
    } catch (err) {
        console.error('API PikaMC lỗi:', err.message);
        // Thả dấu X đỏ báo lỗi
        try {
            await message.react('❌');
        } catch (e) {
            // Ignore if reaction fails
        }
    }
});

// Handle client disconnect
client.on('disconnect', (event) => {
    console.log('❌ Discord bot disconnected:', event);
});

client.on('reconnecting', () => {
    console.log('🔄 Discord bot reconnecting...');
});

client.on('resume', (replayed) => {
    console.log(`✅ Discord bot reconnected, replayed ${replayed} events`);
});

export { initDiscord, sendToDiscord, sendConsoleCommand };
