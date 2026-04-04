import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { JSON_DIR } from '../config/index.js';

const DONATIONS_FILE = path.join(JSON_DIR, 'donations.json');

// In-memory cache
let donationsCache = null;
let lastLoadTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Load donations from file
 */
async function loadDonations() {
    const now = Date.now();
    if (donationsCache && (now - lastLoadTime) < CACHE_TTL) {
        return donationsCache;
    }

    try {
        const data = await readFile(DONATIONS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
            donationsCache = parsed.sort((a, b) => b.amount - a.amount);
            lastLoadTime = now;
            return donationsCache;
        }
    } catch (error) {
        // File doesn't exist or invalid JSON
        if (error.code !== 'ENOENT') {
            console.error('[DonateService] Error loading donations:', error);
        }
    }

    donationsCache = [];
    lastLoadTime = now;
    return donationsCache;
}

/**
 * Save donations to file
 */
async function saveDonations(donations) {
    try {
        await mkdir(JSON_DIR, { recursive: true });
        await writeFile(DONATIONS_FILE, JSON.stringify(donations, null, 2), 'utf8');
        donationsCache = [...donations];
        lastLoadTime = Date.now();
    } catch (error) {
        console.error('[DonateService] Error saving donations:', error);
        throw error;
    }
}

/**
 * Add a new donation
 * @param {string} name - Donor name
 * @param {number} amount - Donation amount
 * @returns {Object} The added donation with total
 */
export async function addDonation(name, amount) {
    if (!name || typeof amount !== 'number' || amount <= 0) {
        throw new Error('Invalid donation data: name and positive amount required');
    }

    const donations = await loadDonations();
    
    // Check if donor already exists
    const existingIndex = donations.findIndex(d => d.name.toLowerCase() === name.toLowerCase());
    
    if (existingIndex >= 0) {
        // Update existing donor
        donations[existingIndex].amount += amount;
        donations[existingIndex].lastDonation = new Date().toISOString();
        donations[existingIndex].donationCount = (donations[existingIndex].donationCount || 1) + 1;
    } else {
        // Add new donor
        donations.push({
            name: name.trim(),
            amount: amount,
            firstDonation: new Date().toISOString(),
            lastDonation: new Date().toISOString(),
            donationCount: 1
        });
    }

    // Sort by amount descending
    donations.sort((a, b) => b.amount - a.amount);

    await saveDonations(donations);

    // Calculate total
    const total = donations.reduce((sum, d) => sum + d.amount, 0);

    return {
        donor: donations.find((d) => d.name.toLowerCase() === name.toLowerCase()) || null,
        total,
        topDonors: donations.slice(0, 10)
    };
}

/**
 * Get all donations sorted by amount
 */
export async function getDonations(limit = 50) {
    const donations = await loadDonations();
    return {
        donations: donations.slice(0, limit),
        total: donations.reduce((sum, d) => sum + d.amount, 0),
        count: donations.length
    };
}

/**
 * Get top donors
 */
export async function getTopDonors(limit = 10) {
    const donations = await loadDonations();
    return donations.slice(0, limit);
}

/**
 * Parse donation command
 * Format: !add "Name" 100.000 or !add Name 100000
 * @param {string} content - Message content
 * @returns {Object|null} - { name, amount } or null if invalid
 */
export function parseDonationCommand(content) {
    if (!content || !content.startsWith('!add')) return null;
    
    // Remove !add and trim
    const args = content.slice(4).trim();
    
    // Try quoted format first: !add "Name" 100.000
    const quotedMatch = args.match(/^"([^"]+)"\s+([\d.,]+)$/);
    if (quotedMatch) {
        const name = quotedMatch[1].trim();
        const amountStr = quotedMatch[2].replace(/[.,]/g, '');
        const amount = parseInt(amountStr, 10);
        if (name && !isNaN(amount) && amount > 0) {
            return { name, amount };
        }
    }
    
    // Try unquoted format: !add Name 100000
    const parts = args.split(/\s+/);
    if (parts.length >= 2) {
        const amountStr = parts[parts.length - 1].replace(/[.,]/g, '');
        const amount = parseInt(amountStr, 10);
        const name = parts.slice(0, parts.length - 1).join(' ').trim();
        if (name && !isNaN(amount) && amount > 0) {
            return { name, amount };
        }
    }
    
    return null;
}

/**
 * Parse remove command
 * Format: !remove "Name" or !remove Name
 * @param {string} content - Message content
 * @returns {string|null} - Name to remove or null if invalid
 */
export function parseRemoveCommand(content) {
    if (!content || !content.startsWith('!remove')) return null;
    
    // Remove !remove and trim
    const args = content.slice(7).trim();
    
    // Try quoted format: !remove "Name"
    const quotedMatch = args.match(/^"([^"]+)"$/);
    if (quotedMatch) {
        return quotedMatch[1].trim();
    }
    
    // Try unquoted format: !remove Name
    if (args.length > 0) {
        return args.trim();
    }
    
    return null;
}

/**
 * Remove a donor from the list
 * @param {string} name - Donor name to remove
 * @returns {Object} - { success, removed, total, topDonors }
 */
export async function removeDonation(name) {
    if (!name || typeof name !== 'string') {
        throw new Error('Invalid donor name');
    }
    
    const normalizedName = name.trim().toLowerCase();
    const donations = await loadDonations();
    
    // Find the donor (case-insensitive)
    const index = donations.findIndex(d => d.name.toLowerCase() === normalizedName);
    
    if (index === -1) {
        return { success: false, removed: null, message: 'Không tìm thấy người donate này' };
    }
    
    // Remove the donor
    const removed = donations.splice(index, 1)[0];
    
    // Save to file
    await saveDonations(donations);
    
    // Get updated top donors
    const topDonors = donations.slice(0, 50);
    const total = donations.reduce((sum, d) => sum + d.amount, 0);
    
    return {
        success: true,
        removed,
        total,
        topDonors
    };
}
