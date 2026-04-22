import express from 'express';
import session from 'express-session';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
    RATE_LIMIT_CONFIG,
    SESSION_SECRET,
    SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAME_SITE,
    SESSION_COOKIE_SECURE,
    SESSION_COOKIE_DOMAIN
} from '../config/index.js';

function parseCorsOrigins(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function isSameOrigin(origin, req) {
    if (!origin) return false;

    try {
        const originUrl = new URL(origin);
        const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
        const protocol = forwardedProto || req.protocol || originUrl.protocol.replace(':', '');
        const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
        return Boolean(host) && originUrl.host === host && originUrl.protocol === `${protocol}:`;
    } catch (_error) {
        return false;
    }
}

export function setupMiddleware(app) {
    // Trust proxy for Cloudflare
    app.set('trust proxy', 1);
    const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);

    // Basic middleware
    app.use(compression());
    app.use(express.json());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-eval'",
                    "https://cdn.jsdelivr.net", "https://cdn.socket.io",
                    "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com",
                    "https://fonts.googleapis.com", "https://unpkg.com",
                    "https://static.cloudflareinsights.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'",
                    "https://fonts.googleapis.com", "https://cdn.jsdelivr.net",
                    "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com",
                    "https://unpkg.com"],
                fontSrc: ["'self'", "data:",
                    "https://fonts.gstatic.com", "https://cdn.jsdelivr.net",
                    "https://cdnjs.cloudflare.com"],
                imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
                mediaSrc: ["'self'", "blob:", "https:", "http:"],
                connectSrc: ["'self'", "wss:", "ws:", "https:", "http:"],
                frameSrc: ["'self'", "https://discord.com"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", "https://discord.com"]
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));
    app.use(cors((req, callback) => {
        const origin = String(req.get('origin') || '').trim();

        if (!origin) {
            return callback(null, { origin: true, credentials: true });
        }

        if (isSameOrigin(origin, req) || corsOrigins.includes(origin)) {
            return callback(null, { origin: true, credentials: true });
        }

        return callback(null, { origin: false, credentials: false });
    }));

    const sessionCookie = {
        secure: SESSION_COOKIE_SECURE,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        httpOnly: true,
        sameSite: SESSION_COOKIE_SAME_SITE
    };
    if (SESSION_COOKIE_DOMAIN) {
        sessionCookie.domain = SESSION_COOKIE_DOMAIN;
    }

    // Session - use centralized cookie config so OAuth/login/logout stay consistent
    const sessionMiddleware = session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: sessionCookie,
        name: SESSION_COOKIE_NAME
    });
    app.use(sessionMiddleware);

    return { sessionMiddleware };

}

export function setupRateLimiters(app) {
    const isRatingsReadRequest = (req) => {
        const apiPath = String(req.path || '');
        return req.method === 'GET' && (apiPath === '/ratings' || apiPath.startsWith('/ratings/'));
    };

    // General API rate limiter
    const limiter = rateLimit({
        windowMs: RATE_LIMIT_CONFIG.general.windowMs,
        max: RATE_LIMIT_CONFIG.general.max,
        message: 'Too many requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
        skip: isRatingsReadRequest,
    });
    app.use('/api/', limiter);

    // Ratings write limiter (separate from general read traffic)
    const ratingsWriteLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 25,
        message: 'Bạn thao tác đánh giá quá nhanh, vui lòng thử lại sau.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/ratings', (req, res, next) => {
        if (req.method === 'POST' || req.method === 'DELETE') {
            return ratingsWriteLimiter(req, res, next);
        }
        return next();
    });

    // Strict rate limiter for sensitive endpoints
    const strictLimiter = rateLimit({
        windowMs: RATE_LIMIT_CONFIG.strict.windowMs,
        max: RATE_LIMIT_CONFIG.strict.max,
        message: 'Too many sensitive requests from this IP, please try again later.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/config/', strictLimiter);

    // Pikamc rate limiter
    const pikamcLimiter = rateLimit({
        windowMs: RATE_LIMIT_CONFIG.pikamc.windowMs,
        max: RATE_LIMIT_CONFIG.pikamc.max,
        message: 'Quá nhiều yêu cầu đến endpoint này, vui lòng thử lại sau.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/pikamc', pikamcLimiter);
    
    // Chat rate limiter
    const chatLimiter = rateLimit({
        windowMs: 1 * 60 * 1000, // 1 minute
        max: 30, // 30 messages per minute
        message: 'Quá nhiều tin nhắn, vui lòng thử lại sau.',
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/chat/', chatLimiter);
}
