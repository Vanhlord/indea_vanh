import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import fs from 'fs-extra';
import crypto from 'crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import PrismarineRegistry from 'prismarine-registry';
import PrismarineChunk from 'prismarine-chunk';
import leveldbZlib from 'leveldb-zlib';
import bedrockProvider from 'bedrock-provider';
import databaseKeys from 'bedrock-provider/js/disk/databaseKeys.js';
import versionHelpers from 'bedrock-provider/js/versions.js';

const { LevelDB } = leveldbZlib;
const { WorldProvider } = bedrockProvider;
const { recurseMinecraftKeys, KeyBuilder } = databaseKeys;
const { getHandlingForChunkVersion } = versionHelpers;

const TMP_ROOT = path.join(os.tmpdir(), 'mcnote-bedrock-world-viewer');
const DEFAULT_REGISTRY_VERSION = 'bedrock_1.20.40';
const RENDER_JOB_TTL_MS = 15 * 60 * 1000;
const PENDING_RGBA = [8, 17, 32, 255];

const BLOCK_ALIAS_OVERRIDES = {
    granite: 'stone',
    polished_granite: 'stone',
    diorite: 'stone',
    polished_diorite: 'stone',
    andesite: 'stone',
    polished_andesite: 'stone',
    grass_block: 'grass',
    short_grass: 'grass',
    tall_grass: 'grass',
    fern: 'grass',
    large_fern: 'grass',
    red_sand: 'sand',
    coarse_dirt: 'dirt',
    rooted_dirt: 'dirt',
    dirt_path: 'dirt'
};

const SKIP_BLOCKS = new Set([
    'air',
    'cave_air',
    'void_air',
    'structure_void'
]);

const blockFallbackWarnings = new Set();
const chunkDecodeWarnings = new Set();
const renderJobs = new Map();
const renderJobCleanupTimers = new Map();

function randomId(prefix = 'world') {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeRelativePath(value) {
    const clean = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!clean) return '';

    const parts = clean.split('/').filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..')) {
        throw new Error('Đường dẫn upload không hợp lệ.');
    }

    return parts.join('/');
}

async function ensureDir(dirPath) {
    await fsp.mkdir(dirPath, { recursive: true });
    return dirPath;
}

async function safeUnlink(filePath) {
    try {
        await fsp.unlink(filePath);
    } catch (_error) {
        // Ignore cleanup errors.
    }
}

async function cleanupJobDir(jobDir) {
    try {
        await fs.remove(jobDir);
    } catch (_error) {
        // Ignore cleanup errors.
    }
}

async function createJobDir() {
    await ensureDir(TMP_ROOT);
    const dir = path.join(TMP_ROOT, randomId());
    await ensureDir(dir);
    return dir;
}

function scheduleRenderJobCleanup(jobId) {
    const existing = renderJobCleanupTimers.get(jobId);
    if (existing) {
        clearTimeout(existing);
    }

    const timer = setTimeout(() => {
        renderJobs.delete(jobId);
        renderJobCleanupTimers.delete(jobId);
    }, RENDER_JOB_TTL_MS);

    if (typeof timer.unref === 'function') {
        timer.unref();
    }

    renderJobCleanupTimers.set(jobId, timer);
}

function serializeRenderJob(job) {
    if (!job) return null;

    return {
        id: job.id,
        status: job.status,
        phase: job.phase,
        progress: job.progress,
        progressLabel: job.progressLabel,
        message: job.message,
        error: job.error || null,
        worldName: job.worldName || '',
        mode: job.mode || 'folder',
        rootName: job.rootName || '',
        width: job.width || 0,
        height: job.height || 0,
        sampleStep: job.sampleStep || 0,
        chunkCount: job.chunkCount || 0,
        processedChunks: job.processedChunks || 0,
        bounds: job.bounds || null,
        lastChunk: job.lastChunk || null,
        imageDataUrl: job.imageDataUrl || '',
        imageRevision: job.imageRevision || 0,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
    };
}

function updateRenderJob(job, patch) {
    Object.assign(job, patch, {
        updatedAt: new Date().toISOString()
    });
    scheduleRenderJobCleanup(job.id);
    return serializeRenderJob(job);
}

async function rebuildWorldFolder(files, relativePaths, targetRoot) {
    await ensureDir(targetRoot);

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const rawRelativePath = Array.isArray(relativePaths) ? relativePaths[index] : relativePaths;
        const relativePath = normalizeRelativePath(rawRelativePath || file.originalname || file.filename);
        if (!relativePath) continue;

        const destination = path.join(targetRoot, relativePath);
        await ensureDir(path.dirname(destination));
        await fs.move(file.path, destination, { overwrite: true });
    }
}

async function extractArchiveToDir(archivePath, targetRoot) {
    await ensureDir(targetRoot);
    const archiveBuffer = await fsp.readFile(archivePath);
    const zip = await JSZip.loadAsync(archiveBuffer);
    const entries = Object.values(zip.files);

    for (const entry of entries) {
        const relativePath = normalizeRelativePath(entry.name);
        if (!relativePath) continue;

        const destination = path.join(targetRoot, relativePath);
        if (entry.dir) {
            await ensureDir(destination);
            continue;
        }

        await ensureDir(path.dirname(destination));
        const content = await entry.async('nodebuffer');
        await fsp.writeFile(destination, content);
    }
}

async function findWorldRoot(baseDir, depth = 0, maxDepth = 4) {
    const entries = await fsp.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    const names = entries.map((entry) => entry.name.toLowerCase());
    const hasDb = entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'db');
    const hasLevelDat = names.includes('level.dat');
    const hasLevelName = names.includes('levelname.txt');

    if (hasDb || hasLevelDat || hasLevelName) {
        return baseDir;
    }

    if (depth >= maxDepth) return null;

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const found = await findWorldRoot(path.join(baseDir, entry.name), depth + 1, maxDepth);
        if (found) return found;
    }

    return null;
}

async function readOptionalText(filePath) {
    try {
        return (await fsp.readFile(filePath, 'utf8')).trim();
    } catch (_error) {
        return '';
    }
}

function makeWorldProvider(db) {
    const registry = PrismarineRegistry(DEFAULT_REGISTRY_VERSION);
    const world = new WorldProvider(db, { dimension: 0, registry });
    const chunk18 = PrismarineChunk({ version: { type: 'bedrock', majorVersion: '1.18' }, blockRegistry: registry });
    world.Chunks['1.19'] = chunk18;
    patchWorldProviderFallbacks(world, registry);
    return { world, registry };
}

function keyForChunk(x, z) {
    return `${x},${z}`;
}

function blockToColor(blockName, y = 64) {
    const name = String(blockName || 'air').toLowerCase();

    let rgb = [116, 184, 99];
    if (name.includes('water')) rgb = [44, 116, 220];
    else if (name.includes('lava')) rgb = [255, 107, 53];
    else if (name.includes('snow') || name.includes('ice')) rgb = [230, 240, 255];
    else if (name.includes('sand') || name.includes('sandstone')) rgb = [232, 204, 125];
    else if (name.includes('red_sand')) rgb = [208, 128, 83];
    else if (name.includes('gravel')) rgb = [138, 146, 151];
    else if (name.includes('stone') || name.includes('deepslate') || name.includes('ore')) rgb = [114, 125, 138];
    else if (name.includes('dirt') || name.includes('mud') || name.includes('farmland')) rgb = [123, 92, 62];
    else if (name.includes('grass')) rgb = [98, 180, 86];
    else if (name.includes('moss')) rgb = [79, 151, 78];
    else if (name.includes('leaf') || name.includes('azalea')) rgb = [48, 133, 71];
    else if (name.includes('log') || name.includes('wood') || name.includes('planks')) rgb = [133, 97, 57];
    else if (name.includes('clay')) rgb = [142, 158, 177];
    else if (name.includes('mycelium')) rgb = [120, 92, 126];
    else if (name.includes('netherrack') || name.includes('nether')) rgb = [128, 50, 50];
    else if (name.includes('glass')) rgb = [179, 224, 235];

    const lift = Math.max(-25, Math.min(28, Math.round((y - 64) * 0.25)));
    return rgb.map((value) => Math.max(0, Math.min(255, value + lift)));
}

function getHeightValue(heights, x, z) {
    if (!heights || typeof heights.length !== 'number') return null;
    const idx = (z << 4) + x;
    const value = Number(heights[idx]);
    return Number.isFinite(value) ? value : null;
}

function positiveMod(value, mod) {
    const result = value % mod;
    return result < 0 ? result + mod : result;
}

function warnOnce(bucket, key, message) {
    if (bucket.has(key)) return;
    bucket.add(key);
    console.warn(message);
}

function resolveFallbackBlockName(registry, rawName) {
    const name = String(rawName || '').replace(/^minecraft:/, '').toLowerCase();
    if (!name) return 'air';
    if (registry.blocksByName[name]) return name;

    const exactOverride = BLOCK_ALIAS_OVERRIDES[name];
    if (exactOverride && registry.blocksByName[exactOverride]) {
        return exactOverride;
    }

    const heuristics = [
        { pattern: /water/, target: 'water' },
        { pattern: /lava/, target: 'lava' },
        { pattern: /snow|ice/, target: 'snow' },
        { pattern: /sandstone/, target: 'sandstone' },
        { pattern: /sand/, target: 'sand' },
        { pattern: /gravel/, target: 'gravel' },
        { pattern: /granite|diorite|andesite|stone|calcite|tuff|basalt/, target: 'stone' },
        { pattern: /deepslate/, target: 'deepslate' },
        { pattern: /dirt|mud|podzol|mycelium|farmland|path/, target: 'dirt' },
        { pattern: /grass|fern|crop|flower|vine/, target: 'grass' },
        { pattern: /moss/, target: 'moss_block' },
        { pattern: /leaf|leaves|azalea/, target: 'leaves' },
        { pattern: /log|wood|planks|hyphae|stem/, target: 'oak_log' },
        { pattern: /clay/, target: 'clay' },
        { pattern: /glass/, target: 'glass' },
        { pattern: /netherrack|nether/, target: 'netherrack' },
        { pattern: /ore/, target: 'stone' }
    ];

    const match = heuristics.find(({ pattern, target }) => pattern.test(name) && registry.blocksByName[target]);
    return match?.target || 'air';
}

function patchBlockFactory(Block, registry) {
    if (!Block || Block.__mcnoteFallbackPatched) return;

    const originalFromProperties = Block.fromProperties.bind(Block);
    Block.fromProperties = function patchedFromProperties(typeId, properties, biomeId) {
        const rawName = String(typeId || '').replace(/^minecraft:/, '').toLowerCase();

        try {
            const block = originalFromProperties(rawName, properties, biomeId);
            if (block && Number.isFinite(block.stateId)) {
                return block;
            }
        } catch (_error) {
            // Try fallback aliases below.
        }

        const fallbackName = resolveFallbackBlockName(registry, rawName);
        warnOnce(
            blockFallbackWarnings,
            `${rawName}->${fallbackName}`,
            `Bedrock block fallback: "${rawName}" -> "${fallbackName}"`
        );

        try {
            const block = originalFromProperties(fallbackName, properties, biomeId);
            if (block && Number.isFinite(block.stateId)) {
                return block;
            }
        } catch (_error) {
            // Try again with empty properties.
        }

        try {
            const block = originalFromProperties(fallbackName, {}, biomeId);
            if (block && Number.isFinite(block.stateId)) {
                return block;
            }
        } catch (_error) {
            // Fall through to default state.
        }

        const fallbackDescriptor = registry.blocksByName[fallbackName] || registry.blocksByName.air;
        return Block.fromStateId(fallbackDescriptor.defaultState, biomeId);
    };

    Block.__mcnoteFallbackPatched = true;
}

function patchWorldProviderFallbacks(world, registry) {
    if (!world || world.__mcnoteReadSubChunksPatched) return;

    world.readSubChunks = async function patchedReadSubChunks(chunkVersion, x, z) {
        const ChunkColumn = this.Chunks[getHandlingForChunkVersion(chunkVersion)];
        if (!ChunkColumn) return null;

        const column = new ChunkColumn({ x, z, chunkVersion });
        patchBlockFactory(column.Block, registry);

        if (this.dimension !== 0) {
            column.minCY = 0;
            column.maxCY = 16;
        }

        for (let y = column.minCY; y < column.maxCY; y += 1) {
            const chunk = await this.get(KeyBuilder.buildChunkKey(x, y, z, this.dimension));
            if (!chunk) break;

            try {
                column.newSection(y, 0, chunk);
            } catch (error) {
                warnOnce(
                    chunkDecodeWarnings,
                    `${x},${y},${z}:${error?.message || 'decode-error'}`,
                    `Skipping failed Bedrock subchunk ${x},${y},${z}: ${error?.message || 'decode error'}`
                );
            }
        }

        return column;
    };

    world.__mcnoteReadSubChunksPatched = true;
}

async function loadRenderableChunk(world, x, z) {
    try {
        const chunkVersion = await world.getChunkVersion(x, z);
        if (chunkVersion == null) return null;

        const column = await world.readSubChunks(chunkVersion, x, z);
        if (!column) return null;

        const data = await world.readBiomesAndElevation(chunkVersion, x, z);
        if (data?.heightmap && typeof column.loadHeights === 'function') {
            const heightData = new Uint16Array(data.heightmap.buffer, data.heightmap.byteOffset, data.heightmap.byteLength / 2);
            column.loadHeights(heightData);
        }

        return {
            column,
            heights: typeof column.getHeights === 'function' ? column.getHeights() : null
        };
    } catch (error) {
        warnOnce(
            chunkDecodeWarnings,
            `${x},${z}:chunk-load`,
            `Skipping failed Bedrock chunk ${x},${z}: ${error?.message || 'load error'}`
        );
        return null;
    }
}

function pickTopBlockInfo(chunkInfo, localX, localZ) {
    if (!chunkInfo?.column) {
        return { name: 'air', y: 0 };
    }

    const { column, heights } = chunkInfo;
    const minY = Number.isFinite(column.minY) ? column.minY : 0;
    const maxY = Number.isFinite(column.maxY) ? column.maxY : 256;
    const hinted = getHeightValue(heights, localX, localZ);
    const startY = hinted != null ? Math.min(maxY - 1, hinted + 6) : (maxY - 1);

    for (let y = startY; y >= minY; y -= 1) {
        const block = column.getBlock({ x: localX, y, z: localZ, l: 0 }, false);
        const name = String(block?.name || 'air').toLowerCase();
        if (SKIP_BLOCKS.has(name)) continue;
        return { name, y };
    }

    return { name: 'air', y: minY };
}

async function collectChunkCoordinates(db) {
    const entries = await recurseMinecraftKeys(db);
    const coords = new Map();

    for (const entry of entries) {
        if (entry?.dim !== 0) continue;
        if (entry?.type !== 'version' && entry?.type !== 'versionOld' && entry?.type !== 'chunk') continue;
        if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.z)) continue;
        coords.set(keyForChunk(entry.x, entry.z), { x: entry.x, z: entry.z });
    }

    return Array.from(coords.values()).sort((a, b) => (a.z - b.z) || (a.x - b.x));
}

function createPendingImageBuffer(width, height) {
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = PENDING_RGBA[0];
        rgba[i + 1] = PENDING_RGBA[1];
        rgba[i + 2] = PENDING_RGBA[2];
        rgba[i + 3] = PENDING_RGBA[3];
    }
    return rgba;
}

async function createImageDataUrl(rgba, width, height) {
    const pngBuffer = await sharp(rgba, {
        raw: {
            width,
            height,
            channels: 4
        }
    }).png().toBuffer();

    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

function fillChunkPixels({
    rgba,
    width,
    minChunkX,
    minChunkZ,
    sampleStep,
    chunkX,
    chunkZ,
    chunkInfo
}) {
    const minWorldBlockX = minChunkX * 16;
    const minWorldBlockZ = minChunkZ * 16;
    const chunkStartWorldX = chunkX * 16;
    const chunkStartWorldZ = chunkZ * 16;
    const chunkEndWorldX = chunkStartWorldX + 16;
    const chunkEndWorldZ = chunkStartWorldZ + 16;
    const startPx = Math.max(0, Math.floor((chunkStartWorldX - minWorldBlockX) / sampleStep));
    const endPx = Math.max(startPx, Math.ceil((chunkEndWorldX - minWorldBlockX) / sampleStep));
    const startPy = Math.max(0, Math.floor((chunkStartWorldZ - minWorldBlockZ) / sampleStep));
    const endPy = Math.max(startPy, Math.ceil((chunkEndWorldZ - minWorldBlockZ) / sampleStep));

    for (let py = startPy; py < endPy; py += 1) {
        const worldBlockZ = minWorldBlockZ + (py * sampleStep);
        if (worldBlockZ < chunkStartWorldZ || worldBlockZ >= chunkEndWorldZ) continue;
        const localZ = positiveMod(worldBlockZ, 16);

        for (let px = startPx; px < endPx; px += 1) {
            const worldBlockX = minWorldBlockX + (px * sampleStep);
            if (worldBlockX < chunkStartWorldX || worldBlockX >= chunkEndWorldX) continue;
            const localX = positiveMod(worldBlockX, 16);
            const { name, y } = pickTopBlockInfo(chunkInfo, localX, localZ);
            const [r, g, b] = blockToColor(name, y);
            const idx = (py * width + px) * 4;
            rgba[idx] = r;
            rgba[idx + 1] = g;
            rgba[idx + 2] = b;
            rgba[idx + 3] = 255;
        }
    }
}

async function renderWorldMapProgressive(worldRoot, onProgress = async () => {}) {
    const dbPath = path.join(worldRoot, 'db');
    const dbExists = await fs.pathExists(dbPath);
    if (!dbExists) {
        throw new Error('World này chưa có thư mục db/ để đọc dữ liệu Bedrock.');
    }

    const db = new LevelDB(dbPath, { createIfMissing: false });
    await db.open();

    try {
        const chunkCoords = await collectChunkCoordinates(db);
        if (chunkCoords.length === 0) {
            throw new Error('Không tìm thấy chunk nào trong db/.');
        }

        const { world } = makeWorldProvider(db);
        const xs = chunkCoords.map((item) => item.x);
        const zs = chunkCoords.map((item) => item.z);
        const minChunkX = Math.min(...xs);
        const maxChunkX = Math.max(...xs);
        const minChunkZ = Math.min(...zs);
        const maxChunkZ = Math.max(...zs);
        const blockWidth = ((maxChunkX - minChunkX) + 1) * 16;
        const blockHeight = ((maxChunkZ - minChunkZ) + 1) * 16;
        const sampleStep = 1;
        const width = Math.max(1, Math.ceil(blockWidth / sampleStep));
        const height = Math.max(1, Math.ceil(blockHeight / sampleStep));
        const rgba = createPendingImageBuffer(width, height);
        const snapshotEvery = Math.max(1, Math.ceil(chunkCoords.length / 72));
        const bounds = {
            minChunkX,
            maxChunkX,
            minChunkZ,
            maxChunkZ
        };

        await onProgress({
            phase: 'rendering',
            progress: 0.04,
            progressLabel: `0 / ${chunkCoords.length} chunk`,
            message: 'Đã đọc xong metadata world, bắt đầu tô map dần theo chunk.',
            width,
            height,
            sampleStep,
            chunkCount: chunkCoords.length,
            processedChunks: 0,
            bounds,
            lastChunk: null
        });

        for (let index = 0; index < chunkCoords.length; index += 1) {
            const { x: chunkX, z: chunkZ } = chunkCoords[index];
            const chunkInfo = await loadRenderableChunk(world, chunkX, chunkZ);
            if (chunkInfo) {
                fillChunkPixels({
                    rgba,
                    width,
                    minChunkX,
                    minChunkZ,
                    sampleStep,
                    chunkX,
                    chunkZ,
                    chunkInfo
                });
            }

            const processedChunks = index + 1;
            const shouldSnapshot = processedChunks <= 10
                || processedChunks === chunkCoords.length
                || (processedChunks % snapshotEvery) === 0;

            if (shouldSnapshot) {
                const imageDataUrl = await createImageDataUrl(rgba, width, height);
                await onProgress({
                    phase: 'rendering',
                    progress: processedChunks / chunkCoords.length,
                    progressLabel: `${processedChunks} / ${chunkCoords.length} chunk`,
                    message: `Đang tô dần map Bedrock: ${processedChunks}/${chunkCoords.length} chunk.`,
                    width,
                    height,
                    sampleStep,
                    chunkCount: chunkCoords.length,
                    processedChunks,
                    bounds,
                    lastChunk: {
                        x: chunkX,
                        z: chunkZ
                    },
                    imageDataUrl
                });
            }
        }

        const imageDataUrl = await createImageDataUrl(rgba, width, height);
        return {
            imageDataUrl,
            width,
            height,
            sampleStep,
            chunkCount: chunkCoords.length,
            processedChunks: chunkCoords.length,
            bounds,
            lastChunk: chunkCoords[chunkCoords.length - 1] || null
        };
    } finally {
        try {
            await db.close();
        } catch (_error) {
            // Ignore close errors.
        }
    }
}

async function prepareUploadedWorld({ files, relativePaths = [], mode = 'folder' }) {
    const jobDir = await createJobDir();
    const sourceDir = path.join(jobDir, 'source');

    try {
        if (mode === 'archive') {
            const archiveFile = files.find((file) => /\.(mcworld|zip)$/i.test(file.originalname || '')) || files[0];
            if (!archiveFile) {
                throw new Error('Không tìm thấy file .mcworld hoặc .zip hợp lệ.');
            }
            await extractArchiveToDir(archiveFile.path, sourceDir);
        } else {
            await rebuildWorldFolder(files, relativePaths, sourceDir);
        }

        const worldRoot = await findWorldRoot(sourceDir);
        if (!worldRoot) {
            throw new Error('Không xác định được thư mục world Bedrock hợp lệ sau khi nhận upload.');
        }

        return {
            jobDir,
            worldRoot,
            worldName: await readOptionalText(path.join(worldRoot, 'levelname.txt'))
        };
    } catch (error) {
        await cleanupJobDir(jobDir);
        throw error;
    }
}

async function runRenderJob(job, { files, relativePaths, mode }) {
    let jobDir = '';

    try {
        updateRenderJob(job, {
            status: 'running',
            phase: 'preparing',
            progress: 0.01,
            progressLabel: 'Chuẩn bị world',
            message: 'Đang dựng workspace upload cho Bedrock world...'
        });

        const prepared = await prepareUploadedWorld({ files, relativePaths, mode });
        jobDir = prepared.jobDir;
        const worldName = prepared.worldName || path.basename(prepared.worldRoot);

        updateRenderJob(job, {
            status: 'running',
            phase: 'preparing',
            progress: 0.03,
            progressLabel: 'Đã nhận world',
            message: 'World đã vào server, đang đọc db/ để lấy bounds và chunk.',
            worldName,
            rootName: path.basename(prepared.worldRoot)
        });

        const render = await renderWorldMapProgressive(prepared.worldRoot, async (progressPatch) => {
            const nextPatch = { ...progressPatch };
            if (progressPatch.imageDataUrl) {
                nextPatch.imageRevision = (job.imageRevision || 0) + 1;
            }
            updateRenderJob(job, nextPatch);
        });

        updateRenderJob(job, {
            status: 'completed',
            phase: 'completed',
            progress: 1,
            progressLabel: `${render.chunkCount} / ${render.chunkCount} chunk`,
            message: 'Render hoàn tất. Map 2D đã sẵn sàng.',
            ...render,
            imageRevision: (job.imageRevision || 0) + 1
        });
    } catch (error) {
        updateRenderJob(job, {
            status: 'failed',
            phase: 'failed',
            error: error?.message || 'Không thể render Bedrock world.',
            message: error?.message || 'Không thể render Bedrock world.'
        });
    } finally {
        await Promise.all((files || []).map((file) => safeUnlink(file.path)));
        if (jobDir) {
            await cleanupJobDir(jobDir);
        }
    }
}

export function getBedrockRenderJob(jobId) {
    return serializeRenderJob(renderJobs.get(jobId));
}

export async function startBedrockRenderJob({ files, relativePaths = [], mode = 'folder' }) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Không có file world nào được tải lên.');
    }

    const job = {
        id: randomId('bedrock-render'),
        status: 'queued',
        phase: 'queued',
        progress: 0,
        progressLabel: 'Đang xếp hàng',
        message: 'Job render vừa được tạo.',
        error: null,
        worldName: '',
        mode,
        rootName: '',
        width: 0,
        height: 0,
        sampleStep: 0,
        chunkCount: 0,
        processedChunks: 0,
        bounds: null,
        lastChunk: null,
        imageDataUrl: '',
        imageRevision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    renderJobs.set(job.id, job);
    scheduleRenderJobCleanup(job.id);
    runRenderJob(job, { files, relativePaths, mode }).catch((error) => {
        updateRenderJob(job, {
            status: 'failed',
            phase: 'failed',
            error: error?.message || 'Job render bị lỗi.',
            message: error?.message || 'Job render bị lỗi.'
        });
    });

    return serializeRenderJob(job);
}

export async function renderUploadedBedrockWorld({ files, relativePaths = [], mode = 'folder' }) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Không có file world nào được tải lên.');
    }

    let prepared = null;

    try {
        prepared = await prepareUploadedWorld({ files, relativePaths, mode });
        const render = await renderWorldMapProgressive(prepared.worldRoot);

        return {
            worldName: prepared.worldName || path.basename(prepared.worldRoot),
            mode,
            rootName: path.basename(prepared.worldRoot),
            ...render
        };
    } finally {
        await Promise.all(files.map((file) => safeUnlink(file.path)));
        if (prepared?.jobDir) {
            await cleanupJobDir(prepared.jobDir);
        }
    }
}
