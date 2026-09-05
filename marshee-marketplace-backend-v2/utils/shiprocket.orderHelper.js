/**
 * Shiprocket Order Helper
 * Helper functions for creating Shiprocket orders from payment events
 */

const shiprocketIntegration = require('./shiprocket.integration');

/**
 * Create Shiprocket order when payment is completed
 * This is a clean wrapper that handles errors gracefully
 * @param {Object} order - Order model instance
 * @returns {Promise<Object|null>} Shiprocket response or null if failed
 */
async function createShiprocketOrderOnPaymentComplete(order) {
    console.log("createShiprocketOrderOnPaymentComplete:-", order);
  try {
    // Validate order has required data
    if (!order) {
      console.error('❌ Cannot create Shiprocket order: order is null');
      return null;
    }

    const hasExistingFulfillments = order.shipping?.shiprocket?.fulfillments?.length > 0;
    const hasExistingOrderId = order.shipping?.shiprocket?.orderId;
    const allHaveAwb = hasExistingFulfillments &&
      order.shipping.shiprocket.fulfillments.every(f => f.awbCode);

    if ((hasExistingFulfillments || hasExistingOrderId) && allHaveAwb) {
      console.log(`ℹ️  Shiprocket order(s) already exist for order ${order.orderNumber}`);
      return {
        alreadyExists: true,
        orderId: order.shipping.shiprocket.orderId,
        fulfillments: order.shipping.shiprocket.fulfillments
      };
    }

    // Fulfillments exist but some are missing AWB — retry AWB assignment
    if (hasExistingFulfillments && !allHaveAwb) {
      console.log(`🔄 [Shiprocket] Order ${order.orderNumber}: fulfillments exist but AWB missing, retrying AWB assignment...`);
      try {
        const fulfillResult = await shiprocketIntegration.fulfillShiprocketOrdersByPartner(order);
        if (fulfillResult.fulfilled > 0) {
          console.log(`✅ [Shiprocket] Order ${order.orderNumber}: AWB assigned for ${fulfillResult.fulfilled} fulfillment(s) (retry)`);
        }
        if (fulfillResult.errors && fulfillResult.errors.length > 0) {
          fulfillResult.errors.forEach((e, i) => {
            console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber} retry fulfill error [${i + 1}]:`, e.message);
          });
        }
        return {
          alreadyExists: true,
          retried: true,
          orderId: order.shipping.shiprocket.orderId,
          fulfillments: order.shipping.shiprocket.fulfillments,
          fulfillResult
        };
      } catch (retryErr) {
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: AWB retry failed:`, retryErr.message);
        return {
          alreadyExists: true,
          retried: true,
          orderId: order.shipping.shiprocket.orderId,
          fulfillments: order.shipping.shiprocket.fulfillments
        };
      }
    }

    // Validate order has shipping address
    if (!order.shippingAddressSnapshot && !order.shippingAddress) {
      console.error(`❌ Cannot create Shiprocket order for ${order.orderNumber}: missing shipping address`);
      return null;
    }

    // Validate order has shippable items (products, not services)
    const hasShippableItems = order.items?.some(item => item.itemType !== 'service');
    if (!hasShippableItems) {
      console.log(`ℹ️  Order ${order.orderNumber} has no shippable items (only services), skipping Shiprocket order creation`);
      return null;
    }

    // Ensure order.user is populated so mapper can use email/phone (address/contact may be missing)
    const hasEmail = order.contact?.email || (order.user && typeof order.user === 'object' && order.user.email);
    const hasPhone = order.contact?.phone || order.shippingAddressSnapshot?.phone || order.billingAddressSnapshot?.phone ||
      (order.user && typeof order.user === 'object' && order.user.phoneNumber);
    if ((!hasEmail || !hasPhone) && order.user) {
      try {
        await order.populate({ path: 'user', select: 'email phoneNumber' });
      } catch (populateErr) {
        console.warn(`⚠️  [Shiprocket] Order ${order.orderNumber}: could not populate user:`, populateErr?.message);
      }
    }

    // Create Shiprocket order(s) — one per partner, using each partner's pickup location
    console.log(`🚚 Creating Shiprocket order(s) for order ${order.orderNumber} (by partner)...`);
    const result = await shiprocketIntegration.createShiprocketOrdersByPartner(order);

    if (result.alreadyExists) {
      console.log(`✅ Shiprocket order(s) already exist for order ${order.orderNumber}`);
    } else {
      const count = (result.fulfillments || []).length;
      if (count > 0) {
        console.log(`✅ Shiprocket order(s) created for order ${order.orderNumber}: ${count} fulfillment(s)`);
        result.fulfillments.forEach((f, i) => {
          console.log(`   [${i + 1}] Partner ${f.partnerId || 'N/A'} → Order ID: ${f.orderId}, Shipment ID: ${f.shipmentId}, pickup: ${f.pickup_location}`);
        });
        // Fulfill each shipment: serviceability → assign AWB → request pickup (per partner pickup pincode)
        try {
          const fulfillResult = await shiprocketIntegration.fulfillShiprocketOrdersByPartner(order);
          if (fulfillResult.fulfilled > 0) {
            console.log(`✅ [Shiprocket] Order ${order.orderNumber}: AWB assigned for ${fulfillResult.fulfilled} fulfillment(s)`);
          }
          if (fulfillResult.errors && fulfillResult.errors.length > 0) {
            fulfillResult.errors.forEach((e, i) => {
              console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber} fulfill error [${i + 1}]:`, e.message);
            });
          }
        } catch (fulfillErr) {
          console.error(`❌ [Shiprocket] Order ${order.orderNumber}: AWB fulfillment failed (order already created):`, fulfillErr.message);
        }
      }
      if (result.creationErrors && result.creationErrors.length > 0) {
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: ${result.creationErrors.length} creation error(s) (stored on order.shipping.shiprocket.creationErrors):`);
        result.creationErrors.forEach((e, i) => {
          console.error(`   [${i + 1}] ${e.type}: ${e.message}`);
        });
      }
      if (count === 0 && result.creationErrors?.length > 0) {
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: No Shiprocket orders created. All groups had errors (no partner or no pickup location).`);
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ Failed to create Shiprocket order for order ${order.orderNumber}:`, error.message);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      orderNumber: order.orderNumber,
      orderId: order._id
    });
    
    // Don't throw - return null so payment processing can continue
    return null;
  }
}

module.exports = {
  createShiprocketOrderOnPaymentComplete
};

