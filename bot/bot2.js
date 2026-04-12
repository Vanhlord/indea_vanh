import { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ChannelType, Partials } from 'discord.js';
import { DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID_1, DISCORD_CHANNEL_ID_2, DISCORD_DONATE_CHANNEL_ID } from '../src/config/index.js';
import { addDonation, parseDonationCommand, parseRemoveCommand, removeDonation } from '../src/services/donateService.js';

let client2;
let startPromise = null;
// Cấu hình ID kênh để bot gửi tin nhắn cố định
const FIXED_CHANNEL_ID_1 = DISCORD_CHANNEL_ID_1;

const FIXED_CHANNEL_ID_2 = DISCORD_CHANNEL_ID_2;

// Bot token from environment configuration
export const BOT2_TOKEN = DISCORD_BOT_TOKEN;
/**
 * Khởi chạy Bot 2
 */
// Socket.IO instance for real-time updates
let ioInstance = null;

export const setSocketIO = (io) => {
    ioInstance = io;
};

export const startBot2 = () => {
    if (client2 && client2.isReady && client2.isReady()) {
        return Promise.resolve(true);
    }
    if (startPromise) {
        return startPromise;
    }
    if (!BOT2_TOKEN || BOT2_TOKEN.includes('PASTE_YOUR_BOT_TOKEN_HERE')) {
        console.warn('[Bot 2] BOT2_TOKEN chưa được cấu hình trong môi trường/config.');
        return Promise.resolve(false);
    }

    client2 = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel]
    });

    client2.once('ready', async () => {
        console.log(`✅ [Bot 2] Online — ready to send embeds to ${FIXED_CHANNEL_ID_1} and ${FIXED_CHANNEL_ID_2}`);
        if (DISCORD_DONATE_CHANNEL_ID) {
            console.log(`💰 [Bot 2] Donate channel configured: ${DISCORD_DONATE_CHANNEL_ID}`);
            
            // Send startup ping to donate channel
            try {
                const donateChannel = await client2.channels.fetch(DISCORD_DONATE_CHANNEL_ID);
                if (donateChannel) {
                    const startupEmbed = new EmbedBuilder()
                        .setTitle('🚀 Server Đã Khởi Động Lại')
                        .setDescription('Bot donate đã sẵn sàng nhận lệnh!\n\n**Cách dùng:** `!add "Tên" 100.000`')
                        .setColor('#00ff00')
                        .setTimestamp();
                    await donateChannel.send({ embeds: [startupEmbed] });
                    console.log('[Bot 2] Startup ping sent to donate channel');
                }
            } catch (error) {
                console.error('[Bot 2] Failed to send startup ping:', error.message);
            }
        }
    });

    // Listen for donation commands
    client2.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (message.channel?.type === ChannelType.DM) {
            return;
        }

        // Ignore non-donate channels
        if (!DISCORD_DONATE_CHANNEL_ID || message.channel.id !== DISCORD_DONATE_CHANNEL_ID) return;

        // Parse !add command
        const parsedAdd = parseDonationCommand(message.content);
        if (parsedAdd) {
            const { name, amount } = parsedAdd;
            if (!name || amount <= 0) {
                await message.reply('❌ Lệnh không hợp lệ. Ví dụ: `!add "Nguyễn Văn A" 100.000`');
                return;
            }

            try {
                const result = await addDonation(name, amount);
                
                // Reply to Discord
                const embed = new EmbedBuilder()
                    .setTitle('💰 Đã cập nhật donate!')
                    .setDescription(`**${name}**: +${amount.toLocaleString('vi-VN')}đ`)
                    .addFields(
                        { name: 'Tổng donate của người này', value: `${result.donor.amount.toLocaleString('vi-VN')}đ`, inline: true },
                        { name: 'Tổng toàn bộ', value: `${result.total.toLocaleString('vi-VN')}đ`, inline: true }
                    )
                    .setColor('#e91e63')
                    .setTimestamp();

                await message.reply({ embeds: [embed] });

                // Emit to web via Socket.IO
                if (ioInstance) {
                    ioInstance.emit('donation-update', {
                        donor: result.donor,
                        total: result.total,
                        topDonors: result.topDonors
                    });
                    console.log(`[Bot 2] Donation broadcasted: ${name} +${amount}`);
                }

            } catch (error) {
                console.error('[Bot 2] Error processing donation:', error);
                await message.reply('❌ Có lỗi xảy ra khi cập nhật donate.');
            }
            return;
        }

        // Parse !remove command
        const nameToRemove = parseRemoveCommand(message.content);
        if (nameToRemove) {
            try {
                const result = await removeDonation(nameToRemove);
                
                if (!result.success) {
                    await message.reply(`❌ ${result.message}`);
                    return;
                }

                // Reply to Discord
                const embed = new EmbedBuilder()
                    .setTitle('🗑️ Đã xóa donate!')
                    .setDescription(`**${result.removed.name}**: ${result.removed.amount.toLocaleString('vi-VN')}đ`)
                    .addFields(
                        { name: 'Tổng toàn bộ còn lại', value: `${result.total.toLocaleString('vi-VN')}đ`, inline: true },
                        { name: 'Số người donate', value: `${result.topDonors.length}`, inline: true }
                    )
                    .setColor('#ff5722')
                    .setTimestamp();

                await message.reply({ embeds: [embed] });

                // Emit to web via Socket.IO
                if (ioInstance) {
                    ioInstance.emit('donation-update', {
                        removed: result.removed,
                        total: result.total,
                        topDonors: result.topDonors
                    });
                    console.log(`[Bot 2] Donation removed: ${result.removed.name}`);
                }

            } catch (error) {
                console.error('[Bot 2] Error removing donation:', error);
                await message.reply('❌ Có lỗi xảy ra khi xóa donate.');
            }
            return;
        }
    });

    startPromise = (async () => {
        try {
            await client2.login(BOT2_TOKEN);
            const ok = await waitForBotReady(8000);
            if (!ok) {
                console.warn('[Bot 2] Bot chưa sẵn sàng sau khi đăng nhập (timeout).');
            }
            return ok;
        } catch (err) {
            console.error('[Bot 2] Login failed:', err);
            return false;
        } finally {
            startPromise = null;
        }
    })();

    return startPromise;
};

/**
 * Hàm gửi Embed (Đã bỏ tham số channelId vì dùng cố định)
 * @param {Object} data - Dữ liệu từ Web truyền sang
 */
function waitForBotReady(timeoutMs = 8000) {
    return new Promise(resolve => {
        if (client2 && client2.isReady && client2.isReady()) return resolve(true);
        let resolved = false;
        const onReady = () => {
            if (resolved) return; resolved = true;
            clearTimeout(timer);
            resolve(true);
        };
        client2?.once('ready', onReady);
        const timer = setTimeout(() => {
            if (resolved) return; resolved = true;
            try {
                client2?.removeListener('ready', onReady);
            } catch (_error) {
                // Ignore listener cleanup errors.
            }
            resolve(false);
        }, timeoutMs);
    });
}

export const isBotReady = () => Boolean(client2 && client2.isReady && client2.isReady());

export const sendDirectMessage = async (userId, payload = {}) => {
    try {
        const targetId = String(userId || '').trim();
        if (!targetId) {
            return { success: false, error: 'Thiếu userId để gửi DM.' };
        }

        if (!client2 || !client2.isReady || !client2.isReady()) {
            const ok = await startBot2();
            if (!ok) {
                return { success: false, error: 'Bot chưa sẵn sàng để gửi DM.' };
            }
        }

        const messagePayload = {};
        if (payload.content) messagePayload.content = payload.content;
        if (payload.embed) {
            const embed = payload.embed instanceof EmbedBuilder
                ? payload.embed
                : new EmbedBuilder(payload.embed);
            messagePayload.embeds = [embed];
        }
        if (Array.isArray(payload.components) && payload.components.length > 0) {
            messagePayload.components = payload.components;
        }

        if (!messagePayload.content && !messagePayload.embeds) {
            return { success: false, error: 'Nội dung DM trống.' };
        }

        const user = await client2.users.fetch(targetId);
        if (!user) {
            return { success: false, error: 'Không tìm thấy user để gửi DM.' };
        }

        await user.send(messagePayload);
        return { success: true };
    } catch (error) {
        return { success: false, error: error?.message || 'Gửi DM thất bại.' };
    }
};

function getMissingPermissions(channel) {
    if (!channel?.permissionsFor || !client2?.user) return [];
    const perms = channel.permissionsFor(client2.user);
    if (!perms) return ['ViewChannel', 'SendMessages', 'EmbedLinks'];
    const required = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks
    ];
    const missing = required.filter((perm) => !perms.has(perm));
    return missing.map((perm) => {
        if (perm === PermissionsBitField.Flags.ViewChannel) return 'ViewChannel';
        if (perm === PermissionsBitField.Flags.SendMessages) return 'SendMessages';
        if (perm === PermissionsBitField.Flags.EmbedLinks) return 'EmbedLinks';
        return String(perm);
    });

}

function resolveChannelId(data) {
    if (data.channel === 'channel2') return FIXED_CHANNEL_ID_2;
    return FIXED_CHANNEL_ID_1;
}

export const sendEmbed = async (data) => {
    try {
        if (!client2 || !client2.isReady || !client2.isReady()) {
            const ok = await startBot2();
            if (!ok) {
                return { success: false, error: 'Bot chưa sẵn sàng: BOT2_TOKEN chưa cấu hình hoặc lỗi đăng nhập.' };
            }
        }

        // Chọn kênh dựa trên data.channel
        const channelId = resolveChannelId(data);
        if (!channelId) {
            return { success: false, error: 'Chưa cấu hình ID kênh gửi embed.' };
        }

        const channel = await client2.channels.fetch(channelId);
        if (!channel) {
            return { success: false, error: 'Không tìm thấy kênh này, vui lòng kiểm tra lại ID.' };
        }

        const missingPerms = getMissingPermissions(channel);
        if (missingPerms.length > 0) {
            return { success: false, error: `Bot thiếu quyền: ${missingPerms.join(', ')}` };
        }

        const embed = new EmbedBuilder()
            .setTitle(data.title || 'Thông báo')
            .setDescription(data.content || 'Nội dung trống')
            .setColor(data.color || '#3b82f2')
            .setTimestamp();

        // Các tính năng mở rộng
        if (data.image) embed.setImage(data.image);
        if (data.thumbnail) embed.setThumbnail(data.thumbnail);
        if (data.footer) embed.setFooter({ text: data.footer });

        await channel.send({ embeds: [embed] });

        console.log(`🚀 Đã gửi 1 Embed vào kênh ${channelId}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Lỗi gửi Embed:', error);
        return { success: false, error: error.message };
    }
};
