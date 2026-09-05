const shiprocketService = require('./shiprocket.service');
const orderMapper = require('./shiprocket.orderMapper');
const Partner = require('../models/partner.model');
const Product = require('../models/product.model');

/**
 * Shiprocket Integration Helper
 * Handles creating orders, selecting courier, assigning AWB, requesting pickup, and tracking.
 * Token priority:
 *   1) Explicit token argument
 *   2) Authorization header Bearer token (when req is provided)
 *   3) Login with SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD (for webhooks/background)
 */
class ShiprocketIntegration {
  /**
   * Get Shiprocket token
   * @param {Object} options
   * @param {String} [options.token] - Explicit token (highest priority)
   * @param {Object} [options.req] - Express request to read Authorization header
   */
  async getToken({ token, req } = {}) {
    if (token) return token;

    if (req?.headers?.authorization?.startsWith('Bearer ')) {
      const headerToken = req.headers.authorization.substring(7);
      if (headerToken) return headerToken;
    }

    if (process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) {
      const loginRes = await shiprocketService.login(
        process.env.SHIPROCKET_EMAIL,
        process.env.SHIPROCKET_PASSWORD
      );
      return loginRes.token;
    }

    throw new Error(
      'Shiprocket token not provided. Send Authorization: Bearer <token> or set SHIPROCKET_EMAIL/SHIPROCKET_PASSWORD'
    );
  }

  /**
   * Map order to Shiprocket create order payload
   * @deprecated Use orderMapper.mapOrderToShiprocketPayload() instead
   */
  buildCreateOrderPayload(order, shippingAddr, billingAddr, orderItems, totals) {
    // Legacy method - delegate to mapper for consistency
    return orderMapper.mapOrderToShiprocketPayload(order);
  }

  /**
   * Get courier charge from Shiprocket courier object.
   * API often returns cost as "" and puts the amount in rate or freight_charge.
   */
  getCourierCharge(courier) {
    if (!courier) return 0;
    const cost = Number(courier.cost);
    const rate = Number(courier.rate);
    const freight = Number(courier.freight_charge);
    if (Number.isFinite(cost) && cost > 0) return cost;
    if (Number.isFinite(rate) && rate > 0) return rate;
    if (Number.isFinite(freight) && freight > 0) return freight;
    return 0;
  }

  /**
   * Choose best courier (cheapest; tie-breaker fastest ETA)
   */
  selectBestCourier(serviceability) {
    const list = serviceability?.data?.available_courier_companies || [];
    if (!list.length) return null;

    return list.reduce((best, curr) => {
      const bestCost = Number(best.cost || best.rate || best.freight_charge || Infinity);
      const currCost = Number(curr.cost || curr.rate || curr.freight_charge || Infinity);
      if (currCost < bestCost) return curr;
      if (currCost === bestCost) {
        const bestEdd = Number(best.estimated_delivery_days || best.edd_hours || Infinity);
        const currEdd = Number(curr.estimated_delivery_days || curr.edd_hours || Infinity);
        return currEdd < bestEdd ? curr : best;
      }
      return best;
    }, list[0]);
  }

  /**
   * Calculate totals and dimensions
   */
  computeTotals(order, orderItems) {
    const subtotal = order.subtotal || orderItems.reduce((sum, i) => sum + (i.selling_price || 0) * (i.units || 1), 0);
    const totalDiscount = order.totalDiscount || 0;
    const shippingCost = order.shippingCost || 0;

    let weightKg = 0;
    let maxL = 10;
    let maxB = 10;
    let maxH = 10;

    (order.items || []).forEach((item) => {
      const qty = item.quantity || 1;
      const grams =
        item.weightGrams ||
        item.dimensions?.weight ||
        item.dimensions?.weight_g ||
        500; // default 500g
      weightKg += (grams / 1000) * qty;

      if (item.dimensions) {
        if (item.dimensions.lengthCm) maxL = Math.max(maxL, item.dimensions.lengthCm);
        if (item.dimensions.widthCm) maxB = Math.max(maxB, item.dimensions.widthCm);
        if (item.dimensions.heightCm) maxH = Math.max(maxH, item.dimensions.heightCm);
      }
    });

    weightKg = Math.max(weightKg, 0.5); // minimum 0.5kg

    return {
      subtotal,
      totalDiscount,
      shippingCost,
      weightKg,
      dimensions: { length: maxL, breadth: maxB, height: maxH },
    };
  }

  /**
   * Create one Shiprocket order per partner using each partner's pickup location.
   * Groups order items (products only) by item.partner, fetches partner's pickup_location
   * from Partner.shiprocket.pickupLocations, and creates a Shiprocket order per group.
   * @param {Object} order - Order model instance
   * @param {Object} options - Options object
   * @param {String} [options.token] - Shiprocket token (optional)
   * @param {Object} [options.req] - Express request object (optional)
   * @returns {Promise<Object>} { fulfillments, response (first), authToken }
   */
  async createShiprocketOrdersByPartner(order, { token, req } = {}) {
    const authToken = await this.getToken({ token, req });

    const existingFulfillments = order.shipping?.shiprocket?.fulfillments;
    const existingOrderId = order.shipping?.shiprocket?.orderId;

    if ((existingFulfillments && existingFulfillments.length > 0) || existingOrderId) {
      console.log(`ℹ️  Shiprocket order(s) already exist for order ${order.orderNumber}`);
      const first = existingFulfillments?.[0] || { orderId: existingOrderId, shipmentId: order.shipping?.shiprocket?.shipmentId };
      return {
        alreadyExists: true,
        fulfillments: existingFulfillments || (first.orderId ? [{ ...first, partnerId: null, pickup_location: null }] : []),
        orderId: first?.orderId ?? existingOrderId,
        response: first?.orderId ? { order_id: first.orderId, shipment_id: first.shipmentId } : null,
        authToken
      };
    }

    const productItems = (order.items || []).filter(item => item.itemType !== 'service');
    if (productItems.length === 0) {
      throw new Error('Order has no shippable product items');
    }

    // Populate product (with embedded variants + partner) and variant ref so mapper has name, SKU, HSN, and we can group by partner
    try {
      await order.populate([
        { path: 'items.product', select: 'name sku productId hsnCode slug variants partner' },
        { path: 'items.variant', select: 'name sku' }
      ]);
    } catch (populateErr) {
      console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber}: could not populate items.product/variant:`, populateErr?.message);
    }

    // Resolve partner per item: use item.partner first; if missing, use product.partner (so different partners get separate Shiprocket orders)
    const productIdsNeedingPartner = [];
    for (const item of productItems) {
      if (item.partner != null && item.partner !== '') continue;
      const productId = item.product?._id || item.product;
      if (productId) productIdsNeedingPartner.push({ item, productId });
    }
    if (productIdsNeedingPartner.length > 0) {
      const productIds = [...new Set(productIdsNeedingPartner.map(({ productId }) => productId.toString()))];
      const products = await Product.find({ _id: { $in: productIds } }).select('partner').lean();
      const productMap = new Map(products.map(p => [p._id.toString(), p]));
      for (const { item, productId } of productIdsNeedingPartner) {
        const pid = productId.toString();
        const product = productMap.get(pid);
        if (product?.partner) {
          item.partner = product.partner;
        }
      }
    }

    const groupKey = (partnerId) => (partnerId ? partnerId.toString() : '__no_partner__');
    const groups = new Map();
    for (const item of productItems) {
      const key = groupKey(item.partner);
      if (!groups.has(key)) groups.set(key, { partnerId: item.partner, items: [] });
      groups.get(key).items.push(item);
    }

    const fulfillments = [];
    const creationErrors = [];

    for (const [key, { partnerId, items }] of groups) {
      const itemCount = items.length;

      if (key === '__no_partner__') {
        const msg = `No partner assigned for ${itemCount} product(s). Shiprocket order not created for these items.`;
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: ${msg}`);
        creationErrors.push({
          type: 'no_partner',
          message: msg,
          partnerId: null,
          itemCount,
          at: new Date()
        });
        continue;
      }

      // product.partner is Partner _id (business profile). Legacy products may still store User _id; resolve by Partner.user.
      let partner = await Partner.findById(partnerId).lean();
      if (!partner) partner = await Partner.findOne({ user: partnerId }).lean();
      const pickups = partner?.shiprocket?.pickupLocations;


      if (!pickups || pickups.length === 0) {
        const partnerIdStr = partnerId?.toString?.() || String(partnerId);
        const partnerLabel = partner
          ? `${partner.name || partner.code || 'Unknown'} (${partnerIdStr})`
          : partnerIdStr;
        const msg = `Partner "${partnerLabel}" has no Shiprocket pickup location. Add a pickup at POST /api/v1/partners/me/pickup-locations or in partner settings. Shiprocket order not created for ${itemCount} item(s). If this product should be fulfilled by another partner, check the product's partner assignment.`;
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: ${msg}`);
        creationErrors.push({
          type: 'no_pickup_location',
          message: msg,
          partnerId: partnerId,
          itemCount,
          at: new Date()
        });
        continue;
      }

      const pickupLocationName = pickups[0].pickup_location;
      const orderIdSuffix = (partner?.code || '').toString().trim() || (partnerId ? partnerId.toString().slice(-6) : 'NP');
      let payload;
      try {
        payload = orderMapper.mapOrderToShiprocketPayloadForPartner(order, items, pickupLocationName, orderIdSuffix, {
          partner
        });
        console.log(`[Shiprocket] Order ${order.orderNumber} partner ${orderIdSuffix} payload:`, JSON.stringify({ order_id: payload.order_id, sub_total: payload.sub_total, billing_city: payload.billing_city, billing_state: payload.billing_state, billing_address: payload.billing_address ? '(set)' : '(empty)' }));
        const response = await shiprocketService.createOrder(authToken, payload);
        const partnerGstin = (partner?.legal?.gstin || '').toString().trim();
        fulfillments.push({
          partnerId: partnerId || null,
          partnerGstin: partnerGstin || undefined,
          orderId: response.order_id,
          shipmentId: response.shipment_id,
          pickup_location: pickupLocationName,
          shippingCharge: 0 // Set when AWB is assigned in fulfillShiprocketOrdersByPartner (per-partner courier cost)
        });
      } catch (err) {
        const validationErrors = err.shiprocketErrors ? JSON.stringify(err.shiprocketErrors) : '';
        const msg = `Failed to create Shiprocket order for partner ${partner?.code || partnerId}: ${err.message}${validationErrors ? ` | Validation: ${validationErrors}` : ''}`;
        console.error(`❌ [Shiprocket] Order ${order.orderNumber}: ${msg}`);
        if (err.shiprocketErrors) {
          console.error(`❌ [Shiprocket] Validation details for partner ${orderIdSuffix}:`, err.shiprocketErrors);
        }
        if (payload) {
          console.error(`❌ [Shiprocket] Failed payload (partner ${orderIdSuffix}):`, JSON.stringify({ order_id: payload.order_id, billing_address: payload.billing_address, billing_state: payload.billing_state, billing_city: payload.billing_city, billing_pincode: payload.billing_pincode, sub_total: payload.sub_total, billing_phone: payload.billing_phone }));
        }
        creationErrors.push({
          type: 'api_error',
          message: msg,
          partnerId: partnerId,
          itemCount,
          at: new Date()
        });
      }
    }

    order.shipping = order.shipping || {};
    order.shipping.shiprocket = order.shipping.shiprocket || {};
    order.shipping.shiprocket.fulfillments = fulfillments;
    order.shipping.shiprocket.creationErrors = creationErrors;
    order.shipping.shiprocket.createdAt = new Date();

    if (fulfillments.length > 0) {
      order.shipping.shiprocket.orderId = fulfillments[0].orderId;
      order.shipping.shiprocket.shipmentId = fulfillments[0].shipmentId;
      order.shipping.shiprocket.status = 'created';
      if (order.shipping.trackingNumber == null) {
        order.shipping.trackingNumber = undefined;
      }
    } else {
      order.shipping.shiprocket.status = creationErrors.length > 0 ? 'creation_failed' : 'created';
    }

    await order.save();

    if (creationErrors.length > 0) {
      console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber}: ${creationErrors.length} error(s) recorded. Fulfillments created: ${fulfillments.length}`);
    }

    return {
      fulfillments,
      creationErrors,
      response: fulfillments[0] ? { order_id: fulfillments[0].orderId, shipment_id: fulfillments[0].shipmentId } : null,
      authToken
    };
  }

  /**
   * Fulfill each partner shipment: serviceability → assign AWB → request pickup → track.
   * Uses each partner's pickup pincode. Call after createShiprocketOrdersByPartner when order has fulfillments.
   * @param {Object} order - Order model instance (with order.shipping.shiprocket.fulfillments populated)
   * @param {Object} options - { token, req }
   * @returns {Promise<Object>} { fulfilled: number, errors: Array }
   */
  async fulfillShiprocketOrdersByPartner(order, { token, req } = {}) {
    const authToken = await this.getToken({ token, req });
    const fulfillments = order.shipping?.shiprocket?.fulfillments || [];
    if (fulfillments.length === 0) {
      return { fulfilled: 0, errors: [] };
    }

    const deliveryPostcode = (order.shippingAddressSnapshot?.postalCode || order.billingAddressSnapshot?.postalCode || order.shippingAddressSnapshot?.pinCode || '').toString().trim();
    if (!deliveryPostcode) {
      console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber}: no delivery pincode, skipping AWB fulfillment`);
      return { fulfilled: 0, errors: [{ message: 'No delivery pincode' }] };
    }

    let fulfilledCount = 0;
    const errors = [];

    for (let i = 0; i < fulfillments.length; i++) {
      const f = fulfillments[i];
      if (!f.shipmentId || f.awbCode) continue;

      try {
        let partner = null;
        if (f.partnerId) {
          partner = await Partner.findById(f.partnerId).lean();
          if (!partner) partner = await Partner.findOne({ user: f.partnerId }).lean();
        }
        const pickups = partner?.shiprocket?.pickupLocations || [];
        const pickupLoc = pickups.find(p => (p.pickup_location || '').toString() === (f.pickup_location || '').toString()) || pickups[0];
        const pickupPostcode = (pickupLoc?.pin_code || '').toString().trim();
        if (!pickupPostcode) {
          errors.push({ fulfillmentIndex: i, partnerId: f.partnerId, message: 'Partner pickup pincode not found' });
          continue;
        }

        const partnerItems = (order.items || []).filter(it => it.itemType !== 'service' && (it.partner || '').toString() === (f.partnerId || '').toString());
        const dimensions = orderMapper.calculateDimensionsAndWeight(partnerItems.length ? partnerItems : order.items);
        const weightKg = dimensions.weight || 0.5;

        const isCod = order.payment?.method === 'cod';
        const serviceability = await shiprocketService.checkServiceability(authToken, {
          pickup_postcode: pickupPostcode,
          delivery_postcode: deliveryPostcode,
          weight: weightKg,
          cod: isCod ? 1 : 0  // Shiprocket expects 1 or 0 in query params
        });
        const bestCourier = this.selectBestCourier(serviceability);
        if (!bestCourier) {
          errors.push({ fulfillmentIndex: i, shipmentId: f.shipmentId, message: 'No courier available for route' });
          continue;
        }

        const courierCharge = this.getCourierCharge(bestCourier);

        const awbRes = await shiprocketService.assignAWB(authToken, {
          shipment_id: f.shipmentId,
          courier_id: bestCourier.courier_company_id
        });

        // Shiprocket returns AWB nested at response.data.awb_code; fall back to flat awb_code
        const awbData = awbRes?.response?.data || {};
        const awbCode = awbData.awb_code || awbRes?.awb_code || null;
        const awbAssignStatus = awbRes?.awb_assign_status;
        const courierNameFromAwb = awbData.courier_name || awbRes?.courier_name || null;

        if (!awbCode || awbAssignStatus === 0) {
          console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber} fulfillment ${i + 1}: AWB not assigned. assign_status=${awbAssignStatus}, response:`, JSON.stringify(awbRes));
          errors.push({ fulfillmentIndex: i, shipmentId: f.shipmentId, message: `AWB assignment failed (assign_status=${awbAssignStatus})` });
          continue;
        }

        // Request pickup (best-effort — don't let failure prevent AWB persistence)
        try {
          await shiprocketService.requestPickup(authToken, { shipment_id: [f.shipmentId] });
        } catch (pickupErr) {
          console.warn(`⚠️ [Shiprocket] Order ${order.orderNumber} fulfillment ${i + 1}: pickup request failed (AWB ${awbCode} still saved): ${pickupErr.message}`);
        }

        let trackRes = null;
        try {
          trackRes = await shiprocketService.trackByAWB(authToken, awbCode);
        } catch (e) {
          trackRes = { error: e.message };
        }

        f.awbCode = awbCode;
        f.courierId = bestCourier.courier_company_id;
        f.courierName = bestCourier.courier_name || courierNameFromAwb || null;
        f.shippingCharge = courierCharge;
        f.labelUrl = awbData.label || awbRes?.label || null;
        f.status = (trackRes?.tracking_data?.shipment_status) || 'processing';
        f.statusCode = trackRes?.tracking_data?.shipment_status_id || null;
        f.manifestUrl = awbRes?.manifest_url || null;
        f.invoiceUrl = awbRes?.invoice_url || null;
        f.trackingUrl = trackRes?.tracking_data?.track_url || null;
        f.updatedAt = new Date();
        fulfilledCount++;
        console.log(`✅ [Shiprocket] Order ${order.orderNumber} fulfillment ${i + 1}: AWB ${f.awbCode}, courier ${f.courierName}`);
      } catch (err) {
        console.error(`❌ [Shiprocket] Order ${order.orderNumber} fulfillment ${i + 1} (shipment ${f.shipmentId}):`, err.message);
        errors.push({ fulfillmentIndex: i, shipmentId: f.shipmentId, message: err.message });
      }
    }

    if (fulfilledCount > 0) {
      const firstWithAwb = fulfillments.find(f => f.awbCode);
      if (firstWithAwb) {
        order.shipping.trackingNumber = firstWithAwb.awbCode;
        order.shipping.carrier = firstWithAwb.courierName || order.shipping.carrier || 'Shiprocket';
        // Persist important Shiprocket fields at order level for dashboard
        order.shipping.shiprocket.awbCode = firstWithAwb.awbCode;
        order.shipping.shiprocket.courierName = firstWithAwb.courierName || null;
        order.shipping.shiprocket.courierId = firstWithAwb.courierId || null;
        order.shipping.shiprocket.labelUrl = firstWithAwb.labelUrl || null;
        order.shipping.shiprocket.manifestUrl = firstWithAwb.manifestUrl || null;
        order.shipping.shiprocket.invoiceUrl = firstWithAwb.invoiceUrl || null;
        order.shipping.shiprocket.trackingUrl = firstWithAwb.trackingUrl || null;
        order.shipping.shiprocket.shipmentId = firstWithAwb.shipmentId || null;
        order.shipping.shiprocket.orderId = firstWithAwb.orderId || null;
        order.shipping.shiprocket.status = firstWithAwb.status || order.shipping.shiprocket.status || 'processing';
        order.shipping.shiprocket.statusCode = firstWithAwb.statusCode || null;
      }
      // Total Shiprocket charge across all fulfillments (for partner billing)
      const totalCharge = fulfillments.reduce((sum, f) => sum + (Number(f.shippingCharge) || 0), 0);
      order.shipping.shiprocket.totalShippingCharge = totalCharge;
      order.shipping.shiprocket.status = order.shipping.shiprocket.status || 'processing';
      order.shipping.shiprocket.updatedAt = new Date();
      if (typeof order.updateStatus === 'function') {
        order.updateStatus('processing');
      } else {
        order.status = order.status || 'processing';
        order.statusHistory = order.statusHistory || [];
        order.statusHistory.push({ status: 'processing', at: new Date(), note: 'Shiprocket AWB assigned' });
      }
      await order.save();
    }

    return { fulfilled: fulfilledCount, errors };
  }

  /**
   * Create Shiprocket order (single payload, legacy/env pickup).
   * Prefer createShiprocketOrdersByPartner for partner-based pickup.
   * @param {Object} order - Order model instance
   * @param {Object} options - Options object
   * @param {String} [options.token] - Shiprocket token (optional)
   * @param {Object} [options.req] - Express request object (optional)
   * @returns {Promise<Object>} Response with Shiprocket order details
   */
  async createShiprocketOrder(order, { token, req } = {}) {
    const authToken = await this.getToken({ token, req });

    if (order.shipping?.shiprocket?.orderId) {
      console.log(`ℹ️  Shiprocket order already exists for order ${order.orderNumber}`);
      return {
        alreadyExists: true,
        orderId: order.shipping.shiprocket.orderId,
        response: {
          order_id: order.shipping.shiprocket.orderId,
          shipment_id: order.shipping.shiprocket.shipmentId
        }
      };
    }

    const payload = orderMapper.mapOrderToShiprocketPayload(order);
    const response = await shiprocketService.createOrder(authToken, payload);

    order.shipping = order.shipping || {};
    order.shipping.shiprocket = {
      orderId: response.order_id,
      shipmentId: response.shipment_id,
      status: response.status || 'created',
      courierName: response.courier_name || null,
      createdAt: new Date(),
    };
    order.shipping.trackingNumber = response.awb_code || order.shipping.trackingNumber;
    await order.save();

    return { response, authToken };
  }

  /**
   * Fulfill order: create order, pick courier, assign AWB, request pickup, track once.
   */
  async fulfillOrder(order, { token, req } = {}) {
    const { response, authToken } = await this.createShiprocketOrder(order, { token, req });
    
    // Calculate totals for serviceability check
    const totals = this.computeTotals(order, orderMapper.mapOrderItems(order.items));
    const shipmentId = response?.shipment_id;
    if (!shipmentId) {
      throw new Error('Shiprocket order created but no shipment_id received');
    }
    console.log("shipmentId:-", shipmentId);

    const shippingAddr =
      order.shippingAddressSnapshot ||
      (order.shippingAddress?.shippingAddress && {
        postalCode: order.shippingAddress.shippingAddress.postalCode,
      });

    const pickupPincode = process.env.SHIPROCKET_PICKUP_PINCODE;
    console.log("pickupPincode:-", pickupPincode);
    if (!pickupPincode) {
      throw new Error('SHIPROCKET_PICKUP_PINCODE is required to check courier serviceability');
    }

    // Serviceability
    const serviceability = await shiprocketService.checkServiceability(authToken, {
      pickup_postcode: pickupPincode,
      delivery_postcode: shippingAddr?.postalCode,
      weight: totals.weightKg,
      cod: order.payment?.method === 'cod' ? 1 : 0,  // Shiprocket expects 1 or 0 in query params
    });

    console.log("serviceability:-", serviceability);

    const bestCourier = this.selectBestCourier(serviceability);
    if (!bestCourier) {
      throw new Error('No courier available for this route');
    }

    const courierCharge = this.getCourierCharge(bestCourier);
    console.log("courierCharge:-", courierCharge);

    // Assign AWB with chosen courier
    const awbRes = await shiprocketService.assignAWB(authToken, {
      shipment_id: shipmentId,
      courier_id: bestCourier.courier_company_id,
    });
    console.log("awbRes:-", awbRes);

    // Request pickup
    const pickupRes = await shiprocketService.requestPickup(authToken, {
      shipment_id: [shipmentId],
    });

    // Track once (best-effort)
    let trackRes = null;
    if (awbRes?.awb_code) {
      try {
        trackRes = await shiprocketService.trackByAWB(authToken, awbRes.awb_code);
      } catch (e) {
        trackRes = { error: e.message };
      }
    }

    // Persist shipment details (including courier charge for partner billing)
    order.shipping.shiprocket = {
      ...(order.shipping.shiprocket || {}),
      orderId: response.order_id,
      shipmentId,
      awbCode: awbRes?.awb_code || order.shipping.shiprocket?.awbCode,
      courierId: bestCourier.courier_company_id,
      courierName: bestCourier.courier_name || awbRes?.courier_name || null,
      totalShippingCharge: courierCharge,
      status: trackRes?.tracking_data?.shipment_status || order.shipping.shiprocket?.status || 'processing',
      statusCode: trackRes?.tracking_data?.shipment_status_id || order.shipping.shiprocket?.statusCode,
      labelUrl: awbRes?.label || order.shipping.shiprocket?.labelUrl,
      manifestUrl: order.shipping.shiprocket?.manifestUrl,
      invoiceUrl: order.shipping.shiprocket?.invoiceUrl,
      createdAt: order.shipping.shiprocket?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    order.shipping.trackingNumber = awbRes?.awb_code || order.shipping.trackingNumber;
    order.shipping.carrier = bestCourier.courier_name || order.shipping.carrier || 'Shiprocket';

    if (typeof order.updateStatus === 'function') {
      order.updateStatus('processing');
    } else {
      order.status = 'processing';
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({ status: 'processing', at: new Date(), note: 'Shiprocket fulfillment started' });
    }

    await order.save();

    return {
      createOrder: response,
      serviceability,
      bestCourier,
      awb: awbRes,
      pickup: pickupRes,
      track: trackRes,
    };
  }
}

module.exports = new ShiprocketIntegration();

