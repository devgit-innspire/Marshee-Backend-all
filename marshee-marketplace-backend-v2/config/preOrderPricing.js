/**
 * Server-side source of truth for pre-order pricing.
 *
 * Pre-order creation and pre-order payment endpoints are PUBLIC (no auth). Any amount
 * taken from the request body therefore lets an anonymous caller name their own price,
 * so these values must only ever come from here.
 *
 * Override per environment with PRE_ORDER_AMOUNT / WOGGLE_PRE_ORDER_AMOUNT. The defaults
 * match what the storefront currently displays:
 *   - marketplace pre-order: Rs.99   (marshee-web-v3 PreOrderForm.tsx)
 *   - woggle pre-order:      Rs.1    (marshee-web-v3 woggle/page.tsx)
 */

const positiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PRE_ORDER_AMOUNT = positiveNumber(process.env.PRE_ORDER_AMOUNT, 99);
const WOGGLE_PRE_ORDER_AMOUNT = positiveNumber(process.env.WOGGLE_PRE_ORDER_AMOUNT, 1);

/**
 * Authoritative amount payable for an existing PreOrder document.
 *
 * A coupon's finalAmount is trustworthy because the discount is calculated server-side
 * in preOrderForm.controller.js from the base price below - not supplied by the caller.
 *
 * @param {object} preOrder - PreOrder document
 * @returns {number} amount in rupees
 */
function resolvePreOrderAmount(preOrder) {
    const finalAmount = Number(preOrder?.coupon?.finalAmount);
    if (Number.isFinite(finalAmount) && finalAmount >= 0) {
        return finalAmount;
    }
    return PRE_ORDER_AMOUNT;
}

module.exports = {
    PRE_ORDER_AMOUNT,
    WOGGLE_PRE_ORDER_AMOUNT,
    resolvePreOrderAmount
};
