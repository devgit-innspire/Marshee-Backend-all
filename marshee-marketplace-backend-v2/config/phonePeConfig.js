// PhonePe configuration wrapper used by controllers/payment.controller.js
// Exposes environment variables with safe defaults so the application
// doesn't crash when values are not provided.

// Choose env prefix based on NODE_ENV. Default to TEST for development.
const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';
const prefix = isProd ? 'PHONEPE_PROD' : 'PHONEPE_TEST';

const get = (name) => {
  // check explicit var with prefix first, then generic var name, then empty string
  return process.env[`${prefix}_${name}`] || process.env[`PHONEPE_${name}`] || '';
};

module.exports = {
  CLIENT_ID: get('CLIENT_ID'),
  CLIENT_SECRET: get('CLIENT_SECRET'),
  CLIENT_VERSION: process.env.PHONEPE_CLIENT_VERSION || process.env.PHONEPE_CLIENT_VER || '1',
  REDIRECT_URL: get('REDIRECT_URL') || get('SUCCESS_URL') || '',
  SUCCESS_URL: get('SUCCESS_URL'),
  FAILURE_URL: get('FAILURE_URL') || process.env.PHONEPE_FAILURE_URL || '',
  CALLBACK_URL: get('CALLBACK_URL') || process.env.PHONEPE_CALLBACK_URL || '',
  PREORDER_CALLBACK_URL: get('PREORDER_CALLBACK_URL') || process.env.PREORDER_CALLBACK_URL || '',
  WEBHOOK_URL: get('WEBHOOK_URL') || process.env.PHONEPE_WEBHOOK_URL || '',
  MERCHANT_ID: get('MERCHANT_ID'),
  SALT_KEY: process.env.PHONEPE_SALT_KEY || process.env.PHONEPE_SALT || '',
  SALT_INDEX: process.env.PHONEPE_SALT_INDEX || ''
};