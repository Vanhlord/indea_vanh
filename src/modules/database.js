import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getCache, setCache, deleteCache } from './cache.js';

// Initialize SQLite database
const dbPath = path.join(process.cwd(), 'data.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT,
    avatar TEXT,
    lastLogin TEXT
  );

  CREATE TABLE IF NOT EXISTS server_status (
    id INTEGER PRIMARY KEY DEFAULT 1,
    status TEXT,
    maxPlayers INTEGER,
    ip TEXT,
    port TEXT
  );

  CREATE TABLE IF NOT EXISTS countdown_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    eventDate TEXT,
    eventTime TEXT,
    eventDescription TEXT
  );

  CREATE TABLE IF NOT EXISTS custom_download_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    note TEXT,
    link TEXT,
    downloadNote TEXT
  );

  CREATE TABLE IF NOT EXISTS whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS whitelist_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    gamertag TEXT,
    gamertag_norm TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    used_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_whitelist_keys_key ON whitelist_keys(key);
  CREATE INDEX IF NOT EXISTS idx_whitelist_keys_gamertag_norm ON whitelist_keys(gamertag_norm);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    endpoint TEXT UNIQUE,
    p256dh TEXT,
    auth TEXT,
    created_at TEXT
  );
`);

// Whitelist of valid table names to prevent SQL injection
const VALID_TABLES = new Set([
    'players', 'server_status', 'countdown_settings',
    'custom_download_config', 'whitelist', 'whitelist_keys',
    'push_subscriptions'
]);

// Whitelist of valid column names across all tables
const VALID_COLUMNS = new Set([
    'id', 'username', 'avatar', 'lastLogin',
    'status', 'maxPlayers', 'ip', 'port',
    'eventDate', 'eventTime', 'eventDescription',
    'note', 'link', 'downloadNote',
    'admin_id', 'key', 'gamertag', 'gamertag_norm',
    'created_at', 'used_at',
    'user_id', 'endpoint', 'p256dh', 'auth'
]);

function assertValidTable(table) {
    if (!VALID_TABLES.has(table)) {
        throw new Error(`Invalid table name: ${table}`);
    }
}

function assertValidColumns(columns) {
    for (const col of columns) {
        if (!VALID_COLUMNS.has(col)) {
            throw new Error(`Invalid column name: ${col}`);
        }
    }
}

// Function to get data
export async function getData(table, conditions = {}) {
    try {
        assertValidTable(table);
        const conditionKeys = Object.keys(conditions);
        if (conditionKeys.length > 0) {
            assertValidColumns(conditionKeys);
        }

        const cacheKey = `data:${table}:${JSON.stringify(conditions)}`;
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            console.log('Cache hit for', cacheKey);
            return cachedData;
        }

        let query = `SELECT * FROM "${table}"`;
        const params = [];
        if (conditionKeys.length > 0) {
            const whereClause = conditionKeys.map(key => `"${key}" = ?`).join(' AND ');
            query += ` WHERE ${whereClause}`;
            params.push(...Object.values(conditions));
        }
        const stmt = db.prepare(query);
        const data = stmt.all(...params);
        await setCache(cacheKey, data);
        console.log('Cache miss for', cacheKey, 'stored in cache');
        return data;
    } catch (error) {
        console.error('Error getting data:', error);
        return [];
    }
}

// Function to insert data
export async function insertData(table, data) {
    try {
        assertValidTable(table);
        const dataKeys = Object.keys(data);
        assertValidColumns(dataKeys);
        const columns = dataKeys.map(k => `"${k}"`).join(', ');
        const placeholders = dataKeys.map(() => '?').join(', ');
        const query = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders})`;
        const stmt = db.prepare(query);
        const result = stmt.run(...Object.values(data));
        // Invalidate cache for the table
        await deleteCache(`data:${table}:*`);
        return result.lastInsertRowid;
    } catch (error) {
        console.error('Error inserting data:', error);
        return null;
    }
}

// Function to update data
export async function updateData(table, data, conditions) {
    try {
        assertValidTable(table);
        const dataKeys = Object.keys(data);
        const conditionKeys = Object.keys(conditions);
        assertValidColumns(dataKeys);
        assertValidColumns(conditionKeys);
        const setClause = dataKeys.map(key => `"${key}" = ?`).join(', ');
        const whereClause = conditionKeys.map(key => `"${key}" = ?`).join(' AND ');
        const query = `UPDATE "${table}" SET ${setClause} WHERE ${whereClause}`;
        const stmt = db.prepare(query);
        const params = [...Object.values(data), ...Object.values(conditions)];
        const result = stmt.run(...params);
        await deleteCache(`data:${table}:*`);
        return result.changes;
    } catch (error) {
        console.error('Error updating data:', error);
        return 0;
    }
}

// Function to migrate JSON data to SQLite
export function migrateData() {
    try {
    // Migrate player.json
        if (fs.existsSync('player.json')) {
            const playerData = JSON.parse(fs.readFileSync('player.json', 'utf8'));
            insertData('players', playerData);
        }

        // Migrate server_status.json
        if (fs.existsSync('server_status.json')) {
            const serverData = JSON.parse(fs.readFileSync('server_status.json', 'utf8'));
            insertData('server_status', serverData);
        }

        // Migrate countdown_settings.json
        if (fs.existsSync('countdown_settings.json')) {
            const countdownData = JSON.parse(fs.readFileSync('countdown_settings.json', 'utf8'));
            insertData('countdown_settings', countdownData);
        }

        // Migrate custom_download_config.json
        if (fs.existsSync('custom_download_config.json')) {
            const downloadData = JSON.parse(fs.readFileSync('custom_download_config.json', 'utf8'));
            insertData('custom_download_config', downloadData);
        }

        // Migrate whitelist.json
        if (fs.existsSync('whitelist.json')) {
            const whitelistData = JSON.parse(fs.readFileSync('whitelist.json', 'utf8'));
            whitelistData.admins.forEach(adminId => insertData('whitelist', { admin_id: adminId }));
        }

        console.log('Data migration completed successfully.');
    } catch (error) {
        console.error('Error migrating data:', error);
    }
}

// Close database on process exit
process.on('exit', () => db.close());
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));

export default db;
