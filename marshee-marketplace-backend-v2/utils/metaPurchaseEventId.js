/**
 * Single source for Meta Pixel eventID (4th fbq arg) and CAPI event_id deduplication.
 * Prefer persisted order.metadata.meta.purchaseDedupEventId once set so the id does not
 * drift when payment.gatewayTransactionId is added after webhook.
 */

const mergePayment = (order, paymentOverrides = {}) => {
  const base =
    order?.payment && typeof order.payment.toObject === 'function'
      ? order.payment.toObject()
      : { ...(order?.payment || {}) };
  return { ...base, ...paymentOverrides };
};

const buildEventIdCompute = (order, paymentOverrides = {}) => {
  if (!order) {
    const raw = 'purchase_unknown_no_key';
    return raw.length > 128 ? raw.slice(0, 128) : raw;
  }

  const pay = mergePayment(order, paymentOverrides);
  const key =
    pay.gatewayTransactionId ||
    pay.transactionId ||
    pay.merchantOrderId ||
    order.orderNumber ||
    order._id;

  const raw = `purchase_${order._id || 'unknown'}_${key || 'no_key'}`;
  return raw.length > 128 ? raw.slice(0, 128) : raw;
};

/**
 * Sync read: cached dedup id or computed from current order fields (no DB write).
 */
const buildEventId = (order) => {
  const cached = order?.metadata?.meta?.purchaseDedupEventId;
  if (cached) return cached;
  return buildEventIdCompute(order, {});
};

/**
 * Persists dedup id on first use. Later callers (CAPI, verify) reuse the same string.
 * @param {object} order - Mongoose order doc
 * @param {object} [paymentOverrides] - e.g. { gatewayTransactionId: razorpay_payment_id } for verify-before-webhook
 */
const ensureMetaPurchaseEventId = async (order, paymentOverrides = {}) => {
  if (!order) return null;

  order.metadata = order.metadata || {};
  order.metadata.meta = order.metadata.meta || {};

  if (order.metadata.meta.purchaseDedupEventId) {
    return order.metadata.meta.purchaseDedupEventId;
  }

  const id = buildEventIdCompute(order, paymentOverrides);
  order.metadata.meta.purchaseDedupEventId = id;
  await order.save();
  return id;
};

const parsePositivePurchaseAmount = (raw) => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 0 ? Number(raw.toFixed(2)) : null;
  }
  if (typeof raw === 'object' && raw !== null && typeof raw.toString === 'function') {
    return parsePositivePurchaseAmount(raw.toString());
  }
  const s = String(raw)
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/[₹$€£]/g, '');
  const v = parseFloat(s.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Number(v.toFixed(2));
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

/** Same numeric/currency meaning as CAPI custom_data (major units). Always a real number + ISO 4217. */
const getMetaPurchaseValueAndCurrency = (order) => {
  const total = order?.totalAmount ?? order?.payment?.amount;
  const parsed = parsePositivePurchaseAmount(total);
  const currency = normalizeCurrencyCode3(
    order?.currency || order?.payment?.currency,
    'INR'
  );
  return {
    value: parsed !== null ? parsed : 0,
    currency
  };
};

/**
 * Query params for /payment/success (and redirects). Keys match frontend: meta_event_id, value, currency.
 */
const getMetaPurchaseSuccessQueryParams = async (order, paymentOverrides = {}) => {
  if (!order) return {};
  const meta_event_id = await ensureMetaPurchaseEventId(order, paymentOverrides);
  const { value, currency } = getMetaPurchaseValueAndCurrency(order);
  return {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber || undefined,
    meta_event_id,
    value: String(value),
    currency
  };
};

module.exports = {
  buildEventId,
  buildEventIdCompute,
  ensureMetaPurchaseEventId,
  getMetaPurchaseValueAndCurrency,
  getMetaPurchaseSuccessQueryParams
};
