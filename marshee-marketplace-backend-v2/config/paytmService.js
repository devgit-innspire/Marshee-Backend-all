/**
 * Paytm Payment Service
 *
 * Handles all Paytm Payments API v1 interactions:
 *  - Initiate transaction (get TxnToken for the checkout page)
 *  - Verify transaction status via the Order Status API
 *  - Webhook / callback checksum verification
 *
 * Paytm uses HMAC-SHA256 with the Merchant Key as the signing secret.
 * All API calls go to the host defined in paytmConfig.API_BASE.
 *
 * Environment variables (prefixed PAYTM_PROD_ in production, PAYTM_TEST_ in dev):
 *   MID, MERCHANT_KEY, WEBSITE, INDUSTRY_TYPE_ID, CHANNEL_ID,
 *   SUCCESS_URL, FAILURE_URL, CALLBACK_URL, WEBHOOK_SECRET, API_BASE
 */

const crypto = require('crypto');
const axios = require('axios');
const PaytmChecksum = require('paytmchecksum');
const paytmConfig = require('./paytmConfig');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate checksum using official PaytmChecksum library for Paytm request body or params.
 */
async function generateChecksum(params, key) {
  if (typeof params === 'object') {
    return PaytmChecksum.generateSignature(JSON.stringify(params), key);
  }
  return PaytmChecksum.generateSignature(String(params), key);
}

/**
 * Verify a checksum received in a Paytm callback / webhook using official PaytmChecksum library.
 */
async function verifyChecksum(params, key, checksum) {
  try {
    if (typeof params === 'object') {
      return PaytmChecksum.verifySignature(params, key, checksum);
    }
    return PaytmChecksum.verifySignature(String(params), key, checksum);
  } catch (err) {
    console.error('Paytm verifyChecksum error:', err.message);
    return false;
  }
}

/**
 * Build a URL by appending query params to a base URL.
 */
function appendQueryParams(baseUrl, params = {}) {
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, v);
      }
    });
    return url.toString();
  } catch {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return qs ? `${baseUrl}${sep}${qs}` : baseUrl;
  }
}

// ---------------------------------------------------------------------------
// PaytmService class
// ---------------------------------------------------------------------------

class PaytmService {
  constructor() {
    this.mid = paytmConfig.MID;
    this.merchantKey = paytmConfig.MERCHANT_KEY;
    this.website = paytmConfig.WEBSITE;
    this.industryTypeId = paytmConfig.INDUSTRY_TYPE_ID;
    this.channelId = paytmConfig.CHANNEL_ID;
    this.callbackUrl = paytmConfig.CALLBACK_URL;
    this.successUrl = paytmConfig.SUCCESS_URL;
    this.failureUrl = paytmConfig.FAILURE_URL;
    this.webhookSecret = paytmConfig.WEBHOOK_SECRET;
    this.apiBase = paytmConfig.API_BASE;

    const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';
    console.log('💳 Paytm Environment:', isProd ? 'PRODUCTION (LIVE)' : 'STAGING/TEST');
    console.log('📄 Paytm MID:', this.mid || 'NOT SET');
    console.log('🔁 Paytm Callback URL:', this.callbackUrl || 'NOT SET');
    console.log('🌐 Paytm API Base:', this.apiBase);

    if (!this.mid || !this.merchantKey) {
      console.warn('⚠️  Paytm MID or MERCHANT_KEY not configured. Transactions will fail.');
    }
  }

  /**
   * Initiate a Paytm transaction — obtains a TxnToken from Paytm.
   * Returns the token and the Paytm JS checkout page URL (for redirect/WebView).
   *
   * @param {object} options
   * @param {number}  options.amount          - Amount in INR (rupees)
   * @param {string}  options.orderId         - Your unique order ID (≤50 chars)
   * @param {string}  options.customerId      - Customer identifier (phone / user ID)
   * @param {string}  [options.email]         - Customer email (optional)
   * @param {string}  [options.phone]         - Customer phone (optional)
   * @param {string}  [options.callbackUrl]   - Override callback URL for this transaction
   * @returns {Promise<{success, txnToken, checkoutUrl, orderId, amount, error?}>}
   */
  async initiateTransaction({ amount, orderId, customerId, email, phone, callbackUrl }) {
    try {
      if (!this.mid || !this.merchantKey) {
        throw new Error('Paytm MID / MERCHANT_KEY not configured');
      }

      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error(`Invalid amount value: ${amount}`);
      }

      // Amount must be formatted as a string with 2 decimal places
      const amountStr = numericAmount.toFixed(2);

      const txnCallbackUrl = callbackUrl || this.callbackUrl || '';

      // Paytm Initiate Transaction API payload
      const body = {
        body: {
          requestType: 'Payment',
          mid: this.mid,
          websiteName: this.website,
          orderId,
          txnAmount: {
            value: amountStr,
            currency: 'INR',
          },
          userInfo: {
            custId: String(customerId),
            ...(email && { email }),
            ...(phone && { mobile: String(phone) }),
          },
          callbackUrl: txnCallbackUrl || undefined,
        },
      };

      // Generate checksum for the request head using PaytmChecksum
      const paytmChecksum = await PaytmChecksum.generateSignature(
        JSON.stringify(body.body),
        this.merchantKey
      );

      body.head = {
        signature: paytmChecksum,
      };

      console.log(`[Paytm] Initiating transaction for orderId=${orderId}, amount=${amountStr}`);

      const response = await axios.post(
        `${this.apiBase}/theia/api/v1/initiateTransaction?mid=${this.mid}&orderId=${encodeURIComponent(orderId)}`,
        body,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );

      const data = response.data;
      console.log('[Paytm] initiateTransaction response:', JSON.stringify(data).slice(0, 400));

      const resultCode = data?.body?.resultInfo?.resultCode;
      const resultStatus = data?.body?.resultInfo?.resultStatus;
      const txnToken = data?.body?.txnToken;

      if (resultStatus !== 'S' && resultStatus !== 'SUCCESS') {
        throw new Error(
          `Paytm initiateTransaction failed: ${data?.body?.resultInfo?.resultMsg || resultStatus || resultCode}`
        );
      }

      if (!txnToken) {
        throw new Error('Paytm did not return a txnToken');
      }

      // Paytm hosted checkout URL
      const checkoutUrl = `${this.apiBase}/theia/api/v1/showPaymentPage?mid=${this.mid}&orderId=${encodeURIComponent(orderId)}&txnToken=${encodeURIComponent(txnToken)}`;

      return {
        success: true,
        txnToken,
        checkoutUrl,
        orderId,
        amount: numericAmount,
      };
    } catch (error) {
      console.error('[Paytm] initiateTransaction error:', error?.response?.data || error.message);
      return {
        success: false,
        message: error.message || 'Paytm transaction initiation failed',
        error: error?.response?.data || error.message,
      };
    }
  }

  /**
   * Query Paytm Order Status API to get the current transaction status.
   *
   * @param {string} orderId - The merchant orderId used during initiation
   * @returns {Promise<{success, txnStatus, txnId, amount, raw, error?}>}
   */
  async fetchOrderStatus(orderId) {
    try {
      if (!this.mid || !this.merchantKey) {
        throw new Error('Paytm MID / MERCHANT_KEY not configured');
      }

      const statusPayload = { mid: this.mid, orderId };
      const paytmChecksum = await PaytmChecksum.generateSignature(
        JSON.stringify(statusPayload),
        this.merchantKey
      );

      const body = {
        body: statusPayload,
        head: { signature: paytmChecksum },
      };

      console.log(`[Paytm] Fetching order status for orderId=${orderId}`);

      const response = await axios.post(
        `${this.apiBase}/v3/order/status`,
        body,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        }
      );

      const data = response.data;
      console.log('[Paytm] Order status response:', JSON.stringify(data).slice(0, 400));

      const resultInfo = data?.body?.resultInfo || {};
      const txnStatus = (data?.body?.txnStatus || resultInfo.resultStatus || '').toUpperCase();
      const txnId = data?.body?.txnId || null;
      const txnAmount = data?.body?.txnAmount
        ? Number(data.body.txnAmount)
        : null;

      return {
        success: true,
        txnStatus,      // 'TXN_SUCCESS' | 'TXN_FAILURE' | 'PENDING'
        txnId,
        amount: txnAmount,
        resultInfo,
        raw: data?.body || data,
      };
    } catch (error) {
      console.error('[Paytm] fetchOrderStatus error:', error?.response?.data || error.message);
      return {
        success: false,
        message: error.message || 'Paytm order status fetch failed',
        error: error?.response?.data || error.message,
      };
    }
  }

  /**
   * Verify checksum from a Paytm callback / webhook payload.
   *
   * @param {Object} params   - All key-value params from the callback (exclude CHECKSUMHASH)
   * @param {string} checksum - The CHECKSUMHASH received from Paytm
   * @returns {Promise<{ isValid: boolean }>}
   */
  async verifyCallbackChecksum(params, checksum) {
    try {
      const key = this.merchantKey || this.webhookSecret;
      if (!key) {
        console.error('[Paytm] No merchant key set for checksum verification');
        return { isValid: false };
      }
      const isValid = await verifyChecksum(params, key, checksum);
      return { isValid };
    } catch (err) {
      console.error('[Paytm] verifyCallbackChecksum error:', err.message);
      return { isValid: false };
    }
  }

  /**
   * Map Paytm txnStatus to internal payment status.
   * @param {string} txnStatus
   * @returns {'completed'|'failed'|'pending'}
   */
  mapTxnStatusToPaymentStatus(txnStatus) {
    switch ((txnStatus || '').toUpperCase()) {
      case 'TXN_SUCCESS':
      case 'SUCCESS':
        return 'completed';
      case 'TXN_FAILURE':
      case 'FAILURE':
      case 'FAILED':
        return 'failed';
      default:
        return 'pending';
    }
  }

  buildCallbackUrl(params = {}) {
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    const defaultCb = baseUrl ? `${baseUrl}/payment/paytm/status` : '';
    return appendQueryParams(this.callbackUrl || defaultCb, params);
  }

  buildSuccessUrl(params = {}) {
    const baseUrl = (process.env.FRONTEND_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    const defaultSuccess = baseUrl ? `${baseUrl}/payment/success` : '';
    return appendQueryParams(this.successUrl || defaultSuccess, params);
  }

  buildFailureUrl(params = {}) {
    const baseUrl = (process.env.FRONTEND_URL || process.env.BASE_URL || '').replace(/\/$/, '');
    const defaultFailure = baseUrl ? `${baseUrl}/payment/failure` : '';
    return appendQueryParams(this.failureUrl || defaultFailure, params);
  }

  getMid() {
    return this.mid;
  }

  isConfigured() {
    return !!(this.mid && this.merchantKey);
  }
}

module.exports = new PaytmService();
