const axios = require('axios');
const crypto = require('crypto');
const {
  ensureMetaPurchaseEventId,
  getMetaPurchaseValueAndCurrency
} = require('./metaPurchaseEventId');

const sha256Hex = (input) =>
  crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');

const normalizeEmail = (email) => {
  if (!email) return null;
  const v = String(email).trim().toLowerCase();
  return v || null;
};

const normalizePhone = (phone, defaultCountryCode = '91') => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;

  // Basic India-friendly normalization (10-digit local -> +91)
  if (digits.length === 10 && defaultCountryCode) {
    return `${defaultCountryCode}${digits}`;
  }

  // If it already looks like country-number, keep as-is
  return digits;
};

/** Strictly positive amount for Meta `custom_data.value` (comma/symbol-safe). */
const parsePositiveAmount = (raw) => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 0 ? Number(raw.toFixed(2)) : null;
  }
  const s = String(raw)
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/[₹$€£]/g, '');
  const v = parseFloat(s.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Number(v.toFixed(2));
};

/** Line-item prices may be zero (e.g. bundled); must be finite and >= 0. */
const toNonNegativeAmount = (raw) => {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Number(raw.toFixed(2));
  }
  const s = String(raw)
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/[₹$€£]/g, '');
  const v = parseFloat(s.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Number(v.toFixed(2));
};

const normalizeCountry = (raw) => {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) return lower;
  const map = { india: 'in', 'united states': 'us', usa: 'us', 'united kingdom': 'gb', uk: 'gb' };
  return map[lower] || null;
};

const normalizeCurrencyCode3 = (raw, fallback = 'INR') => {
  const alpha = String(raw ?? fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const code = alpha.length >= 3 ? alpha.slice(0, 3) : '';
  if (/^[A-Z]{3}$/.test(code)) return code;
  const fb = String(fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  return /^[A-Z]{3}$/.test(fb) ? fb : 'INR';
};

const getClientIpAddress = (req) => {
  // x-forwarded-for: "client, proxy1, proxy2"
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  // express: req.ip (already best-effort)
  return req?.ip || null;
};

const getClientUserAgent = (req) => {
  return (req?.headers?.['user-agent'] || null) ? String(req.headers['user-agent']) : null;
};

const buildContents = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  return items
    .filter((i) => i && i.quantity && Number(i.quantity) > 0 && i.itemType !== 'service')
    .map((i) => {
      const id = i.sku || (i.product ? String(i.product) : null) || i.name || null;
      const quantity = Number(i.quantity);
      const itemPrice = typeof i.price === 'number' ? i.price : (Number(i.price || i.originalPrice) || 0);

      return {
        id: id ? String(id) : undefined,
        quantity,
        item_price: itemPrice
      };
    })
    .filter((c) => c.id);
};

const safeGetAddress = (order) => {
  return (
    order?.shippingAddressSnapshot ||
    order?.billingAddressSnapshot ||
    {}
  );
};

const sendMetaEvent = async ({ pixelId, accessToken, event, testEventCode }) => {
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(pixelId)}/events`;

  const payload = {
    data: [event]
  };

  // Use test_event_code only when provided (Meta will treat as a test)
  if (testEventCode) payload.test_event_code = testEventCode;

  const resp = await axios.post(url, payload, {
    params: { access_token: accessToken },
    timeout: 8000,
    headers: { 'Content-Type': 'application/json' }
  });

  return resp?.data;
};

const pickReqContext = (req) => {
  if (!req) return {};
  return {
    ip: req.ip || null,
    headers: {
      'x-forwarded-for': req.headers?.['x-forwarded-for'],
      'user-agent': req.headers?.['user-agent'],
      cookie: req.headers?.cookie,
      origin: req.headers?.origin,
      referer: req.headers?.referer,
      'x-meta-page-url': req.headers?.['x-meta-page-url'],
      'x-meta-pageview-event-id': req.headers?.['x-meta-pageview-event-id'],
      'x-meta-viewcontent-event-id': req.headers?.['x-meta-viewcontent-event-id'],
      'x-meta-initiatecheckout-event-id': req.headers?.['x-meta-initiatecheckout-event-id'],
      'x-meta-addtocart-event-id': req.headers?.['x-meta-addtocart-event-id'],
      'x-meta-fbc': req.headers?.['x-meta-fbc'],
      'x-meta-fbp': req.headers?.['x-meta-fbp']
    }
  };
};

const getCookieValue = (req, name) => {
  if (!req || !name) return null;
  // If cookie-parser is enabled in your app, this will work.
  if (req.cookies && req.cookies[name]) return req.cookies[name];

  const header = req?.headers?.cookie;
  if (typeof header !== 'string' || !header.trim()) return null;

  // Parse "cookie" header: "a=b; c=d"
  const parts = header.split(';').map(v => v.trim());
  const match = parts.find(v => v.startsWith(`${name}=`));
  if (!match) return null;

  const raw = match.split('=').slice(1).join('=');
  return raw ? decodeURIComponent(raw) : null;
};

const getClientLandingPageUrl = (req) => {
  // Suggested: client sends exact landing URL (including fbclid) via header.
  return (
    req?.headers?.['x-meta-page-url'] ||
    req?.query?.page_url ||
    req?.query?.pageUrl ||
    null
  );
};

const getMetaFbc = (req) => {
  return (
    getCookieValue(req, 'fbc') ||
    getCookieValue(req, '_fbc') ||
    req?.headers?.['x-meta-fbc'] ||
    req?.query?.fbc ||
    null
  );
};

const getMetaFbp = (req) => {
  return (
    getCookieValue(req, 'fbp') ||
    getCookieValue(req, '_fbp') ||
    req?.headers?.['x-meta-fbp'] ||
    req?.query?.fbp ||
    null
  );
};

const getClientProvidedEventId = (req, preferredHeaderName) => {
  if (!req) return null;
  const preferred = preferredHeaderName ? req?.headers?.[preferredHeaderName] : null;
  const generic = req?.headers?.['x-meta-event-id'];
  const queryValue = req?.query?.event_id || req?.query?.eventId;
  const value = preferred || generic || queryValue || null;
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 128) : null;
};

/**
 * Send Meta CAPI "Purchase" event (best-effort).
 * Uses order.metadata.meta.capi.purchase.eventId for idempotency.
 */
const sendPurchaseCapiEvent = async ({ req, order }) => {
  const debug = process.env.META_CAPI_DEBUG === 'true' || process.env.NODE_ENV === 'sandbox';

  const logSkip = (reason, extra = {}) => {
    if (!debug) return;
    // Avoid logging PII; only log non-sensitive identifiers.
    console.log('Meta CAPI Purchase skipped', { reason, ...extra });
  };

  if (!order) return { skipped: true, reason: 'missing_order' };

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSION_API_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    // Avoid throwing: CAPI is analytics, not transactional.
    logSkip('missing_meta_config', { hasPixelId: !!pixelId, hasAccessToken: !!accessToken });
    return { skipped: true, reason: 'missing_meta_config' };
  }

  // Only attempt Purchase once payment is completed and order is confirmed.
  const paymentStatus = order?.payment?.status;
  const orderStatus = order?.status;
  if (paymentStatus !== 'completed' || !['confirmed', 'processing', 'shipped', 'delivered'].includes(orderStatus)) {
    logSkip('order_not_paid', { paymentStatus, orderStatus });
    return { skipped: true, reason: 'order_not_paid' };
  }

  const eventId = await ensureMetaPurchaseEventId(order, {});

  order.metadata = order.metadata || {};
  order.metadata.meta = order.metadata.meta || {};
  order.metadata.meta.capi = order.metadata.meta.capi || {};
  order.metadata.meta.capi.purchase = order.metadata.meta.capi.purchase || {};

  // Only skip when we've definitely sent the event.
  // (If a previous attempt failed, we allow retries.)
  if (order.metadata.meta.capi.purchase.eventId === eventId && order.metadata.meta.capi.purchase.status === 'sent') {
    logSkip('already_sent', { eventId });
    return { skipped: true, reason: 'already_sent', eventId };
  }

  const email = normalizeEmail(order?.contact?.email);
  const phone = normalizePhone(
    order?.contact?.phone || safeGetAddress(order)?.phone,
    process.env.META_CAPI_PHONE_COUNTRY_CODE || '91'
  );

  const address = safeGetAddress(order);
  const firstName = (address?.fullName || '').split(' ')[0]?.trim() || undefined;
  const lastName = (address?.fullName || '').split(' ').slice(1).join(' ').trim() || undefined;

  const eventTime = Math.floor((order?.payment?.paidAt || order?.confirmedAt || order?.updatedAt || new Date()).getTime() / 1000);
  const { value, currency } = getMetaPurchaseValueAndCurrency(order);
  const valueNum =
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Number(value.toFixed(2))
      : 0;
  const currencyStr = normalizeCurrencyCode3(currency, 'INR');

  const contents = buildContents(order);
  const numItems = contents.reduce((sum, c) => sum + Number(c.quantity || 0), 0);

  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = getClientUserAgent(req);

  const userData = {};
  if (email) userData.em = sha256Hex(email);
  if (phone) userData.ph = sha256Hex(phone);
  if (firstName) userData.fn = sha256Hex(String(firstName).trim().toLowerCase());
  if (lastName) userData.ln = sha256Hex(String(lastName).trim().toLowerCase());
  if (address?.city) userData.ct = sha256Hex(String(address.city).trim().toLowerCase());
  if (address?.state) userData.st = sha256Hex(String(address.state).trim().toLowerCase());
  if (address?.postalCode) userData.zp = sha256Hex(String(address.postalCode).trim().toLowerCase());
  const countryCode = normalizeCountry(address?.country);
  if (countryCode) userData.country = sha256Hex(countryCode);
  if (clientIpAddress) userData.client_ip_address = clientIpAddress;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;

  const fbc = getMetaFbc(req);
  const fbp = getMetaFbp(req);
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  // Optional identity field (Meta will hash internally if needed)
  if (order?.user) userData.external_id = String(order.user);

  const event = {
    event_name: 'Purchase',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: req?.headers?.referer || req?.headers?.origin || order?.payment?.checkoutPageUrl || '',
    user_data: userData,
    custom_data: {
      currency: currencyStr,
      value: valueNum,
      content_type: 'product',
      num_items: numItems,
      order_id: order.orderNumber ? String(order.orderNumber) : undefined,
      contents
    }
  };

  try {
    const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
    const metaRes = await sendMetaEvent({
      pixelId,
      accessToken,
      event,
      testEventCode
    });

    // Persist idempotency marker only after we received a response.
    // Graph API generally returns 200 on success.
    order.metadata.meta.capi.purchase.eventId = eventId;
    order.metadata.meta.capi.purchase.status = 'sent';
    order.metadata.meta.capi.purchase.sentAt = new Date();
    order.metadata.meta.capi.purchase.lastAttemptAt = order.metadata.meta.capi.purchase.lastAttemptAt || new Date();
    order.metadata.meta.capi.purchase.meta = {
      response: metaRes
    };
    await order.save();

    console.log('Meta CAPI Purchase sent', { pixelId, eventId });
    return { sent: true, eventId };
  } catch (err) {
    // Do not throw; webhook/payment flow must not fail due to analytics.
    console.warn('Meta CAPI Purchase failed', {
      pixelId: process.env.META_PIXEL_ID,
      eventId,
      reason: err?.response?.data || err?.message || 'meta_capi_error'
    });
    try {
      order.metadata.meta.capi.purchase.eventId = eventId;
      order.metadata.meta.capi.purchase.status = 'failed';
      order.metadata.meta.capi.purchase.failedAt = new Date();
      order.metadata.meta.capi.purchase.lastAttemptAt = new Date();
      order.metadata.meta.capi.purchase.error = {
        reason: err?.response?.data || err?.message || 'meta_capi_error'
      };
      await order.save();
    } catch (_e) {
      // ignore secondary persistence failures
    }
    return {
      sent: false,
      eventId,
      reason: err?.response?.data || err?.message || 'meta_capi_error'
    };
  }
};

/**
 * ZERO-BLOCKING helper: enqueue CAPI in background tick.
 * - Does not await anything in the request path
 * - Reloads the order inside the background task
 */
const queuePurchaseCapiEvent = ({ req, order }) => {
  try {
    const orderId = order?._id ? String(order._id) : null;
    const reqCtx = pickReqContext(req);
    if (!orderId) return;

    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          const Order = require('../models/order.model');
          const fresh = await Order.findById(orderId);
          if (!fresh) return;

          // Recreate a minimal req-like object for IP/UA fields only
          const pseudoReq = {
            ip: reqCtx.ip,
            headers: reqCtx.headers
          };

          await sendPurchaseCapiEvent({ req: pseudoReq, order: fresh });
        })
        .catch((e) => {
          console.warn('⚠️ Meta CAPI background task failed:', e?.message || e);
        });
    });
  } catch (_e) {
    // swallow everything: analytics must never affect request flow
  }
};

const splitName = (fullName) => {
  const safe = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!safe) return { firstName: undefined, lastName: undefined };
  const parts = safe.split(' ');
  const firstName = parts[0]?.trim();
  const lastName = parts.slice(1).join(' ').trim() || undefined;
  return { firstName: firstName || undefined, lastName };
};

const buildUserDataFromUser = ({ req, user }) => {
  const email = normalizeEmail(user?.email);
  const phone = normalizePhone(
    user?.phoneNumber,
    process.env.META_CAPI_PHONE_COUNTRY_CODE || '91'
  );

  const { firstName, lastName } = splitName(user?.name);

  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = getClientUserAgent(req);

  const userData = {};
  if (email) userData.em = sha256Hex(email);
  if (phone) userData.ph = sha256Hex(phone);
  if (firstName) userData.fn = sha256Hex(String(firstName).trim().toLowerCase());
  if (lastName) userData.ln = sha256Hex(String(lastName).trim().toLowerCase());
  if (clientIpAddress) userData.client_ip_address = clientIpAddress;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;

  if (user?._id) userData.external_id = String(user._id);
  return userData;
};

const buildUserDataFromOrder = ({ req, order }) => {
  const email = normalizeEmail(order?.contact?.email);
  const phone = normalizePhone(
    order?.contact?.phone || safeGetAddress(order)?.phone,
    process.env.META_CAPI_PHONE_COUNTRY_CODE || '91'
  );

  const address = safeGetAddress(order);
  const { firstName, lastName } = splitName(address?.fullName);

  const clientIpAddress = getClientIpAddress(req);
  const clientUserAgent = getClientUserAgent(req);

  const userData = {};
  if (email) userData.em = sha256Hex(email);
  if (phone) userData.ph = sha256Hex(phone);
  if (firstName) userData.fn = sha256Hex(String(firstName).trim().toLowerCase());
  if (lastName) userData.ln = sha256Hex(String(lastName).trim().toLowerCase());
  if (address?.city) userData.ct = sha256Hex(String(address.city).trim().toLowerCase());
  if (address?.state) userData.st = sha256Hex(String(address.state).trim().toLowerCase());
  if (address?.postalCode) userData.zp = sha256Hex(String(address.postalCode).trim().toLowerCase());
  const countryCode = normalizeCountry(address?.country);
  if (countryCode) userData.country = sha256Hex(countryCode);
  if (clientIpAddress) userData.client_ip_address = clientIpAddress;
  if (clientUserAgent) userData.client_user_agent = clientUserAgent;

  if (order?.user) userData.external_id = String(order.user);
  return userData;
};

const buildCapiEventId = ({ eventName, identityKey, uniqueParts = [] }) => {
  const raw = [eventName, identityKey, ...uniqueParts].join('|');
  const h = sha256Hex(raw);
  return h.length > 128 ? h.slice(0, 128) : h;
};

/**
 * Meta CAPI "ViewContent" (landing page views).
 * Best-effort; never throw to callers.
 */
const sendViewContentCapiEvent = async ({ req, user, contentId, contentName }) => {
  const debug = process.env.META_CAPI_DEBUG === 'true' || process.env.NODE_ENV === 'sandbox';
  const logSkip = (reason, extra = {}) => {
    if (!debug) return;
    console.log('Meta CAPI ViewContent skipped', { reason, ...extra });
  };

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSION_API_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    logSkip('missing_meta_config', { hasPixelId: !!pixelId, hasAccessToken: !!accessToken });
    return { skipped: true, reason: 'missing_meta_config' };
  }

  if (!contentId) {
    logSkip('missing_content_id');
    return { skipped: true, reason: 'missing_content_id' };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const clientIpAddress = getClientIpAddress(req);
  const identityKey = user?._id ? String(user._id) : (clientIpAddress || 'guest');
  const timeBucket = Math.floor(Date.now() / (60 * 1000)); // minute bucket

  const fallbackEventId = buildCapiEventId({
    eventName: 'ViewContent',
    identityKey,
    uniqueParts: [String(contentId), timeBucket]
  });
  const eventId = getClientProvidedEventId(req, 'x-meta-viewcontent-event-id') || fallbackEventId;

  const userData = buildUserDataFromUser({ req, user });
  const fbc = getMetaFbc(req);
  const fbp = getMetaFbp(req);
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const eventSourceUrl =
    getClientLandingPageUrl(req) ||
    req?.headers?.referer ||
    req?.headers?.origin ||
    '';
  if (debug) {
    console.log('Meta CAPI ViewContent URL debug', {
      receivedHeaderUrl: req?.headers?.['x-meta-page-url'],
      referer: req?.headers?.referer,
      origin: req?.headers?.origin,
      resolvedEventSourceUrl: eventSourceUrl
    });
  }

  const event = {
    event_name: 'ViewContent',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      content_type: 'product',
      content_ids: [String(contentId)],
      content_name: contentName || 'Landing Page'
    }
  };

  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
  try {
    const metaRes = await sendMetaEvent({
      pixelId,
      accessToken,
      event,
      testEventCode
    });
    return { sent: true, eventId, metaRes };
  } catch (err) {
    console.warn('Meta CAPI ViewContent failed:', err?.response?.data || err?.message || 'meta_capi_error');
    return { sent: false, eventId, reason: err?.response?.data || err?.message || 'meta_capi_error' };
  }
};

const queueViewContentCapiEvent = ({ req, user, contentId, contentName }) => {
  try {
    const reqCtx = pickReqContext(req);
    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          const pseudoReq = { ip: reqCtx.ip, headers: reqCtx.headers };
          await sendViewContentCapiEvent({ req: pseudoReq, user, contentId, contentName });
        })
        .catch((e) => {
          console.warn('⚠️ Meta CAPI ViewContent background task failed:', e?.message || e);
        });
    });
  } catch (_e) {
    // analytics must never affect request flow
  }
};

/**
 * Meta CAPI "PageView".
 */
const sendPageViewCapiEvent = async ({ req, user }) => {
  const debug = process.env.META_CAPI_DEBUG === 'true' || process.env.NODE_ENV === 'sandbox';
  const logSkip = (reason, extra = {}) => {
    if (!debug) return;
    console.log('Meta CAPI PageView skipped', { reason, ...extra });
  };

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSION_API_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    logSkip('missing_meta_config', { hasPixelId: !!pixelId, hasAccessToken: !!accessToken });
    return { skipped: true, reason: 'missing_meta_config' };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const clientIpAddress = getClientIpAddress(req);
  const identityKey = user?._id ? String(user._id) : (clientIpAddress || 'guest');
  const timeBucket = Math.floor(Date.now() / (60 * 1000)); // minute bucket
  const fallbackEventId = buildCapiEventId({
    eventName: 'PageView',
    identityKey,
    uniqueParts: [timeBucket]
  });
  const eventId = getClientProvidedEventId(req, 'x-meta-pageview-event-id') || fallbackEventId;

  const userData = buildUserDataFromUser({ req, user });
  const fbc = getMetaFbc(req);
  const fbp = getMetaFbp(req);
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const eventSourceUrl =
    getClientLandingPageUrl(req) ||
    req?.headers?.referer ||
    req?.headers?.origin ||
    '';

  const event = {
    event_name: 'PageView',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: userData
  };

  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
  try {
    const metaRes = await sendMetaEvent({
      pixelId,
      accessToken,
      event,
      testEventCode
    });
    return { sent: true, eventId, metaRes };
  } catch (err) {
    console.warn('Meta CAPI PageView failed:', err?.response?.data || err?.message || 'meta_capi_error');
    return { sent: false, eventId, reason: err?.response?.data || err?.message || 'meta_capi_error' };
  }
};

const queuePageViewCapiEvent = ({ req, user }) => {
  try {
    const reqCtx = pickReqContext(req);
    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          const pseudoReq = { ip: reqCtx.ip, headers: reqCtx.headers };
          await sendPageViewCapiEvent({ req: pseudoReq, user });
        })
        .catch((e) => {
          console.warn('⚠️ Meta CAPI PageView background task failed:', e?.message || e);
        });
    });
  } catch (_e) {
    // analytics must never affect request flow
  }
};

/**
 * Meta CAPI "AddToCart".
 */
const sendAddToCartCapiEvent = async ({
  req,
  user,
  contentId,
  contentName,
  quantity,
  itemPrice,
  value,
  currency
}) => {
  const debug = process.env.META_CAPI_DEBUG === 'true' || process.env.NODE_ENV === 'sandbox';
  const logSkip = (reason, extra = {}) => {
    if (!debug) return;
    console.log('Meta CAPI AddToCart skipped', { reason, ...extra });
  };

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSION_API_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    logSkip('missing_meta_config', { hasPixelId: !!pixelId, hasAccessToken: !!accessToken });
    return { skipped: true, reason: 'missing_meta_config' };
  }

  if (!contentId) {
    logSkip('missing_content_id');
    return { skipped: true, reason: 'missing_content_id' };
  }

  const qtyNum = Number(quantity || 0);
  const itemPriceNum = Number(itemPrice || 0);
  const valueNum = value !== undefined ? Number(value) : itemPriceNum * qtyNum;
  const currencyStr = currency || 'INR';
  if (!qtyNum || qtyNum <= 0) {
    logSkip('invalid_quantity', { quantity });
    return { skipped: true, reason: 'invalid_quantity' };
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const clientIpAddress = getClientIpAddress(req);
  const identityKey = user?._id ? String(user._id) : (clientIpAddress || 'guest');
  const timeBucket = Math.floor(Date.now() / 10000); // 10s bucket

  const fallbackEventId = buildCapiEventId({
    eventName: 'AddToCart',
    identityKey,
    uniqueParts: [String(contentId), qtyNum, timeBucket]
  });
  const eventId = getClientProvidedEventId(req, 'x-meta-addtocart-event-id') || fallbackEventId;

  const userData = buildUserDataFromUser({ req, user });
  const fbc = getMetaFbc(req);
  const fbp = getMetaFbp(req);
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const eventSourceUrl =
    getClientLandingPageUrl(req) ||
    req?.headers?.referer ||
    req?.headers?.origin ||
    '';

  const event = {
    event_name: 'AddToCart',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      content_type: 'product',
      value: valueNum,
      currency: currencyStr,
      num_items: qtyNum,
      content_name: contentName || undefined,
      contents: [
        {
          id: String(contentId),
          quantity: qtyNum,
          item_price: itemPriceNum
        }
      ]
    }
  };

  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
  try {
    const metaRes = await sendMetaEvent({
      pixelId,
      accessToken,
      event,
      testEventCode
    });
    return { sent: true, eventId, metaRes };
  } catch (err) {
    console.warn('Meta CAPI AddToCart failed:', err?.response?.data || err?.message || 'meta_capi_error');
    return { sent: false, eventId, reason: err?.response?.data || err?.message || 'meta_capi_error' };
  }
};

const queueAddToCartCapiEvent = ({
  req,
  user,
  contentId,
  contentName,
  quantity,
  itemPrice,
  value,
  currency
}) => {
  try {
    const reqCtx = pickReqContext(req);
    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          const pseudoReq = { ip: reqCtx.ip, headers: reqCtx.headers };
          await sendAddToCartCapiEvent({
            req: pseudoReq,
            user,
            contentId,
            contentName,
            quantity,
            itemPrice,
            value,
            currency
          });
        })
        .catch((e) => {
          console.warn('⚠️ Meta CAPI AddToCart background task failed:', e?.message || e);
        });
    });
  } catch (_e) {
    // swallow everything: analytics must never affect request flow
  }
};

/**
 * Meta CAPI "InitiateCheckout".
 * Triggered when your backend creates the payment/order from cart.
 */
const resolveInitiateCheckoutValue = (order) => {
  const candidates = [
    order?.totalAmount,
    order?.grandTotal,
    order?.payment?.amount,
    order?.subtotal
  ];
  for (const c of candidates) {
    const v = parsePositiveAmount(c);
    if (v !== null) return v;
  }
  const items = Array.isArray(order?.items) ? order.items : [];
  let sum = 0;
  for (const i of items) {
    const q = toNonNegativeAmount(i?.quantity);
    const p = toNonNegativeAmount(i?.price);
    if (q > 0) sum += p * q;
  }
  const v = parsePositiveAmount(sum);
  return v !== null ? v : 0;
};

const sendInitiateCheckoutCapiEvent = async ({ req, order }) => {
  const debug = process.env.META_CAPI_DEBUG === 'true' || process.env.NODE_ENV === 'sandbox';
  const logSkip = (reason, extra = {}) => {
    if (!debug) return;
    console.log('Meta CAPI InitiateCheckout skipped', { reason, ...extra });
  };

  if (!order) return { skipped: true, reason: 'missing_order' };

  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CONVERSION_API_ACCESS_TOKEN;
  if (!pixelId || !accessToken) {
    logSkip('missing_meta_config', { hasPixelId: !!pixelId, hasAccessToken: !!accessToken });
    return { skipped: true, reason: 'missing_meta_config' };
  }

  const currencyStr = normalizeCurrencyCode3(
    order?.currency || order?.payment?.currency,
    'INR'
  );
  const valueNum = resolveInitiateCheckoutValue(order);
  if (!valueNum || valueNum <= 0) {
    logSkip('invalid_or_missing_value', { valueNum });
    return { skipped: true, reason: 'invalid_or_missing_value' };
  }
  const eventTime = Math.floor(Date.now() / 1000);

  const identityKey = order?._id ? String(order._id) : String(order?.orderNumber || 'checkout');
  const fallbackEventId = buildCapiEventId({
    eventName: 'InitiateCheckout',
    identityKey,
    uniqueParts: [String(order?.orderNumber || '')]
  });
  const eventId =
    getClientProvidedEventId(req, 'x-meta-initiatecheckout-event-id') || fallbackEventId;

  const userData = buildUserDataFromOrder({ req, order });
  const fbc = getMetaFbc(req);
  const fbp = getMetaFbp(req);
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;

  const eventSourceUrl =
    getClientLandingPageUrl(req) ||
    req?.headers?.referer ||
    req?.headers?.origin ||
    '';

  const items = Array.isArray(order?.items) ? order.items : [];
  const contents = items
    .map((i) => {
      const qtyNum = Number(i?.quantity || 0);
      if (!qtyNum || qtyNum <= 0) return null;

      if (i?.itemType === 'service') {
        const extrasTotal = Array.isArray(i?.selectedExtras)
          ? i.selectedExtras.reduce((sum, e) => sum + toNonNegativeAmount(e?.price), 0)
          : 0;
        const itemPriceNum = toNonNegativeAmount(i?.price) + extrasTotal;
        const id = i?.service ? String(i.service) : (i?._id ? String(i._id) : null);
        if (!id) return null;
        return { id, quantity: qtyNum, item_price: itemPriceNum };
      }

      // product (default)
      const id = i?.sku ? String(i.sku) : (i?.product ? String(i.product) : null);
      if (!id) return null;
      const itemPriceNum = toNonNegativeAmount(i?.price);
      return { id, quantity: qtyNum, item_price: itemPriceNum };
    })
    .filter(Boolean);

  const numItems = contents.reduce((sum, c) => sum + Number(c.quantity || 0), 0);

  const event = {
    event_name: 'InitiateCheckout',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      content_type: 'product',
      value: valueNum,
      currency: currencyStr,
      num_items: numItems,
      contents,
      order_id: order?.orderNumber ? String(order.orderNumber) : String(order?._id || '')
    }
  };

  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE;
  try {
    const metaRes = await sendMetaEvent({
      pixelId,
      accessToken,
      event,
      testEventCode
    });
    return { sent: true, eventId, metaRes };
  } catch (err) {
    console.warn(
      'Meta CAPI InitiateCheckout failed:',
      err?.response?.data || err?.message || 'meta_capi_error'
    );
    return { sent: false, eventId, reason: err?.response?.data || err?.message || 'meta_capi_error' };
  }
};

const queueInitiateCheckoutCapiEvent = ({ req, order }) => {
  try {
    const reqCtx = pickReqContext(req);
    const orderPlain = order?.toObject ? order.toObject() : order;
    if (!orderPlain?._id) return;

    setImmediate(() => {
      Promise.resolve()
        .then(async () => {
          const pseudoReq = { ip: reqCtx.ip, headers: reqCtx.headers };
          await sendInitiateCheckoutCapiEvent({ req: pseudoReq, order: orderPlain });
        })
        .catch((e) => {
          console.warn('⚠️ Meta CAPI InitiateCheckout background task failed:', e?.message || e);
        });
    });
  } catch (_e) {
    // swallow everything: analytics must never affect request flow
  }
};

module.exports = {
  sendPurchaseCapiEvent,
  queuePurchaseCapiEvent,
  sendViewContentCapiEvent,
  queueViewContentCapiEvent,
  sendPageViewCapiEvent,
  queuePageViewCapiEvent,
  sendAddToCartCapiEvent,
  queueAddToCartCapiEvent,
  sendInitiateCheckoutCapiEvent,
  queueInitiateCheckoutCapiEvent
};

