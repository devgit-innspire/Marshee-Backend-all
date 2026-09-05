const Razorpay = require('razorpay');
const razorpayConfig = require('./razorpayConfig');

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

class RazorpayService {
    constructor() {
        this.keyId = razorpayConfig.KEY_ID;
        this.keySecret = razorpayConfig.KEY_SECRET;
        this.callbackUrl = razorpayConfig.CALLBACK_URL;
        this.successUrl = razorpayConfig.SUCCESS_URL;
        this.failureUrl = razorpayConfig.FAILURE_URL;
        this.webhookSecret = razorpayConfig.WEBHOOK_SECRET;
        this.instance = null;

        const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';
        console.log('💳 Razorpay Environment:', isProd ? 'PRODUCTION (LIVE)' : 'TEST');
        console.log('📄 Razorpay Key ID:', this.keyId || 'NOT SET');
        console.log('🔁 Razorpay Callback URL:', this.callbackUrl || 'NOT SET');
        console.log('✅ Success URL:', this.successUrl || 'NOT SET');
        console.log('❌ Failure URL:', this.failureUrl || 'NOT SET');

        if (!this.keyId || !this.keySecret) {
            console.warn('⚠️  Razorpay KEY_ID or KEY_SECRET not configured. Client initialization will fail.');
        }
    }

    getInstance() {
        if (!this.instance) {
            if (!this.keyId || !this.keySecret) {
                console.error('❌ Razorpay credentials not configured. Cannot initialize client.');
                return null;
            }

            try {
                this.instance = new Razorpay({
                    key_id: this.keyId,
                    key_secret: this.keySecret
                });
                console.log('Razorpay client initialized successfully');
            } catch (error) {
                console.error('Razorpay client initialization failed:', error.message);
                return null;
            }
        }
        return this.instance;
    }

    async createOrder({ amount, currency = 'INR', merchantOrderId, receipt, notes = {} }) {
        try {
            console.log('Creating Razorpay order:', {
                amount,
                currency,
                merchantOrderId,
                receipt
            });

            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const numericAmount = Number(amount);
            if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
                throw new Error(`Invalid amount value: ${amount}`);
            }

            // Razorpay expects amount in paise (smallest currency unit)
            const amountInPaise = Math.round(numericAmount * 100);

            const orderOptions = {
                amount: amountInPaise,
                currency: currency,
                receipt: receipt || merchantOrderId,
                notes: {
                    merchantOrderId: merchantOrderId,
                    ...notes
                }
            }; 

            console.log('📦 Razorpay Order Options:', orderOptions);

            const order = await instance.orders.create(orderOptions);
            console.log('Razorpay Order Created:', order.id);

            console.log("order in createOrder:", order);

            return {
                success: true,
                orderId: order.id,
                amount: amountInPaise,
                amountInRupees: numericAmount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status,
                merchantOrderId: merchantOrderId,
                createdAt: order.created_at
            };
        } catch (error) {
            console.error('Razorpay order creation failed:', error);
            return {
                success: false,
                message: 'Razorpay order creation failed',
                error: error?.message || 'unknown_error'
            };
        }
    }

    async verifyPaymentSignature({ orderId, paymentId, signature }) {
        try {
            const crypto = require('crypto');
            
            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const text = `${orderId}|${paymentId}`;
            const generatedSignature = crypto
                .createHmac('sha256', this.keySecret)
                .update(text)
                .digest('hex');

            const isValid = generatedSignature === signature;

            if (!isValid) {
                console.warn('⚠️  Razorpay signature verification failed');
                console.warn('Expected:', generatedSignature);
                console.warn('Received:', signature);
            } else {
                console.log('Razorpay signature verified successfully');
            }

            return {
                success: isValid,
                isValid: isValid,
                message: isValid ? 'Signature verified' : 'Signature verification failed'
            };
        } catch (error) {
            console.error('Razorpay signature verification error:', error);
            return {
                success: false,
                isValid: false,
                message: 'Signature verification error',
                error: error?.message || 'unknown_error'
            };
        }
    }

    /**
     * Verify Payment Link signature
     * For Payment Links, signature is generated from: payment_link_id|payment_id
     */
    async verifyPaymentLinkSignature({ paymentLinkId, paymentId, signature }) {
        try {
            const crypto = require('crypto');
            
            if (!this.keySecret) {
                throw new Error('Razorpay key secret not configured');
            }

            const text = `${paymentLinkId}|${paymentId}`;
            const generatedSignature = crypto
                .createHmac('sha256', this.keySecret)
                .update(text)
                .digest('hex');

            const isValid = generatedSignature === signature;

            if (!isValid) {
                console.warn('⚠️  Razorpay Payment Link signature verification failed');
                console.warn('Text:', text);
                console.warn('Expected:', generatedSignature);
                console.warn('Received:', signature);
            } else {
                console.log('✅ Razorpay Payment Link signature verified successfully');
            }

            return {
                success: isValid,
                isValid: isValid,
                message: isValid ? 'Signature verified' : 'Signature verification failed'
            };
        } catch (error) {
            console.error('Razorpay Payment Link signature verification error:', error);
            return {
                success: false,
                isValid: false,
                message: 'Signature verification error',
                error: error?.message || 'unknown_error'
            };
        }
    }

    async fetchPayment(paymentId) {
        try {
            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const payment = await instance.payments.fetch(paymentId);
            
            return {
                success: true,
                payment: {
                    id: payment.id,
                    entity: payment.entity,
                    amount: payment.amount / 100, // Convert paise to rupees
                    currency: payment.currency,
                    status: payment.status,
                    orderId: payment.order_id,
                    method: payment.method,
                    description: payment.description,
                    notes: payment.notes,
                    createdAt: payment.created_at,
                    captured: payment.captured,
                    refundStatus: payment.refund_status,
                    email: payment.email,
                    contact: payment.contact
                }
            };
        } catch (error) {
            console.error('❌ Razorpay fetch payment error:', error);
            return {
                success: false,
                message: 'Failed to fetch payment from Razorpay',
                error: error?.message || 'unknown_error'
            };
        }
    }

    async fetchOrder(orderId) {
        try {
            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const order = await instance.orders.fetch(orderId);
            
            return {
                success: true,
                order: {
                    id: order.id,
                    entity: order.entity,
                    amount: order.amount / 100, // Convert paise to rupees
                    amountPaid: order.amount_paid / 100,
                    amountDue: order.amount_due / 100,
                    currency: order.currency,
                    receipt: order.receipt,
                    status: order.status,
                    attempts: order.attempts,
                    notes: order.notes,
                    createdAt: order.created_at
                }
            };
        } catch (error) {
            console.error('❌ Razorpay fetch order error:', error);
            return {
                success: false,
                message: 'Failed to fetch order from Razorpay',
                error: error?.message || 'unknown_error'
            };
        }
    }

    async fetchPaymentLink(paymentLinkId) {
        try {
            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const paymentLink = await instance.paymentLink.fetch(paymentLinkId);
            
            return {
                success: true,
                paymentLink: {
                    id: paymentLink.id,
                    entity: paymentLink.entity,
                    amount: paymentLink.amount / 100, // Convert paise to rupees
                    amountPaid: paymentLink.amount_paid / 100,
                    amountDue: paymentLink.amount_due / 100,
                    currency: paymentLink.currency,
                    description: paymentLink.description,
                    shortUrl: paymentLink.short_url,
                    status: paymentLink.status, // 'created', 'paid', 'partially_paid', 'expired'
                    acceptPartial: paymentLink.accept_partial,
                    notes: paymentLink.notes,
                    customer: paymentLink.customer,
                    createdAt: paymentLink.created_at,
                    updatedAt: paymentLink.updated_at
                }
            };
        } catch (error) {
            console.error('❌ Razorpay fetch payment link error:', error);
            return {
                success: false,
                message: 'Failed to fetch payment link from Razorpay',
                error: error?.message || 'unknown_error'
            };
        }
    }

    async capturePayment(paymentId, amount) {
        try {
            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            // Razorpay expects amount in paise
            const amountInPaise = Math.round(Number(amount) * 100);

            const payment = await instance.payments.capture(paymentId, amountInPaise);
            
            return {
                success: true,
                payment: {
                    id: payment.id,
                    status: payment.status,
                    captured: payment.captured,
                    amount: payment.amount / 100,
                    currency: payment.currency
                }
            };
        } catch (error) {
            console.error('❌ Razorpay capture payment error:', error);
            return {
                success: false,
                message: 'Failed to capture payment',
                error: error?.message || 'unknown_error'
            };
        }
    }

    buildCallbackUrl(params = {}) {
        const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
        const defaultCallback = baseUrl ? `${baseUrl}/payment/status` : '';
        return appendQueryParams(
            this.callbackUrl || defaultCallback,
            params
        );
    }

    buildSuccessUrl(params = {}) {
        const baseUrl = (process.env.FRONTEND_URL || process.env.BASE_URL || '').replace(/\/$/, '');
        const defaultSuccess = baseUrl ? `${baseUrl}/payment/success` : '';
        return appendQueryParams(
            this.successUrl || defaultSuccess,
            params
        );
    }

    buildFailureUrl(params = {}) {
        const baseUrl = (process.env.FRONTEND_URL || process.env.BASE_URL || '').replace(/\/$/, '');
        const defaultFailure = baseUrl ? `${baseUrl}/payment/failure` : '';
        return appendQueryParams(
            this.failureUrl || defaultFailure,
            params
        );
    }

    async createPaymentLink({ amount, currency = 'INR', merchantOrderId, receipt, notes = {}, customer = {}, callbackUrl = null, callbackMethod = 'get' }) {
        try {
            console.log('Creating Razorpay payment link:', {
                amount,
                currency,
                merchantOrderId,
                receipt
            });

            const instance = this.getInstance();
            if (!instance) {
                throw new Error('Razorpay client not initialized');
            }

            const numericAmount = Number(amount);
            if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
                throw new Error(`Invalid amount value: ${amount}`);
            }

            // Razorpay expects amount in paise (smallest currency unit)
            const amountInPaise = Math.round(numericAmount * 100);

            // Build payment link options
            const paymentLinkOptions = {
                amount: amountInPaise,
                currency: currency,
                description: receipt || `Payment for order ${merchantOrderId}`,
                customer: customer.name || customer.email || customer.phone ? {
                    name: customer.name,
                    email: customer.email,
                    contact: customer.phone
                } : undefined,
                notify: {
                    sms: false,
                    email: false
                },
                reminder_enable: false,
                callback_url: callbackUrl || this.buildCallbackUrl({ merchantOrderId }),
                callback_method: callbackMethod,
                notes: {
                    merchantOrderId: merchantOrderId,
                    receipt: receipt,
                    ...notes
                }
            };

            console.log('📦 Razorpay Payment Link Options:', paymentLinkOptions);

            const paymentLink = await instance.paymentLink.create(paymentLinkOptions);
            console.log('Razorpay Payment Link Created:', paymentLink.id);

            return {
                success: true,
                paymentLinkId: paymentLink.id,
                short_url: paymentLink.short_url,
                url: paymentLink.short_url, // For consistency with PhonePe response
                amount: amountInPaise,
                amountInRupees: numericAmount,
                currency: paymentLink.currency,
                status: paymentLink.status,
                merchantOrderId: merchantOrderId,
                createdAt: paymentLink.created_at
            };
        } catch (error) {
            console.error('Razorpay payment link creation failed:', error);
            return {
                success: false,
                message: 'Razorpay payment link creation failed',
                error: error?.message || 'unknown_error'
            };
        }
    }

    getKeyId() {
        return this.keyId;
    }
}

module.exports = new RazorpayService();

