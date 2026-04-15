import express from 'express';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';
import si from 'systeminformation';

const router = express.Router();
const execPromise = util.promisify(exec);

// Socket.IO instance (will be set from main server)
let io;
const networkLog = [];
const MAX_POINTS = 60;

// History stores for charts
const cpuHistory = Array(MAX_POINTS).fill(0);
const ramHistory = Array(MAX_POINTS).fill(0);
const pingHistory = Array(MAX_POINTS).fill(0);
const speedHistory = Array(MAX_POINTS).fill(0);

export function setSocketIO(socketIO) {
    io = socketIO;
}

export function getNetworkHistory() {
    return networkLog;
}

// --- 1. KHO LƯU TRỮ DỮ LIỆU ---
let currentProcesses = [];
let ramUsedMb = 0;
let ramTotalMb = Math.round(os.totalmem() / (1024 * 1024));
let ramPercent = 0;

let diskInfo = { used: 0, total: 1, percent: 0 };
let staticInfo = { hostname: os.hostname(), platform: os.platform(), cpuModel: '' };

// Fetch static info once
(async () => {
    try {
        const cpu = await si.cpu();
        const osData = await si.osInfo();
        staticInfo.cpuModel = cpu.brand;
        staticInfo.hostname = osData.hostname;
        staticInfo.platform = `${osData.distro} ${osData.release}`;
    } catch (e) {}
})();

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

async function refreshDiskSnapshot() {
    try {
        const fsSize = await si.fsSize();
        const mainFs = fsSize.find(f => f.mount === '/' || f.mount === 'C:') || fsSize[0];
        if (mainFs) {
            diskInfo = {
                used: (mainFs.used / (1024 ** 3)).toFixed(1),
                total: (mainFs.size / (1024 ** 3)).toFixed(1),
                percent: Math.round(mainFs.use)
            };
        }
    } catch (e) {}
}

// Stats Loop
setInterval(async () => {
    const endMeasure = getCPUUsage();
    const idleDiff = endMeasure.idle - startMeasure.idle;
    const totalDiff = endMeasure.total - startMeasure.total;
    const cpuTotal = totalDiff > 0 ? (100 - Math.floor(100 * idleDiff / totalDiff)) : 0;
    startMeasure = endMeasure;

    refreshRamSnapshot();
    await refreshDiskSnapshot();

    cpuHistory.push(cpuTotal);
    ramHistory.push(ramPercent);
    if (cpuHistory.length > MAX_POINTS) cpuHistory.shift();
    if (ramHistory.length > MAX_POINTS) ramHistory.shift();

    if (io) {
        io.emit('statsUpdate', {
            cpu: cpuHistory[cpuHistory.length - 1],
            ramPercent,
            ramMb: ramUsedMb,
            maxRamMb: ramTotalMb,
            disk: diskInfo,
            uptime: { system: Math.floor(os.uptime()), process: Math.floor(process.uptime()) },
            system: staticInfo,
            history: { 
                cpu: cpuHistory, 
                ram: ramHistory,
                ping: pingHistory,
                speed: speedHistory
            },
            processes: currentProcesses,
            network: networkLog.length > 0 ? networkLog[networkLog.length - 1] : null
        });
    }
}, 2000);

// Network Measure Loop
async function measureNetworkFromServer() {
    const start = Date.now();
    try {
        await fetch('https://www.google.com/generate_204', { method: 'HEAD' });
        const ping = Date.now() - start;
        const time = new Date().toLocaleTimeString('vi-VN');
        const speed = parseFloat((Math.random() * 15 + 10).toFixed(1)); // "Upload" speed sim
        
        const data = { time, ping, speed };
        networkLog.push(data);
        if (networkLog.length > MAX_POINTS) networkLog.shift();

        // Update history arrays for persistence on reload
        pingHistory.push(ping);
        speedHistory.push(speed);
        if (pingHistory.length > MAX_POINTS) pingHistory.shift();
        if (speedHistory.length > MAX_POINTS) speedHistory.shift();

    } catch (e) {}
}
setInterval(measureNetworkFromServer, 3000);
measureNetworkFromServer();

// Process List Update
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
        try {
            const list = await si.processes();
            currentProcesses = list.list.slice(0, 5).map(p => ({
                name: p.name,
                cpu: p.cpu,
                ram: Math.round(p.mem / 1024)
            }));
        } catch(e) {}
    }
    setTimeout(updateProcessList, 5000);
}
updateProcessList();

// API
router.get('/stats', (req, res) => {
    res.json({
        cpu: cpuHistory[cpuHistory.length - 1],
        ramPercent, ramMb: ramUsedMb, maxRamMb: ramTotalMb,
        disk: diskInfo,
        system: staticInfo,
        history: { 
            cpu: cpuHistory, 
            ram: ramHistory,
            ping: pingHistory,
            speed: speedHistory
        },
        processes: currentProcesses,
        networkHistory: networkLog
    });
});

export default router;
