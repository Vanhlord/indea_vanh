import db from '../modules/database.js';

/**
 * Đọc toàn bộ players - Trình phục vụ legacy API
 */
export async function getPlayers() {
    try {
        return db.prepare('SELECT * FROM players').all();
    } catch (error) {
        console.error('❌ Error reading players from DB:', error.message);
        return [];
    }
}

/**
 * Kiểm tra player đã tồn tại chưa
 */
export async function playerExists(playerId) {
    if (!playerId) return false;
    const row = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
    return !!row;
}

/**
 * Log player (INSERT OR REPLACE to always have latest info)
 * @param {Object} playerData - { id, username, avatar }
 */
export async function logPlayer(playerData) {
    try {
        if (!playerData || !playerData.id) {
            return { success: false, message: 'Invalid player data' };
        }

        const id = String(playerData.id).trim();
        const username = (playerData.username || 'Unknown').trim().substring(0, 100);
        const avatar = playerData.avatar ? String(playerData.avatar).trim() : null;
        const now = new Date().toISOString();
        const existedBefore = await playerExists(id);

        // Use UPSERT (INSERT OR REPLACE in SQLite)
        const stmt = db.prepare(`
            INSERT INTO players (id, username, avatar, lastLogin)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                avatar = excluded.avatar,
                lastLogin = excluded.lastLogin
        `);
        
        stmt.run(id, username, avatar, now);
        const isNew = !existedBefore;

        return { success: true, isNew, message: 'Logged successfully' };
    } catch (error) {
        console.error('❌ [Player Log DB] Error:', error);
        return { success: false, message: 'Lỗi khi log player: ' + error.message };
    }
}

/**
 * Xóa player
 */
export async function removePlayer(playerId) {
    try {
        const result = db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
        return { success: result.changes > 0, message: result.changes > 0 ? 'Deleted' : 'Not found' };
    } catch (error) {
        console.error('❌ Error removing player:', error);
        return { success: false, message: error.message };
    }
}

/**
 * Lấy thống kê
 */
export async function getPlayerStats() {
    try {
        const players = await getPlayers();
        return {
            total: players.length,
            players: players
        };
    } catch (error) {
        return { total: 0, players: [] };
    }
}

/**
 * Get player by ID
 */
export async function getPlayerById(playerId) {
    if (!playerId) return null;
    return db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) || null;
}
