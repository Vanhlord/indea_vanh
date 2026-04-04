import dns from 'dns/promises';
import net from 'net';

const ALLOWED_MEDIA_HOST_PATTERNS = [
    /^tikwm\.com$/i,
    /\.tikwm\.com$/i,
    /^tiktok\.com$/i,
    /\.tiktok\.com$/i,
    /^tiktokcdn\.com$/i,
    /\.tiktokcdn\.com$/i,
    /^tiktokcdn-us\.com$/i,
    /\.tiktokcdn-us\.com$/i,
    /^tiktokv\.com$/i,
    /\.tiktokv\.com$/i,
    /^byteoversea\.com$/i,
    /\.byteoversea\.com$/i,
    /^ibyteimg\.com$/i,
    /\.ibyteimg\.com$/i,
    /^byteimg\.com$/i,
    /\.byteimg\.com$/i,
    /^ibytedtos\.com$/i,
    /\.ibytedtos\.com$/i,
    /^muscdn\.com$/i,
    /\.muscdn\.com$/i,
    /\.akamaized\.net$/i,
    /\.cloudfront\.net$/i
];

const SAFE_PORTS = new Set(['', '80', '443']);

function isLocalHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost'
        || host === '0.0.0.0'
        || host === '::1'
        || host.endsWith('.local')
        || host.endsWith('.localhost')
        || host.endsWith('.internal')
        || host.endsWith('.home.arpa');
}

function isPrivateIpv4(ip) {
    const parts = String(ip).split('.').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return true;
    const [a, b] = parts;

    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
}

function isPrivateIpv6(ip) {
    const v = String(ip || '').toLowerCase();
    return v === '::1'
        || v.startsWith('fe80:')
        || v.startsWith('fc')
        || v.startsWith('fd')
        || v.startsWith('::ffff:127.')
        || v.startsWith('::ffff:10.')
        || v.startsWith('::ffff:192.168.');
}

function isPrivateAddress(ip) {
    const type = net.isIP(ip);
    if (type === 4) return isPrivateIpv4(ip);
    if (type === 6) return isPrivateIpv6(ip);
    return true;
}

export function isAllowedMediaHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return ALLOWED_MEDIA_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function assertSafeMediaUrlBasic(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl || ''));
    } catch {
        throw new Error('URL media không hợp lệ.');
    }

    if (!['https:', 'http:'].includes(url.protocol)) {
        throw new Error('Chỉ hỗ trợ giao thức HTTP/HTTPS.');
    }
    if (!SAFE_PORTS.has(url.port)) {
        throw new Error('Cổng URL không được phép.');
    }
    if (url.username || url.password) {
        throw new Error('URL media không hợp lệ.');
    }

    const hostname = url.hostname.toLowerCase();
    if (isLocalHostname(hostname)) {
        throw new Error('Host nội bộ không được phép.');
    }
    if (!isAllowedMediaHost(hostname)) {
        throw new Error('Host media không nằm trong danh sách cho phép.');
    }

    return url;
}

export function assertSafeMediaUrlSync(rawUrl) {
    const url = assertSafeMediaUrlBasic(rawUrl);
    const hostname = url.hostname.toLowerCase();

    const hostIpType = net.isIP(hostname);
    if (hostIpType > 0 && isPrivateAddress(hostname)) {
        throw new Error('IP nội bộ không được phép.');
    }

    return url;
}

export async function assertSafeMediaUrl(rawUrl) {
    const url = assertSafeMediaUrlBasic(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const hostIpType = net.isIP(hostname);

    if (hostIpType > 0 && isPrivateAddress(hostname)) {
        throw new Error('IP nội bộ không được phép.');
    }

    if (hostIpType === 0) {
        const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
        if (!resolved.length) {
            throw new Error('Không phân giải được host media.');
        }
        for (const item of resolved) {
            if (isPrivateAddress(item.address)) {
                throw new Error('Host media trỏ tới IP nội bộ.');
            }
        }
    }

    return url;
}
