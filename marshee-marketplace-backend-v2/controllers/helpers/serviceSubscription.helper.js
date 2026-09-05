const mongoose = require('mongoose');
const { Subscription } = require('../../models/service.model');

/**
 * Helpers for persisting a Service booking onto the Subscription model.
 *
 * The Subscription document is the single source of truth for any
 * service-specific booking payload (training, boarding, relocation,
 * pet-cake, nutrition, communicator, insurance, ...).
 *
 * Cart and Order documents only keep a reference (`subscription`) plus
 * neutral commerce snapshots (price, qty, package code, extras, dates,
 * notes). All "what did the user actually book" fields live here.
 */

const TYPED_BOOKING_FIELDS = [
  'relocationBooking',
  'insuranceBooking',
  'nutritionBooking',
  'communicatorBooking',
  'trainingBooking',
  'boardingBooking'
];

const parseDate = (value) => {
  if (!value) return undefined;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
};

const parseStartFromNotes = (rawNotes) => {
  if (typeof rawNotes !== 'string' || !rawNotes.trim()) return undefined;
  const match = rawNotes.match(/Start:\s*(\d{4}-\d{2}-\d{2})(?:\s+([0-2]\d:[0-5]\d))?/i);
  if (!match) return undefined;
  const datePart = match[1];
  const timePart = match[2] || '00:00';
  return parseDate(`${datePart}T${timePart}:00+05:30`);
};

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizePetCakeBooking = (petCakeBooking) => {
  if (!isPlainObject(petCakeBooking)) return undefined;
  return {
    ...petCakeBooking,
    ingredients: isPlainObject(petCakeBooking.ingredients)
      ? petCakeBooking.ingredients
      : undefined,
    customizationSelections: isPlainObject(petCakeBooking.customizationSelections)
      ? petCakeBooking.customizationSelections
      : undefined,
    pricing: isPlainObject(petCakeBooking.pricing)
      ? petCakeBooking.pricing
      : undefined
  };
};

/**
 * Build the set of subscription updates from a cart-item-shaped object.
 * Only fields actually provided by the caller are emitted, so this can be
 * used to safely merge over an existing subscription without wiping
 * untouched fields.
 */
function buildSubscriptionUpdates({ userId, service, cartItem = {}, quantity, amountPaid }) {
  const updates = {
    user: userId,
    service: service?._id || cartItem?.service,
    quantity: Math.max(1, Number(quantity || cartItem?.quantity || 1)),
    frequency: 'one-time',
    paymentStatus: 'pending',
    status: 'pending'
  };

  if (Number.isFinite(Number(amountPaid))) {
    updates.amountPaid = Number(amountPaid);
  }

  const selectedTime =
    parseDate(cartItem?.selectedDate) ||
    parseDate(cartItem?.trainingBooking?.schedule?.preferredStartDate) ||
    parseDate(cartItem?.boardingBooking?.stay?.checkInDate) ||
    parseDate(cartItem?.relocationBooking?.trip?.pickupDate) ||
    parseDate(cartItem?.nutritionBooking?.slot?.date) ||
    parseDate(cartItem?.communicatorBooking?.slot?.date) ||
    parseStartFromNotes(cartItem?.notes);

  if (selectedTime) updates.selectedTime = selectedTime;

  const notes = cartItem?.notes || cartItem?.serviceNotes || null;
  if (notes) updates.notes = notes;

  // Neutral booking snapshot — always safe to refresh from cart item.
  const bookingPayload = {};
  if (Array.isArray(cartItem?.selectedExtras)) {
    bookingPayload.selectedExtras = cartItem.selectedExtras;
  }
  if (cartItem?.servicePackageCode !== undefined) {
    bookingPayload.servicePackageCode = cartItem.servicePackageCode || null;
  }
  if (cartItem?.servicePackageName !== undefined) {
    bookingPayload.servicePackageName = cartItem.servicePackageName || null;
  }
  if (cartItem?.selectedDate !== undefined) {
    bookingPayload.selectedDate = cartItem.selectedDate || null;
  }
  if (notes !== null) bookingPayload.notes = notes;

  // Per-service-type payloads — only set if explicitly provided by caller.
  for (const key of TYPED_BOOKING_FIELDS) {
    if (isPlainObject(cartItem?.[key])) {
      updates[key] = cartItem[key];
      bookingPayload[key] = cartItem[key];
    }
  }

  const normalizedPetCakeBooking = normalizePetCakeBooking(cartItem?.petCakeBooking);
  if (normalizedPetCakeBooking) {
    updates.petCakeBooking = normalizedPetCakeBooking;
    bookingPayload.petCakeBooking = normalizedPetCakeBooking;
  }

  return { updates, bookingPayload };
}

/**
 * Create or update a Subscription representing the booking for a service
 * cart item. Reuses the cart item's existing `subscription` reference
 * when present so that booking payloads written earlier (e.g. by the
 * `addServiceToCart` flow) are not lost when this helper is called again
 * by the order/payment finalisation flow.
 */
async function createSubscriptionForServiceOrderItem({
  userId,
  service,
  cartItem,
  quantity,
  amountPaid
}) {
  const { updates, bookingPayload } = buildSubscriptionUpdates({
    userId,
    service,
    cartItem,
    quantity,
    amountPaid
  });

  const serviceId = updates.service;

  if (cartItem?.subscription && mongoose.Types.ObjectId.isValid(cartItem.subscription)) {
    const existing = await Subscription.findOne({
      _id: cartItem.subscription,
      user: userId,
      service: serviceId
    });
    if (existing) {
      Object.assign(existing, updates);
      const existingBookingPayload = isPlainObject(existing.bookingPayload)
        ? existing.bookingPayload
        : {};
      existing.bookingPayload = { ...existingBookingPayload, ...bookingPayload };
      existing.markModified('bookingPayload');
      await existing.save();
      return existing._id;
    }
  }

  const subscription = await Subscription.create({
    ...updates,
    bookingPayload
  });
  return subscription?._id;
}

/**
 * Convenience wrapper for cart flows: validates input, ensures the
 * subscription is created/updated, and returns its id so the cart item
 * can persist the reference instead of duplicating booking data.
 */
async function upsertSubscriptionForServiceCartItem(args) {
  return createSubscriptionForServiceOrderItem(args);
}

/**
 * Mark a Subscription as cancelled. Used when a service is removed from
 * the cart before checkout so we don't leave dangling pending bookings.
 */
async function cancelPendingSubscription(subscriptionId, userId) {
  if (!subscriptionId || !mongoose.Types.ObjectId.isValid(subscriptionId)) return;
  await Subscription.updateOne(
    {
      _id: subscriptionId,
      user: userId,
      paymentStatus: { $ne: 'paid' },
      status: { $nin: ['cancelled', 'expired', 'active'] }
    },
    { $set: { status: 'cancelled' } }
  );
}

module.exports = {
  createSubscriptionForServiceOrderItem,
  upsertSubscriptionForServiceCartItem,
  cancelPendingSubscription
};
