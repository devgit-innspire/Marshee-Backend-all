// Paytm Payment Gateway configuration wrapper
// Mirrors the pattern used by phonePeConfig.js and razorpayConfig.js.
// Exposes env variables with safe defaults so the app does not crash when
// values are not yet provided.

const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';
const prefix = isProd ? 'PAYTM_PROD' : 'PAYTM_TEST';

const get = (name) => {
  // Check prefixed var first, then generic PAYTM_ var, then empty string
  return process.env[`${prefix}_${name}`] || process.env[`PAYTM_${name}`] || '';
};

module.exports = {
  MID: get('MID'),                          // Merchant ID
  MERCHANT_KEY: get('MERCHANT_KEY'),         // Merchant Key (signing secret)
  WEBSITE: get('WEBSITE') || (isProd ? 'DEFAULT' : 'WEBSTAGING'),
  INDUSTRY_TYPE_ID: get('INDUSTRY_TYPE_ID') || 'Retail',
  CHANNEL_ID: get('CHANNEL_ID') || 'WEB',
  SUCCESS_URL: get('SUCCESS_URL') || '',
  FAILURE_URL: get('FAILURE_URL') || '',
  CALLBACK_URL: get('CALLBACK_URL') || '',  // Redirect URL after Paytm hosted page
  WEBHOOK_SECRET: get('WEBHOOK_SECRET') || '', // Used for webhook signature (if applicable)
  // Paytm API base URLs
  API_BASE: isProd
    ? 'https://securegw.paytm.in'
    : 'https://securegw-stage.paytm.in',
};
