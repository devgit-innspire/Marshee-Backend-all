const express = require('express');

/**
 * Webhook Middleware
 * 
 * Preserves raw body buffer for webhook routes that require signature verification.
 * Webhooks from payment gateways (Razorpay, PhonePe, etc.) need the exact raw body
 * bytes to verify the signature, so we must skip JSON parsing for these routes.
 * 
 * @module middleware/webhook
 */

// Configuration: Define webhook routes that need raw body
const WEBHOOK_ROUTES = [
    '/razorpay/webhook',
    '/phonepe/webhook',
    '/phonepe/webhook-legacy',
    '/paytm/webhook',
    // Woggle pre-orders have their own Razorpay webhook endpoint mounted under
    // /api/v1/woggle. Without this entry the body was JSON-parsed and the handler
    // re-stringified it before hashing, so signature verification never matched.
    '/woggle/payment/webhook'
];

/**
 * Check if the current request path is a webhook route
 * @param {string} path - Request path
 * @returns {boolean}
 */
const isWebhookRoute = (path) => {
    return WEBHOOK_ROUTES.some(route => path.includes(route));
};

/**
 * Middleware to preserve raw body for webhook routes
 * 
 * This middleware must run BEFORE express.json() to preserve the raw body buffer
 * needed for signature verification in webhook handlers.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const preserveRawBody = (req, res, next) => {
    // Only process webhook routes
    if (!isWebhookRoute(req.path)) {
        return next();
    }

    // Use raw body parser for webhook routes
    // This preserves the exact bytes needed for signature verification
    express.raw({ 
        type: 'application/json',
        limit: '10mb' // Set reasonable limit for webhook payloads
    })(req, res, (err) => {
        if (err) {
            console.error('❌ Webhook raw body parsing error:', err.message);
            return next(err);
        }
        
        // Mark request to skip JSON parsing
        req._skipJsonParsing = true;
        next();
    });
};

/**
 * Middleware to conditionally apply JSON parsing
 * 
 * Skips JSON parsing for webhook routes (which already have raw body)
 * and applies it to all other routes.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const conditionalJsonParser = (req, res, next) => {
    // Skip JSON parsing for webhook routes
    if (req._skipJsonParsing) {
        return next();
    }
    
    // Apply JSON parsing for all other routes
    express.json()(req, res, next);
};

module.exports = {
    preserveRawBody,
    conditionalJsonParser,
    isWebhookRoute,
    WEBHOOK_ROUTES
};

