import { z } from 'zod';

// Common schemas
export const urlSchema = z.string().url('Invalid URL format');
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const idSchema = z.string().min(1).max(100);

// Chat message schema
export const chatMessageSchema = z.object({
    user: z.string().min(1).max(50).trim(),
    content: z.string().min(1).max(1000).trim(),
    channel: z.enum(['web', 'game', 'discord']).default('web')
});

// Download request schema
export const downloadRequestSchema = z.object({
    url: urlSchema,
    format: z.enum(['mp3', 'mp4', 'webm']).optional(),
    quality: z.string().optional()
});

// Discord embed schema
export const discordEmbedSchema = z.object({
    title: z.string().min(1).max(256).optional(),
    content: z.string().min(1).max(4096),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    image: urlSchema.optional(),
    thumbnail: urlSchema.optional(),
    footer: z.string().max(2048).optional(),
    channel: z.enum(['channel1', 'channel2']).default('channel1')
});

// Server command schema
export const serverCommandSchema = z.object({
    command: z.string().min(1).max(500).trim()
});

// File upload schema
export const fileUploadSchema = z.object({
    filename: z.string().min(1).max(255),
    mimetype: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    size: z.number().max(10 * 1024 * 1024) // 10MB max
});

// Validation middleware factory
export function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    details: error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(error);
        }
    };
}

// Validation middleware for query params
export function validateQuery(schema) {
    return (req, res, next) => {
        try {
            // Validate query but don't try to replace req.query (read-only in Express)
            // Store validated result in req.validatedQuery for controllers that need it
            req.validatedQuery = schema.parse(req.query);
            next();
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    success: false,
                    error: 'Query validation failed',
                    details: error.errors.map(e => ({
                        field: e.path.join('.'),
                        message: e.message
                    }))
                });
            }
            next(error);
        }
    };
}

// HTML entity encoding for XSS prevention (better than removing characters)
function encodeHtmlEntities(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

// Sanitize string (XSS prevention) - FIXED: Now encodes instead of removing
export function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    
    // First encode HTML entities
    let sanitized = encodeHtmlEntities(str);
    
    // Remove dangerous protocols
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/data:text\/html/gi, '');
    
    // Remove event handlers
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    
    return sanitized.trim();
}

// Recursively sanitize an object
function sanitizeObject(obj) {
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    if (typeof obj === 'string') {
        return sanitizeString(obj);
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
    }
    
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                sanitized[key] = sanitizeObject(obj[key]);
            }
        }
        return sanitized;
    }
    
    return obj;
}

// Sanitize middleware - FIXED: Now recursively sanitizes nested objects
export function sanitizeBody(req, res, next) {
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    next();
}

// Sanitize query parameters
export function sanitizeQuery(req, res, next) {
    // Note: req.query is read-only in Express, cannot reassign
    // Sanitized query params are stored in req.sanitizedQuery if needed
    if (req.query) {
        req.sanitizedQuery = sanitizeObject(req.query);
    }
    next();
}

// File upload validation
export function validateFileUpload(req, res, next) {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            error: 'No file uploaded'
        });
    }

    try {
        fileUploadSchema.parse({
            filename: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        });
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: 'File validation failed',
                details: error.errors.map(e => e.message)
            });
        }
        next(error);
    }
}
