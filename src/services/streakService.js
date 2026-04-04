import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STREAKS_FILE = path.join(__dirname, '../../json/streaks.json');
let streaksLock = Promise.resolve();

function withStreaksLock(task) {
    const next = streaksLock.then(task, task);
    streaksLock = next.catch(() => {});
    return next;
}

async function ensureStreaksFile() {
    try {
        await fs.ensureDir(path.dirname(STREAKS_FILE));
        if (!await fs.pathExists(STREAKS_FILE)) {
            await fs.writeJson(STREAKS_FILE, { streaks: [] });
        }
    } catch (e) {
        console.error('Error ensuring streaks file:', e);
    }
}

async function readStreaksUnsafe() {
    await ensureStreaksFile();
    try {
        const data = await fs.readJson(STREAKS_FILE);
        if (data && Array.isArray(data.streaks)) {
            return data;
        }
        return { streaks: [] };
    } catch (_error) {
        return { streaks: [] };
    }
}

async function saveStreaksUnsafe(data) {
    await fs.writeJson(STREAKS_FILE, data, { spaces: 2 });
}

export function getStartOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getDayIndex(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function getLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function pruneOldStreaks(data, now, maxDays = 30) {
    if (!data || !Array.isArray(data.streaks)) {
        return { data: { streaks: [] }, removed: 0 };
    }

    const today = getStartOfDay(now);
    const todayIndex = getDayIndex(today);
    const originalLength = data.streaks.length;

    const kept = data.streaks.filter((streak) => {
        if (!streak?.lastCheckIn) return true;
        const lastCheckin = new Date(streak.lastCheckIn);
        if (Number.isNaN(lastCheckin.getTime())) return true;
        const lastIndex = getDayIndex(getStartOfDay(lastCheckin));
        const dayDiff = todayIndex - lastIndex;
        return dayDiff <= maxDays;
    });

    return { data: { ...data, streaks: kept }, removed: originalLength - kept.length };
}

export async function loadStreaks(now = new Date(), maxDays = 30) {
    return withStreaksLock(async () => {
        const data = await readStreaksUnsafe();
        const { data: pruned, removed } = pruneOldStreaks(data, now, maxDays);
        if (removed > 0) {
            await saveStreaksUnsafe(pruned);
        }
        return pruned;
    });
}

export async function saveStreaks(data) {
    return withStreaksLock(async () => {
        await saveStreaksUnsafe(data);
        return data;
    });
}

export async function updateStreaks(now = new Date(), maxDays = 30, updater) {
    return withStreaksLock(async () => {
        const data = await readStreaksUnsafe();
        const { data: pruned, removed } = pruneOldStreaks(data, now, maxDays);
        let updated = pruned;
        if (typeof updater === 'function') {
            const maybe = await updater(pruned);
            if (maybe) {
                updated = maybe;
            }
        }
        const shouldSave = removed > 0 || typeof updater === 'function';
        if (shouldSave) {
            await saveStreaksUnsafe(updated);
        }
        return updated;
    });
}

export function isCheckedInToday(streak, today) {
    if (!streak?.lastCheckIn) return false;
    const lastCheckin = new Date(streak.lastCheckIn);
    if (Number.isNaN(lastCheckin.getTime())) return false;
    return getStartOfDay(lastCheckin).getTime() === today.getTime();
}

export async function checkInStreak(userInfo, now = new Date()) {
    const userId = String(userInfo?.userId || '').trim();
    if (!userId) {
        return { ok: false, error: 'User ID required' };
    }

    let result = { ok: false, error: 'Internal error' };

    await updateStreaks(now, 30, (data) => {
        let userStreak = data.streaks.find((s) => s.userId === userId);

        if (!userStreak) {
            userStreak = {
                userId,
                username: userInfo?.username || 'User',
                avatar: userInfo?.avatar || '',
                banner: userInfo?.banner || null,
                currentStreak: 0,
                maxStreak: 0,
                lastCheckIn: null,
                totalCheckIns: 0,
                history: []
            };
            data.streaks.push(userStreak);
        }

        const today = getStartOfDay(now);

        // Update user info from input
        if (userInfo?.username) userStreak.username = userInfo.username;
        if (typeof userInfo?.avatar !== 'undefined') userStreak.avatar = userInfo.avatar;
        if (typeof userInfo?.banner !== 'undefined') userStreak.banner = userInfo.banner || null;

        // Check if already checked in today (calendar day)
        if (isCheckedInToday(userStreak, today)) {
            result = {
                ok: false,
                error: 'Already checked in today',
                currentStreak: userStreak.currentStreak,
                nextCheckin: new Date(today.getTime() + 86400000)
            };
            return data;
        }

        if (userStreak.lastCheckIn) {
            const lastCheckin = new Date(userStreak.lastCheckIn);
            const lastCheckinDay = getStartOfDay(lastCheckin);
            const dayDiff = getDayIndex(today) - getDayIndex(lastCheckinDay);

            if (dayDiff > 1) {
                userStreak.currentStreak = 1;
            } else if (dayDiff === 1) {
                userStreak.currentStreak += 1;
            } else {
                result = {
                    ok: false,
                    error: 'Already checked in today',
                    currentStreak: userStreak.currentStreak,
                    nextCheckin: new Date(today.getTime() + 86400000)
                };
                return data;
            }
        } else {
            userStreak.currentStreak = 1;
        }

        if (userStreak.currentStreak > userStreak.maxStreak) {
            userStreak.maxStreak = userStreak.currentStreak;
        }

        userStreak.lastCheckIn = now.toISOString();
        userStreak.totalCheckIns += 1;

        const dateStr = getLocalDateString(now);
        if (!userStreak.history.includes(dateStr)) {
            userStreak.history.push(dateStr);
        }

        if (userStreak.history.length > 30) {
            userStreak.history = userStreak.history.slice(-30);
        }

        result = { ok: true, userStreak };
        return data;
    });

    return result;
}
