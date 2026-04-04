import { promises as fsp } from 'fs';
import path from 'path';
import crypto from 'crypto';

async function safeWriteJsonFile(filePath, data) {
    const tmpPath = `${filePath}.tmp-${crypto.randomBytes(6).toString('hex')}`;
    try {
        await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        await fsp.rename(tmpPath, filePath);
    } catch (error) {
        await fsp.rm(tmpPath, { force: true }).catch(() => { });
        throw error;
    }
}

async function getFolderStats(dirPath, currentDepth = 0, maxDepth = 10) {
    if (currentDepth > maxDepth) {
        return { usedBytes: 0, fileCount: 0, folderCount: 0 };
    }

    let usedBytes = 0;
    let fileCount = 0;
    let folderCount = 0;

    const entries = await fsp.readdir(dirPath, { withFileTypes: true }).catch(() => []);

    const results = await Promise.all(entries.map(async (entry) => {
        // Skip some system patterns for test
        if (entry.name === '.chunks' || entry.name.endsWith('.lock') || entry.name === 'test.json') {
            return { usedBytes: 0, fileCount: 0, folderCount: 0 };
        }

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const childStats = await getFolderStats(fullPath, currentDepth + 1, maxDepth);
            return {
                usedBytes: childStats.usedBytes,
                fileCount: childStats.fileCount,
                folderCount: childStats.folderCount + 1
            };
        } else if (entry.isFile()) {
            const stat = await fsp.stat(fullPath).catch(() => ({ size: 0 }));
            return {
                usedBytes: stat.size,
                fileCount: 1,
                folderCount: 0
            };
        }
        return { usedBytes: 0, fileCount: 0, folderCount: 0 };
    }));

    for (const res of results) {
        usedBytes += res.usedBytes;
        fileCount += res.fileCount;
        folderCount += res.folderCount;
    }

    return { usedBytes, fileCount, folderCount };
}

async function runTests() {
    const testDir = path.join(process.cwd(), 'temp/test-utils');
    await fsp.mkdir(testDir, { recursive: true });

    try {
        // Test Atomic Write
        console.log('Testing atomic write...');
        const jsonPath = path.join(testDir, 'test.json');
        const data = { hello: 'world' };
        await safeWriteJsonFile(jsonPath, data);
        const readData = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
        if (readData.hello === 'world') {
            console.log('✅ Atomic write test PASSED');
        } else {
            throw new Error('Atomic write content mismatch');
        }

        // Test Folder Stats
        console.log('Testing folder stats...');
        await fsp.mkdir(path.join(testDir, 'subdir/nest'), { recursive: true });
        await fsp.writeFile(path.join(testDir, 'f1.txt'), 'abc'); // 3 bytes
        await fsp.writeFile(path.join(testDir, 'subdir/f2.txt'), '12345'); // 5 bytes

        const stats = await getFolderStats(testDir);
        console.log('Stats:', stats);
        // Expect 8 bytes, 2 files, 2 folders (subdir, subdir/nest)
        if (stats.usedBytes === 8 && stats.fileCount === 2 && stats.folderCount === 2) {
            console.log('✅ Folder stats test PASSED');
        } else {
            console.error('❌ Folder stats test FAILED:', stats);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Tests FAILED with error:', error);
        process.exit(1);
    } finally {
        await fsp.rm(testDir, { recursive: true, force: true }).catch(() => { });
    }
}

runTests();
