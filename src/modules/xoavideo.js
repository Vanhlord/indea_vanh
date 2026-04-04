import { promises as fs } from 'fs';
import path from 'path';
import { watch } from 'fs';

// Paths to folders to clean
const folderPaths = [path.join(process.cwd(), './video'), path.join(process.cwd(), './youtube'), path.join(process.cwd(), './mp3')];

const FILE_TTL_MS = 2 * 60 * 1000; // 2 minutes per file
const scheduled = new Map(); // fullPath -> timeout

function scheduleDeletion(fullPath, mtimeMs) {
    // Cancel previous schedule if exists
    if (scheduled.has(fullPath)) {
        clearTimeout(scheduled.get(fullPath));
    }

    const age = Date.now() - mtimeMs;
    const delay = Math.max(0, FILE_TTL_MS - age);

    const timeout = setTimeout(async () => {
        try {
            await fs.unlink(fullPath);
            console.log(`🗑️ Deleted ${fullPath} after ${FILE_TTL_MS/1000}s`);
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.warn(`File already removed: ${fullPath}`);
            } else {
                console.error(`Failed to delete ${fullPath}:`, err);
            }
        } finally {
            scheduled.delete(fullPath);
        }
    }, delay);

    scheduled.set(fullPath, timeout);
    console.log(`⏱ Scheduled deletion for ${fullPath} in ${Math.ceil(delay/1000)}s`);
}

function cancelScheduled(fullPath) {
    if (scheduled.has(fullPath)) {
        clearTimeout(scheduled.get(fullPath));
        scheduled.delete(fullPath);
        console.log(`✖️ Canceled scheduled deletion for ${fullPath}`);
    }
}

async function processFolder(folderPath) {
    try {
        const files = await fs.readdir(folderPath);
        for (const file of files) {
            const fullPath = path.join(folderPath, file);
            try {
                const stat = await fs.stat(fullPath);
                const mtimeMs = stat.mtimeMs || stat.ctimeMs || Date.now();
                const age = Date.now() - mtimeMs;
                if (age >= FILE_TTL_MS) {
                    // Delete immediately
                    try {
                        await fs.unlink(fullPath);
                        console.log(`🗑️ Deleted stale file ${fullPath}`);
                        cancelScheduled(fullPath);
                    } catch (err) {
                        if (err.code !== 'ENOENT') console.error(`Failed to delete stale file ${fullPath}:`, err);
                    }
                } else {
                    // Schedule deletion at the right time
                    scheduleDeletion(fullPath, mtimeMs);
                }
            } catch (err) {
                if (err.code !== 'ENOENT') console.error('Error stating file', fullPath, err);
            }
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.warn(`Folder does not exist: ${folderPath}`);
            return;
        }
        console.error('Error processing folder', folderPath, err);
    }
}

function watchFolder(folderPath) {
    try {
        const watcher = watch(folderPath, { persistent: true }, async (eventType, filename) => {
            if (!filename) return;
            const fullPath = path.join(folderPath, filename);
            if (eventType === 'rename' || eventType === 'change') {
                // On rename, file may be added or removed
                try {
                    const stat = await fs.stat(fullPath);
                    const mtimeMs = stat.mtimeMs || stat.ctimeMs || Date.now();
                    scheduleDeletion(fullPath, mtimeMs);
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        // Removed
                        cancelScheduled(fullPath);
                    } else {
                        console.error('Watcher error statting file', fullPath, err);
                    }
                }
            }
        });

        watcher.on('error', (err) => console.error('Watcher error for', folderPath, err));
        console.log(`👀 Watching folder for new files: ${folderPath}`);
        return watcher;
    } catch (err) {
        console.error('Failed to watch folder', folderPath, err);
        return null;
    }
}

const INTERVAL_MS = 2 * 60 * 1000; // fallback scan interval
const timer = setInterval(() => {
    for (const fp of folderPaths) processFolder(fp);
}, INTERVAL_MS);

// Initial pass: schedule existing files or delete stale ones
(async () => {
    for (const fp of folderPaths) await processFolder(fp);
    // Start watchers
    for (const fp of folderPaths) watchFolder(fp);
})();

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    console.log('♻️ Cleanup worker is shutting down, performing final cleanup...');
    try { for (const fp of folderPaths) await processFolder(fp); } catch (e) { /* ignore */ }
    // cancel scheduled timeouts
    for (const t of scheduled.values()) {
        clearTimeout(t);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`🧹 Cleanup worker started. Watching ${folderPaths.join(', ')}; files will be removed ${FILE_TTL_MS/1000}s after creation.`);
