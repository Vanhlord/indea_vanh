import Database from 'better-sqlite3';
import path from 'path';
import sharp from 'sharp';
import express from 'express';
import { ROOT_DIR } from '../../config/index.js';

export const PIXEON_WIDTH = 1000;
export const PIXEON_HEIGHT = 1000;
const COOLDOWN_MS = 0;

export const COLOR_MAP = [
    '#ffffff', '#e4e4e4', '#888888', '#222222', '#ffa7d1', '#e50000', 
    '#e59500', '#a06a42', '#e5d900', '#94e044', '#02be01', '#00e5f0', 
    '#0083c7', '#0000ea', '#e04aff', '#820080'
];

// Initialize DB inside the root directory
const dbPath = path.join(ROOT_DIR, 'pixeon.db');
const db = new Database(dbPath);

// Create table if not exists (V2 Schema for drawing persistence)
db.exec(`
    CREATE TABLE IF NOT EXISTS pixels (
        x INTEGER,
        y INTEGER,
        color TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (x, y)
    )
`);

const insertPixel = db.prepare(`
    INSERT INTO pixels (x, y, color, updated_at) 
    VALUES (@x, @y, @color, CURRENT_TIMESTAMP)
    ON CONFLICT(x, y) DO UPDATE SET color = @color, updated_at = CURRENT_TIMESTAMP
`);

const getAllPixels = db.prepare('SELECT x, y, color FROM pixels');

// In-Memory array for hardware-accelerated image generation
const bufferSize = PIXEON_WIDTH * PIXEON_HEIGHT * 3;
const imageBuffer = new Uint8Array(bufferSize);
// Fill with white
imageBuffer.fill(255);

// Convert HEX string to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Bresenham's line algorithm to paint into the raster buffer
function drawLineOnBuffer(x1, y1, x2, y2, colorId) {
    const rgb = hexToRgb(COLOR_MAP[colorId]);
    if (!rgb) return;

    let x = Math.floor(x1);
    let y = Math.floor(y1);
    const xe = Math.floor(x2);
    const ye = Math.floor(y2);

    const dx = Math.abs(xe - x);
    const dy = Math.abs(ye - y);
    const sx = (x < xe) ? 1 : -1;
    const sy = (y < ye) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        // Draw pixel in memory
        if (x >= 0 && x < PIXEON_WIDTH && y >= 0 && y < PIXEON_HEIGHT) {
            const idx = (y * PIXEON_WIDTH + x) * 3;
            imageBuffer[idx] = rgb.r;
            imageBuffer[idx + 1] = rgb.g;
            imageBuffer[idx + 2] = rgb.b;
            // Note: We don't write EVERY pixel to DB during a stroke to avoid crash. 
            // We'll trust the memory buffer for now and consider periodic full-sync or stroke storage.
        }

        if (x === xe && y === ye) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
}

function loadDbToMemory() {
    try {
        const rows = getAllPixels.all();
        for (const row of rows) {
            if (row.x >= 0 && row.x < PIXEON_WIDTH && row.y >= 0 && row.y < PIXEON_HEIGHT) {
                const rgb = hexToRgb(row.color);
                if (rgb) {
                    const idx = (row.y * PIXEON_WIDTH + row.x) * 3;
                    imageBuffer[idx] = rgb.r;
                    imageBuffer[idx + 1] = rgb.g;
                    imageBuffer[idx + 2] = rgb.b;
                }
            }
        }
    } catch (e) {}
}
loadDbToMemory();

// Router
export const pixeonRouter = express.Router();
pixeonRouter.get('/board.png', async (req, res) => {
    try {
        const pngBuffer = await sharp(Buffer.from(imageBuffer), {
            raw: { width: PIXEON_WIDTH, height: PIXEON_HEIGHT, channels: 3 }
        }).png().toBuffer();
        res.setHeader('Content-Type', 'image/png');
        res.send(pngBuffer);
    } catch (err) {
        res.status(500).send("Error generating board.");
    }
});

const cooldowns = new Map();

export function setupPixeonSocket(io) {
    const nsp = io.of('/pixeon');
    
    nsp.on('connection', (socket) => {
        const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || socket.id;
        socket.emit('config', { width: PIXEON_WIDTH, height: PIXEON_HEIGHT, cooldownMs: COOLDOWN_MS });

        // Binary Stroke Protocol: [x1:u16, y1:u16, x2:u16, y2:u16, colorId:u8] = 9 bytes
        socket.on('p', (buf) => {
            if (!Buffer.isBuffer(buf) || buf.length !== 9) return;
            
            const x1 = buf.readUInt16LE(0);
            const y1 = buf.readUInt16LE(2);
            const x2 = buf.readUInt16LE(4);
            const y2 = buf.readUInt16LE(6);
            const cid = buf.readUInt8(8);
            
            if (x1 >= PIXEON_WIDTH || y1 >= PIXEON_HEIGHT || x2 >= PIXEON_WIDTH || y2 >= PIXEON_HEIGHT || cid >= COLOR_MAP.length) return;

            // Draw on server memory
            drawLineOnBuffer(x1, y1, x2, y2, cid);
            
            // Broadcast the segment to all other clients
            nsp.emit('b', buf);
            
            // Persistence: We just save the end point for now to avoid DB explosion
            // A better way would be saving whole segments but keeping schema simple.
            try {
                insertPixel.run({ x: x2, y: y2, color: COLOR_MAP[cid] });
            } catch (err) {}
        });
    });
}
