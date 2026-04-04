import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

async function testStreamMerge() {
    const testDir = path.join(process.cwd(), 'temp/test-merge');
    await fsp.mkdir(testDir, { recursive: true });

    const finalPath = path.join(testDir, 'final.txt');
    const assemblingPath = path.join(testDir, 'assembling.tmp');

    // Create dummy chunks
    const chunks = ['Hello ', 'World ', 'from ', 'Antigravity!'];
    const partPaths = [];
    for (let i = 0; i < chunks.length; i++) {
        const p = path.join(testDir, `part-${i}`);
        await fsp.writeFile(p, chunks[i]);
        partPaths.push(p);
    }

    console.log('Starting stream merge...');

    try {
        const writeStream = fs.createWriteStream(assemblingPath);
        for (const partPath of partPaths) {
            const readStream = fs.createReadStream(partPath);
            await new Promise((resolve, reject) => {
                readStream.pipe(writeStream, { end: false });
                readStream.on('end', resolve);
                readStream.on('error', reject);
            });
            // Simulate cleanup as in original code
            await fsp.rm(partPath, { force: true });
        }
        writeStream.end();
        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        await fsp.rename(assemblingPath, finalPath);

        const result = await fsp.readFile(finalPath, 'utf8');
        console.log('Result content:', result);

        if (result === chunks.join('')) {
            console.log('✅ Stream merge test PASSED');
        } else {
            console.error('❌ Stream merge test FAILED: content mismatch');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Stream merge test FAILED with error:', error);
        process.exit(1);
    } finally {
        // Cleanup
        await fsp.rm(testDir, { recursive: true, force: true }).catch(() => { });
    }
}

testStreamMerge();
