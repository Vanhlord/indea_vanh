/**
 * Centralized Error Handler Middleware
 * Provides consistent error handling across the application
 */

import { formatErrorResponse, getHttpStatusCode, AppError } from '../utils/errors.js';

/**
 * Generate unique request ID for tracing
 */
function generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Main error handling middleware
 */
export function errorHandler(err, req, res, _next) {
    // Generate request ID for tracing
    const requestId = req.headers['x-request-id'] || generateRequestId();
    res.setHeader('X-Request-Id', requestId);

    // Log error details
    const errorLog = {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        error: {
            name: err.name,
            message: err.message,
            code: err.code || 'INTERNAL_ERROR',
            stack: err.stack,
        },
    };

    // Log operational errors as warnings, programming errors as errors
    if (err instanceof AppError && err.isOperational) {
        console.warn('[Operational Error]', errorLog);
    } else {
        console.error('[Programming Error]', errorLog);
    }

    // Format response
    const statusCode = getHttpStatusCode(err);
    const includeStack = process.env.NODE_ENV === 'development';
    const response = formatErrorResponse(err, includeStack);
    
    // Add request ID to response
    response.requestId = requestId;

    res.status(statusCode).json(response);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req, res, next) {
    const error = new Error(`Route ${req.method} ${req.path} not found`);
    error.statusCode = 404;
    error.code = 'ROUTE_NOT_FOUND';
    next(error);
}

/**
 * Async handler wrapper
 * Automatically catches errors in async route handlers
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Request ID middleware
 * Attaches unique ID to each request for tracing
 */
export function requestIdMiddleware(req, res, next) {
    req.id = req.headers['x-request-id'] || generateRequestId();
    res.setHeader('X-Request-Id', req.id);
    next();
}

/**
 * Success response formatter
 * Ensures consistent API success responses
 */
export function sendSuccess(res, data, message = 'Success', statusCode = 200) {
    res.status(statusCode).json({
        success: true,
        message,
        data,
        requestId: res.getHeader('X-Request-Id'),
    });
}
