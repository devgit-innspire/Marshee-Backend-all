const axios = require('axios');

const ZAPIER_EMAIL_HOOK_URL =
  process.env.ZAPIER_EMAIL_HOOK_URL ||
  'https://hooks.zapier.com/hooks/catch/26779518/uxkn63r/';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

const pickDefined = (obj, allowedKeys) => {
  const out = {};
  for (const k of allowedKeys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
};

/**
 * Sends an email payload to Zapier Catch Hook.
 * @param {Object} params
 * @param {string} params.email
 * @param {string=} params.subject
 * @param {string=} params.message
 * @param {string|string[]=} params.cc
 * @param {string|string[]=} params.bcc
 * @param {string|string[]=} params.attachments
 * @param {string=} params.name
 * @returns {Promise<{success: boolean, status?: number, data?: any, error?: string}>}
 */
const sendZapierEmail = async (params = {}) => {
  try {
    const { email } = params;

    if (!isNonEmptyString(email)) {
      return {
        success: false,
        error: 'Invalid payload. Required: email (non-empty string).'
      };
    }

    const payload = pickDefined(
      {
        ...params,
        email: email.trim(),
        subject: isNonEmptyString(params.subject) ? params.subject.trim() : params.subject
      },
      ['email', 'subject', 'message', 'cc', 'bcc', 'attachments', 'name']
    );

    const res = await axios.post(
      ZAPIER_EMAIL_HOOK_URL,
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );

    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const errorMessage =
      (typeof err?.message === 'string' && err.message) ||
      'Failed to send Zapier email.';

    return {
      success: false,
      status,
      data,
      error: errorMessage
    };
  }
};

module.exports = {
  sendZapierEmail,
  ZAPIER_EMAIL_HOOK_URL
};

