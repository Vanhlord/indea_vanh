import { access } from 'fs/promises';
import { readFile } from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const REQUIRED_FILES = [
    'server.js',
    'src/routes/downloaderRoutes.js',
    'src/modules/auth/oauth.js',
    'src/services/downloader/DownloaderService.js'
];

async function assertFileExists(relativePath) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    await access(absolutePath);
}

async function runSyntaxCheck(relativePath) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    const check = spawnSync(process.execPath, ['--check', absolutePath], {
        encoding: 'utf8'
    });

    if (check.error && ['EPERM', 'EACCES'].includes(check.error.code)) {
        await runSyntaxCheckInProcess(relativePath, absolutePath);
        return;
    }

    if (check.status !== 0) {
        const details = (check.stderr || check.stdout || '').trim();
        throw new Error(`Syntax check failed for ${relativePath}\n${details}`);
    }
}

async function runSyntaxCheckInProcess(relativePath, absolutePath) {
    let espree;
    try {
        espree = await import('espree');
    } catch (error) {
        throw new Error(
            `Syntax check failed for ${relativePath}\n` +
            `Unable to spawn node for --check (${process.execPath}) and failed to load espree: ${error.message}`
        );
    }

    const code = await readFile(absolutePath, 'utf8');
    try {
        espree.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module'
        });
    } catch (error) {
        throw new Error(`Syntax check failed for ${relativePath}\n${error.message}`);
    }
}

export async function runSmokeTest() {
    for (const file of REQUIRED_FILES) {
        await assertFileExists(file);
        await runSyntaxCheck(file);
    }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
    try {
        await runSmokeTest();
        console.log('Smoke test passed');
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
