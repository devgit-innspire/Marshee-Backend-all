const axios = require('axios');
const { StandardCheckoutClient, Env, StandardCheckoutPayRequest } = require('pg-sdk-node');
const phonepeConfig = require('./phonePeConfig');

const appendQueryParams = (baseUrl, params) => {
    if (!baseUrl) {
        return '';
    }
    try {
        const url = new URL(baseUrl);
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    } catch (error) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        const query = Object.entries(params || {})
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        return query ? `${baseUrl}${separator}${query}` : baseUrl;
    }
};

class PhonePeService {
    constructor() {
        this.clientId = phonepeConfig.CLIENT_ID;
        this.clientSecret = phonepeConfig.CLIENT_SECRET;
        this.clientVersion = Number(phonepeConfig.CLIENT_VERSION || 1);
        this.env = (process.env.NODE_ENV === 'production') ? Env.PRODUCTION : Env.SANDBOX;
        this.callbackUrl = phonepeConfig.CALLBACK_URL;
        this.successUrl = phonepeConfig.SUCCESS_URL;
        this.failureUrl = phonepeConfig.FAILURE_URL;
        this.webhookUrl = phonepeConfig.WEBHOOK_URL;
        this.client = null;

        console.log('📱 PhonePe Environment:', this.env === Env.PRODUCTION ? 'PRODUCTION (LIVE)' : 'SANDBOX (TEST)');
        console.log('🔁 PhonePe Callback URL:', this.callbackUrl || 'NOT SET');
        console.log('✅ Success URL:', this.successUrl || 'NOT SET');
        console.log('❌ Failure URL:', this.failureUrl || 'NOT SET');

        if (!this.clientId || !this.clientSecret) {
            console.warn('⚠️  PhonePe CLIENT_ID or CLIENT_SECRET not configured. Client initialization will fail.');
        }
    }

    getClient() {
        if (!this.client) {
            if (!this.clientId || !this.clientSecret) {
                console.error('❌ PhonePe credentials not configured. Cannot initialize client.');
                return null;
            }

            try {
                this.client = StandardCheckoutClient.getInstance(
                    this.clientId,
                    this.clientSecret,
                    this.clientVersion,
                    this.env
                );
                console.log('✅ PhonePe client initialized successfully');
            } catch (error) {
                console.error('❌ PhonePe client initialization failed:', error.message);
                return null;
            }
        }
        return this.client;
    }

    async createPaymentOrder({ amount, merchantOrderId, orderId, orderNumber, userId }) {
        try {
            console.log('Creating PhonePe payment order:', {
                amount,
                merchantOrderId,
                orderId,
                orderNumber,
                userId
            });

            const client = this.getClient();
            if (!client) {
                throw new Error('PhonePe client not initialized');
            }

            const numericAmount = Number(amount);
            if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
                throw new Error(`Invalid amount value: ${amount}`);
            }
            const amountInPaise = Math.round(numericAmount * 100);

            const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
            const defaultCallback = baseUrl ? `${baseUrl}/payment/status` : '';
            console.log('defaultCallback:', defaultCallback);

            const callbackUrlWithParams = appendQueryParams(
                this.callbackUrl || defaultCallback,
                {
                    merchantOrderId,
                    orderId,
                    orderNumber,
                    userId
                }
            );

            console.log('↩️ PhonePe callback URL:', callbackUrlWithParams || 'NOT SET');

            const tokenUrl = this.env === Env.PRODUCTION
                ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
                : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token';

            const tokenBody = new URLSearchParams({
                client_id: this.clientId,
                client_version: String(this.clientVersion || 1),
                client_secret: this.clientSecret,
                grant_type: 'client_credentials'
            }).toString();

            let tokenExpiresAt = null;
            try {
                const tokenRes = await axios.post(tokenUrl, tokenBody, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
                const tokenJson = tokenRes?.data || {};
                tokenExpiresAt = tokenJson.expires_at || tokenJson.expiresAt || null;
                console.log('🔐 PhonePe OAuth token fetched successfully');
            } catch (tokenErr) {
                console.error('❌ PhonePe token fetch error', { error: tokenErr?.message });
                return {
                    success: false,
                    message: 'Failed to fetch PhonePe authorization token',
                    error: tokenErr?.message || 'token_fetch_failed'
                };
            }

            const request = StandardCheckoutPayRequest.builder()
                .merchantOrderId(merchantOrderId)
                .amount(amountInPaise)
                .redirectUrl(callbackUrlWithParams)
                .build();

            console.log('📦 StandardCheckoutPayRequest:', request);

            let response;
            try {
                response = await client.createSdkOrder(request);
            } catch (sdkErr) {
                console.error('❌ PhonePe createSdkOrder failed', { error: sdkErr?.message });
                return {
                    success: false,
                    message: 'Failed to create PhonePe SDK order',
                    error: sdkErr?.message || 'create_sdk_order_failed'
                };
            }
            console.log('PhonePe CreateSdkOrderResponse received');

            if (!response || (!response.token && !response.redirectUrl)) {
                return {
                    success: false,
                    message: 'PhonePe response missing token/redirectUrl',
                    error: 'invalid_phonepe_response'
                };
            }

            const payload = {
                environment: this.env === Env.PRODUCTION ? 'PRODUCTION' : 'SANDBOX',
                merchantId: this.clientId,
                merchantOrderId,
                orderReference: response.orderId || null,
                token: response.token,
                checkoutPageUrl: response.redirectUrl || null,
                amount: numericAmount,
                amountInPaise,
                orderId: orderId || null,
                orderNumber: orderNumber || null,
                userId: userId || null,
                tokenExpiresAt,
                enableLogging: this.env === Env.PRODUCTION ? 'NO' : 'YES'
            };

            return {
                success: true,
                data: payload,
                // maintain backward compatibility for existing callers
                merchantOrderId,
                token: payload.token,
                checkoutPageUrl: payload.checkoutPageUrl,
                amount: amountInPaise,
                originalAmount: numericAmount
            };
        } catch (error) {
            console.error('PhonePe payment creation failed:', error);
            return {
                success: false,
                message: 'PhonePe payment creation failed',
                error: error?.message || 'unknown_error'
            };
        }
    }

    // async createPaymentOrder({ amount, merchantOrderId, orderId, userId }) {
    //     try {
    //         console.log('Creating PhonePe payment order for amount:', amount, 'merchantOrderId:', merchantOrderId);
    //         const client = this.getClient();
    //         if (!client) {
    //             throw new Error('PhonePe client not initialized');
    //         }

    //         const numericAmount = parseFloat(amount);
    //         if (isNaN(numericAmount) || numericAmount <= 0) {
    //             throw new Error(`Invalid amount value: ${amount}`);
    //         }
    //         const amountInPaise = Math.round(numericAmount * 100);

    //         const defaultCallback = `${process.env.BASE_URL}/api/v1/payments/check-status`;
    //         const callbackUrlWithParams = appendQueryParams(
    //             this.callbackUrl || defaultCallback,
    //             {
    //                 merchantOrderId,
    //                 orderId,
    //                 userId
    //             }
    //         );

    //         const request = StandardCheckoutPayRequest.builder()
    //             .merchantOrderId(merchantOrderId)
    //             .amount(amountInPaise)
    //             .redirectUrl(callbackUrlWithParams)
    //             .build();

    //             console.log('callbackUrlWithParams:', callbackUrlWithParams);
               
    //         console.log('StandardCheckoutPayRequest:', request);

    //         // const response = await phonepeClient.createSdkOrder(request);
            
    //         // const response = await client.createSdkOrder(request);

    //         const response = await client.pay(request);
    //         console.log('PhonePe CreateSdkOrderResponse:', response);

    //         return {
    //             success: true,
    //             merchantOrderId,
    //             token: response.token,
    //             checkoutPageUrl: response.redirectUrl,
    //             amount: amountInPaise,
    //             originalAmount: amount
    //         };
    //     } catch (error) {
    //         console.error('PhonePe payment creation failed:', error);
    //         return {
    //             success: false,
    //             error: error.message
    //         };
    //     }
    // }

}

module.exports = new PhonePeService();