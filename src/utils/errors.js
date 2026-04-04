/**
 * Custom Error Classes for MC Note Server
 * Provides consistent error handling across the application
 */

export class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message, details = []) {
        super(message, 400, 'VALIDATION_ERROR');
        this.details = details;
    }
}

export class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

export class AuthorizationError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

export class RateLimitError extends AppError {
    constructor(message = 'Too many requests') {
        super(message, 429, 'RATE_LIMIT_EXCEEDED');
    }
}

export class DownloadError extends AppError {
    constructor(message = 'Download failed', platform = null) {
        super(message, 502, 'DOWNLOAD_ERROR');
        this.platform = platform;
    }
}

export class DatabaseError extends AppError {
    constructor(message = 'Database operation failed') {
        super(message, 500, 'DATABASE_ERROR');
    }
}

/**
 * Error response formatter
 * Ensures consistent API error responses
 */
export function formatErrorResponse(error, includeStack = false) {
    const response = {
        success: false,
        error: {
            code: error.code || 'INTERNAL_ERROR',
            message: error.message || 'An unexpected error occurred',
        },
    };

    if (error.details) {
        response.error.details = error.details;
    }

    if (includeStack && error.stack) {
        response.error.stack = error.stack;
    }

    return response;
}

/**
 * HTTP status code mapper
 */
export function getHttpStatusCode(error) {
    if (error instanceof AppError) {
        return error.statusCode;
    }
    return 500;
}
