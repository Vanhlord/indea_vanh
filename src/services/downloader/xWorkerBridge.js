import { spawn, spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKER_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'python', 'x_worker.py');
const WORKER_TIMEOUT_MS = 150000;

let workerProcess = null;
let nextRequestId = 1;
let stdoutBuffer = '';
const pendingRequests = new Map();

function buildPythonCandidates() {
    const explicit = String(process.env.PYTHON_BIN || '').trim();
    const candidates = [];

    if (explicit) {
        candidates.push({ command: explicit, args: ['-u'] });
    }

    candidates.push(
        { command: 'python', args: ['-u'] },
        { command: 'py', args: ['-3', '-u'] },
        { command: 'python3', args: ['-u'] }
    );

    return candidates;
}

function rejectAllPending(error) {
    for (const { reject, timer } of pendingRequests.values()) {
        if (timer) clearTimeout(timer);
        reject(error);
    }
    pendingRequests.clear();
}

function handleWorkerLine(rawLine) {
    const line = String(rawLine || '').trim();
    if (!line) return;

    let payload;
    try {
        payload = JSON.parse(line);
    } catch (error) {
        console.warn('[XWorkerBridge] Non-JSON worker output:', line);
        return;
    }

    if (!payload || typeof payload !== 'object') return;
    const requestId = String(payload.id || '').trim();
    if (!requestId || !pendingRequests.has(requestId)) return;

    const pending = pendingRequests.get(requestId);
    pendingRequests.delete(requestId);
    if (pending.timer) clearTimeout(pending.timer);

    if (payload.ok) {
        pending.resolve(payload.data);
    } else {
        pending.reject(new Error(payload.error || 'X worker error'));
    }
}

function ensureWorkerProcess() {
    if (workerProcess && !workerProcess.killed) {
        return workerProcess;
    }

    if (!path.isAbsolute(WORKER_SCRIPT)) {
        throw new Error('X worker script path is invalid.');
    }

    const candidates = buildPythonCandidates();
    let lastError = null;

    for (const candidate of candidates) {
        try {
            const probe = spawnSync(candidate.command, ['--version'], {
                stdio: 'ignore',
                windowsHide: true
            });
            if (probe.error || probe.status !== 0) {
                lastError = probe.error || new Error(`Python candidate unavailable: ${candidate.command}`);
                continue;
            }

            const proc = spawn(candidate.command, [...candidate.args, WORKER_SCRIPT], {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            });

            workerProcess = proc;
            stdoutBuffer = '';

            proc.stdout.setEncoding('utf8');
            proc.stdout.on('data', (chunk) => {
                stdoutBuffer += String(chunk || '');
                let newlineIndex = stdoutBuffer.indexOf('\n');
                while (newlineIndex >= 0) {
                    const line = stdoutBuffer.slice(0, newlineIndex);
                    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                    handleWorkerLine(line);
                    newlineIndex = stdoutBuffer.indexOf('\n');
                }
            });

            proc.stderr.setEncoding('utf8');
            proc.stderr.on('data', (chunk) => {
                const message = String(chunk || '').trim();
                if (message) {
                    console.log(`[XWorker] ${message}`);
                }
            });

            proc.on('error', (error) => {
                console.error('[XWorkerBridge] Worker process error:', error.message);
                workerProcess = null;
                rejectAllPending(error);
            });

            proc.on('exit', (code, signal) => {
                const error = new Error(`X worker exited (code=${code}, signal=${signal})`);
                workerProcess = null;
                stdoutBuffer = '';
                rejectAllPending(error);
            });

            return proc;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Không thể khởi động Python worker cho X.');
}

async function sendWorkerJob(payload, timeoutMs = WORKER_TIMEOUT_MS) {
    const proc = ensureWorkerProcess();
    if (!proc?.stdin || proc.stdin.destroyed) {
        throw new Error('X worker không khả dụng.');
    }

    const requestId = String(nextRequestId++);
    const message = JSON.stringify({ id: requestId, ...payload });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error('X worker timeout.'));
        }, timeoutMs);

        pendingRequests.set(requestId, { resolve, reject, timer });

        proc.stdin.write(`${message}\n`, (error) => {
            if (error) {
                clearTimeout(timer);
                pendingRequests.delete(requestId);
                reject(error);
            }
        });
    });
}

export async function runXWorkerInfoJob(url) {
    return sendWorkerJob({
        type: 'info',
        url
    }, 60000);
}

export async function runXWorkerDownloadJob(url, outputPath, fileName) {
    return sendWorkerJob({
        type: 'download',
        url,
        outputPath,
        fileName
    }, WORKER_TIMEOUT_MS);
}

export function isXWorkerAlive() {
    return Boolean(workerProcess && !workerProcess.killed);
}

export function warmXWorker() {
    return ensureWorkerProcess();
}
