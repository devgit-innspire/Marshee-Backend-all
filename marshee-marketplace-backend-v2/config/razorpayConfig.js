// Razorpay configuration wrapper used by controllers/payment.controller.js
// Exposes environment variables with safe defaults so the application
// doesn't crash when values are not provided.

// Choose env prefix based on NODE_ENV. Default to TEST for development.
const isProd = String(process.env.NODE_ENV).toLowerCase() === 'production';
const prefix = isProd ? 'RAZORPAY_PROD' : 'RAZORPAY_TEST';

const get = (name) => {
  // check explicit var with prefix first, then generic var name, then empty string
  return process.env[`${prefix}_${name}`] || process.env[`RAZORPAY_${name}`] || '';
};

module.exports = {
  KEY_ID: get('KEY_ID') || get('KEYID'),
  KEY_SECRET: get('KEY_SECRET') || get('KEYSECRET'),
  SUCCESS_URL: get('SUCCESS_URL') || process.env.RAZORPAY_SUCCESS_URL || '',
  FAILURE_URL: get('FAILURE_URL') || process.env.RAZORPAY_FAILURE_URL || '',
  CALLBACK_URL: get('CALLBACK_URL') || process.env.RAZORPAY_CALLBACK_URL || '',
  WEBHOOK_SECRET: get('WEBHOOK_SECRET') || process.env.RAZORPAY_WEBHOOK_SECRET || ''
};

