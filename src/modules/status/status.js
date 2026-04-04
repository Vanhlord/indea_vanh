import express from 'express';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';

const router = express.Router();
const execPromise = util.promisify(exec);

// Socket.IO instance (will be set from main server)
let io;
const networkHistory = [];
const MAX_NET_POINTS = 60;

export function setSocketIO(socketIO) {
    io = socketIO;
}

export function getNetworkHistory() {
    return networkHistory;
}

// --- 1. KHO LƯU TRỮ DỮ LIỆU ---
const cpuHistory = Array(60).fill(0);
const ramHistory = Array(60).fill(0);
let currentProcesses = [];
let ramUsedMb = 0;
let ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
let ramPercent = 0;

/**
 * Hàm hỗ trợ lấy thông số CPU hệ thống
 */
function getCPUUsage() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
        user += cpu.times.user;
        nice += cpu.times.nice;
        sys += cpu.times.sys;
        idle += cpu.times.idle;
        irq += cpu.times.irq;
    }
    const total = user + nice + sys + idle + irq;
    return { idle, total };
}

let startMeasure = getCPUUsage();

function refreshRamSnapshot() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    ramUsedMb = Math.round(usedMem / (1024 * 1024));
    ramTotalMb = Math.round(totalMem / (1024 * 1024));
    ramPercent = totalMem > 0 ? Math.floor((usedMem / totalMem) * 100) : 0;
}

// Prime RAM stats
refreshRamSnapshot();

// --- 2. LUỒNG CẬP NHẬT BIỂU ĐỒ (2 GIÂY/LẦN) ---
setInterval(() => {
    const endMeasure = getCPUUsage();
    const idleDiff = endMeasure.idle - startMeasure.idle;
    const totalDiff = endMeasure.total - startMeasure.total;
    
    const cpuTotal = totalDiff > 0 ? (100 - Math.floor(100 * idleDiff / totalDiff)) : 0;
    startMeasure = endMeasure;

    refreshRamSnapshot();

    cpuHistory.push(cpuTotal);
    ramHistory.push(ramPercent);
    if (cpuHistory.length > 60) cpuHistory.shift();
    if (ramHistory.length > 60) ramHistory.shift();

    if (io) {
        io.emit('statsUpdate', {
            cpu: cpuHistory[cpuHistory.length - 1],
            ramPercent,
            ramMb: ramUsedMb,
            maxRamMb: ramTotalMb,
            history: { cpu: cpuHistory, ram: ramHistory },
            processes: currentProcesses,
            network: networkHistory.length > 0 ? networkHistory[networkHistory.length - 1] : null
        });
    }
}, 2000);

// --- 2.1 LUỒNG ĐO MẠNG NGẦM (Server-side - 3 GIÂY/LẦN) ---
async function measureNetworkFromServer() {
    const start = Date.now();
    try {
        // Thực hiện đo ping từ server
        await fetch('https://www.google.com/generate_204', { method: 'HEAD' });
        const ping = Date.now() - start;
        const time = new Date().toLocaleTimeString('vi-VN');
        const speed = parseFloat((Math.random() * 20 + 30).toFixed(1)); // Simulated speed logic
        
        const data = { time, ping, speed };
        networkHistory.push(data);
        if (networkHistory.length > MAX_NET_POINTS) networkHistory.shift();
    } catch (e) {
        // console.error("Network measure error:", e.message);
    }
}
setInterval(measureNetworkFromServer, 3000);
measureNetworkFromServer();

// --- 3. LUỒNG CẬP NHẬT TIẾN TRÌNH ---
async function updateProcessList() {
    try {
        const cmd = 'powershell -Command "$cores = (Get-WmiObject Win32_Processor).NumberOfCores; Get-Process | Where-Object { $_.CPU -gt 0 } | Sort-Object CPU -Descending | Select-Object -First 5 | Select-Object Name, @{Name=\'CPU\';Expression={[Math]::Round($_.CPU / $cores / 100, 1)}}, @{Name=\'RAM\';Expression={[Math]::Round($_.WorkingSet / 1MB, 1)}} | ConvertTo-Json"';
        const { stdout } = await execPromise(cmd);
        if (stdout && stdout.trim() !== '') {
            const rawData = JSON.parse(stdout);
            const procs = Array.isArray(rawData) ? rawData : [rawData];
            currentProcesses = procs.map(p => ({
                name: p.Name || 'Unknown',
                cpu: p.CPU || 0,
                ram: p.RAM || 0
            }));
        }
    } catch (_error) {
        // Ignore process list errors; this is best-effort telemetry.
    }
    setTimeout(updateProcessList, 5000);
}
updateProcessList();

// --- 4. API ENDPOINT ---
router.get('/stats', (req, res) => {
    res.json({
        cpu: cpuHistory[cpuHistory.length - 1],
        ramPercent,
        ramMb: ramUsedMb,
        maxRamMb: ramTotalMb,
        history: { cpu: cpuHistory, ram: ramHistory },
        processes: currentProcesses,
        networkHistory: networkHistory
    });
});

export default router;
