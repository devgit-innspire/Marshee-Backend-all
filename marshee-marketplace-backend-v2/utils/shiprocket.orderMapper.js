/**
 * Shiprocket Order Mapper
 * Maps Order model to Shiprocket API format
 */

class ShiprocketOrderMapper {
  /**
   * Map order address snapshot to Shiprocket address format
   * @param {Object} addressSnapshot - Address snapshot from order
   * @returns {Object} Formatted address for Shiprocket
   */
  mapAddress(addressSnapshot) {
    if (!addressSnapshot) return null;
    const postal = (addressSnapshot.postalCode || addressSnapshot.pinCode || '').toString().trim();
    return {
      line1: addressSnapshot.line1 || addressSnapshot.street || '',
      line2: addressSnapshot.line2 || '',
      city: addressSnapshot.city || '',
      state: addressSnapshot.state || '',
      postalCode: postal,
      country: addressSnapshot.country || 'India',
      fullName: addressSnapshot.fullName || '',
      phone: addressSnapshot.phone || ''
    };
  }

  /**
   * Map order items to Shiprocket order items format
   * @param {Array} items - Order items array
   * @returns {Array} Formatted order items for Shiprocket
   */
  mapOrderItems(items) {
    if (!items || !Array.isArray(items)) return [];

    const orderItems = [];
    
    for (const item of items) {
      // Skip services - only ship products
      if (item.itemType === 'service') {
        continue;
      }

      // Populated = document with fields; unpopulated ref may still be ObjectId
      const hasProduct = item.product && typeof item.product === 'object' &&
        (item.product.name !== undefined || item.product.hsnCode !== undefined || item.product.sku !== undefined || item.product.productId !== undefined);
      const hasVariant = item.variant && typeof item.variant === 'object' &&
        (item.variant.name !== undefined || item.variant.sku !== undefined);
      // When variant ref is not populated, resolve from product.variants (embedded) if available
      const embeddedVariant = hasProduct && Array.isArray(item.product.variants) && item.variant &&
        item.product.variants.find(v => v._id && String(v._id) === String(item.variant));

      const productTitle = (hasProduct && item.product.name && String(item.product.name).trim()) || '';
      const variantTitle = (hasVariant && item.variant.name && String(item.variant.name).trim()) ||
        (embeddedVariant && embeddedVariant.name && String(embeddedVariant.name).trim()) || '';
      const productName = (item.name && String(item.name).trim()) ||
        (productTitle && variantTitle ? `${productTitle} - ${variantTitle}` : productTitle || variantTitle) ||
        (item.sku && String(item.sku).trim()) ||
        (hasProduct && item.product.sku && String(item.product.sku).trim()) ||
        (hasProduct && item.product.productId && `Product ${item.product.productId}`) ||
        (item._id && `Item ${item._id.toString().slice(-6)}`) ||
        'Product';

      const sku = (item.sku && String(item.sku).trim()) ||
        (hasVariant && item.variant.sku && String(item.variant.sku)) ||
        (embeddedVariant && embeddedVariant.sku && String(embeddedVariant.sku)) ||
        (hasProduct && item.product.sku && String(item.product.sku)) ||
        `SKU-${item._id || ''}`;

      // Line name: "Product Name - Variant Name (SKU: VAR-001)" so invoice shows product, variant, and variant SKU
      const nameWithSku = sku ? `${String(productName).trim()} (SKU: ${sku})` : String(productName).trim();
      const nameForShiprocket = (nameWithSku || 'Product').substring(0, 200);

      const hsn = (item.hsn != null && String(item.hsn).trim()) ||
        (hasProduct && item.product.hsnCode != null && String(item.product.hsnCode).trim()) ||
        '';
      // Shiprocket: HSN must be numeric (digits only), length 1–15, and sent as string.
      const hsnStr = (hsn && String(hsn).trim()) ? String(hsn) : '';
      const hsnDigits = hsnStr.replace(/\D/g, '');
      const hsnForShiprocket = (hsnDigits.length >= 1 && hsnDigits.length <= 15)
        ? hsnDigits
        : (hsnDigits.length > 15 ? hsnDigits.slice(0, 15) : '998399');

      // Calculate selling price (price after discount)
      const sellingPrice = item.price || item.originalPrice || 0;
      const discount = item.discount || 0;
      
      orderItems.push({
        name: nameForShiprocket,
        sku,
        units: item.quantity || 1,
        selling_price: sellingPrice,
        discount: discount || '',
        tax: item.taxAmount || '',
        hsn: String(hsnForShiprocket)
      });
    }

    return orderItems;
  }

  /**
   * Calculate order dimensions and weight from items
   * @param {Array} items - Order items array
   * @returns {Object} Dimensions and weight
   */
  calculateDimensionsAndWeight(items) {
    if (!items || !Array.isArray(items)) {
      return {
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5
      };
    }

    let totalWeightGrams = 0;
    let maxLength = 10;
    let maxBreadth = 10;
    let maxHeight = 10;

    items.forEach(item => {
      // Skip services
      if (item.itemType === 'service') return;

      const quantity = item.quantity || 1;
      
      // Calculate weight
      const itemWeightGrams = item.weightGrams || 
                             item.dimensions?.weight || 
                             500; // default 500g per item
      totalWeightGrams += itemWeightGrams * quantity;

      // Calculate dimensions (use max dimensions from all items)
      if (item.dimensions) {
        if (item.dimensions.lengthCm) {
          maxLength = Math.max(maxLength, item.dimensions.lengthCm);
        }
        if (item.dimensions.widthCm) {
          maxBreadth = Math.max(maxBreadth, item.dimensions.widthCm);
        }
        if (item.dimensions.heightCm) {
          maxHeight = Math.max(maxHeight, item.dimensions.heightCm);
        }
      }
    });

    // Convert grams to kg, minimum 0.5kg
    const weightKg = Math.max(totalWeightGrams / 1000, 0.5);

    return {
      length: maxLength,
      breadth: maxBreadth,
      height: maxHeight,
      weight: weightKg
    };
  }

  /**
   * Extract customer name from address or contact
   * @param {Object} addressSnapshot - Address snapshot
   * @param {Object} contact - Contact info
   * @returns {String} Customer name
   */
  extractCustomerName(addressSnapshot, contact) {
    if (addressSnapshot?.fullName) {
      return addressSnapshot.fullName.substring(0, 50);
    }
    
    // Try to extract from line1 if it contains a name
    if (addressSnapshot?.line1) {
      const parts = addressSnapshot.line1.split(',');
      if (parts[0]) {
        return parts[0].trim().substring(0, 50);
      }
    }
    
    return 'Customer';
  }

  /**
   * Extract phone number from address, contact, or user. Returns only valid 10-digit Indian phone; never 9999999999 (Shiprocket rejects it).
   * @param {Object} addressSnapshot - Address snapshot
   * @param {Object} contact - Contact info
   * @param {Object} user - User object (if populated)
   * @returns {Number} 10-digit phone number
   */
  extractPhone(addressSnapshot, contact, user) {
    const sources = [
      addressSnapshot?.phone,
      contact?.phone,
      user?.phoneNumber
    ].filter(Boolean);

    for (const raw of sources) {
      const digits = raw.toString().replace(/\D/g, '');
      if (digits.length >= 10) {
        const num = parseInt(digits.slice(-10), 10); // last 10 digits for Indian number
        if (num > 0 && num < 10000000000) return num;
      }
    }

    throw new Error('Valid billing/shipping phone required for Shiprocket order. Ensure order has contact.phone, address phone, or user.phoneNumber.');
  }

  /**
   * Extract email from contact or user
   * @param {Object} contact - Contact info
   * @param {Object} user - User object (if populated)
   * @returns {String} Email address
   */
  extractEmail(contact, user) {
    if (contact?.email) return contact.email;
    if (user?.email) return user.email;
    return '';
  }

  /**
   * Format order date for Shiprocket
   * @param {Date} date - Order date
   * @returns {String} Formatted date string (YYYY-MM-DD HH:mm)
   */
  formatOrderDate(date) {
    if (!date) {
      date = new Date();
    }
    
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * Map complete order to Shiprocket create order payload
   * @param {Object} order - Order model instance
   * @returns {Object} Shiprocket order payload
   */
  mapOrderToShiprocketPayload(order) {
    // Get addresses
    const shippingAddr = this.mapAddress(order.shippingAddressSnapshot);
    const billingAddr = this.mapAddress(order.billingAddressSnapshot) || shippingAddr;

    if (!shippingAddr) {
      throw new Error('Shipping address is required for Shiprocket order');
    }

    const shippingPostal = (shippingAddr.postalCode || '').toString().trim();
    const billingPostal = (billingAddr?.postalCode || '').toString().trim();
    const effectiveShippingPostal = shippingPostal || billingPostal;
    if (!effectiveShippingPostal) {
      throw new Error('Shipping postal code is required for Shiprocket order');
    }
    shippingAddr.postalCode = effectiveShippingPostal;

    // Get order items
    const orderItems = this.mapOrderItems(order.items);
    
    if (orderItems.length === 0) {
      throw new Error('Order must contain at least one shippable item (products only, services are excluded)');
    }

    // Calculate dimensions and weight
    const dimensions = this.calculateDimensionsAndWeight(order.items);

    // Extract customer info
    const billingCustomerName = this.extractCustomerName(billingAddr, order.contact);
    const billingPhone = this.extractPhone(billingAddr, order.contact, order.user);
    const billingEmail = this.extractEmail(order.contact, order.user);

    // Determine if shipping is same as billing
    const shippingIsBilling = !order.billingAddressSnapshot || 
                              (order.shippingAddressSnapshot?.postalCode === order.billingAddressSnapshot?.postalCode &&
                               order.shippingAddressSnapshot?.line1 === order.billingAddressSnapshot?.line1);

    // Split customer name into first and last name
    const nameParts = billingCustomerName.split(' ');
    const billingFirstName = nameParts[0] || 'Customer';
    const billingLastName = nameParts.slice(1).join(' ') || '';

    // Build payload
    const payload = {
      order_id: order.orderNumber || order._id.toString(),
      order_date: this.formatOrderDate(order.createdAt),
      pickup_location: process.env.SHIPROCKET_PICKUP_NAME || 'Primary',
      billing_customer_name: billingFirstName.substring(0, 50),
      billing_last_name: billingLastName.substring(0, 50),
      billing_address: (billingAddr.line1 || '').substring(0, 200),
      billing_address_2: (billingAddr.line2 || '').substring(0, 200),
      billing_city: (billingAddr.city || '').substring(0, 30),
      billing_pincode: parseInt(billingAddr.postalCode || '0', 10),
      billing_state: (billingAddr.state || '').substring(0, 30),
      billing_country: (billingAddr.country || 'India').substring(0, 30),
      billing_email: billingEmail,
      billing_phone: billingPhone,
      shipping_is_billing: shippingIsBilling,
      order_items: orderItems,
      payment_method: order.payment?.method === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges: order.shippingCost || 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: order.totalDiscount || 0,
      sub_total: order.subtotal || 0,
      length: dimensions.length,
      breadth: dimensions.breadth,
      height: dimensions.height,
      weight: dimensions.weight
    };

    // Add shipping address fields if different from billing
    if (!shippingIsBilling) {
      const shippingCustomerName = this.extractCustomerName(shippingAddr, order.contact);
      const shippingPhone = this.extractPhone(shippingAddr, order.contact, order.user);
      const shippingEmail = this.extractEmail(order.contact, order.user);
      
      // Split shipping name into first and last name
      const shippingNameParts = shippingCustomerName.split(' ');
      const shippingFirstName = shippingNameParts[0] || 'Customer';
      const shippingLastName = shippingNameParts.slice(1).join(' ') || '';

      payload.shipping_customer_name = shippingFirstName.substring(0, 50);
      payload.shipping_last_name = shippingLastName.substring(0, 50);
      payload.shipping_address = (shippingAddr.line1 || '').substring(0, 200);
      payload.shipping_address_2 = (shippingAddr.line2 || '').substring(0, 200);
      payload.shipping_city = (shippingAddr.city || '').substring(0, 30);
      payload.shipping_pincode = parseInt(shippingAddr.postalCode || '0', 10);
      payload.shipping_state = (shippingAddr.state || '').substring(0, 30);
      payload.shipping_country = (shippingAddr.country || 'India').substring(0, 30);
      payload.shipping_email = shippingEmail;
      payload.shipping_phone = shippingPhone;
    } else {
      // Set empty strings for shipping fields when same as billing
      payload.shipping_customer_name = '';
      payload.shipping_last_name = '';
      payload.shipping_address = '';
      payload.shipping_address_2 = '';
      payload.shipping_city = '';
      payload.shipping_pincode = '';
      payload.shipping_state = '';
      payload.shipping_country = '';
      payload.shipping_email = '';
      payload.shipping_phone = '';
    }

    // Add optional fields if available
    if (order.notes?.internal) {
      payload.comment = order.notes.internal.substring(0, 200);
    }

    return payload;
  }

  /**
   * Map a subset of order items to one Shiprocket order payload (one per partner).
   * Uses the same delivery address as the main order; only items and pickup_location differ.
   * When customer buys from multiple partners, create one Shiprocket order per partner.
   * @param {Object} order - Order model instance
   * @param {Array} itemsSubset - Order items for this partner (products only)
   * @param {String} pickupLocationName - Partner's pickup location name (must exist in Shiprocket)
   * @param {String} orderIdSuffix - Unique suffix for order_id (e.g. partnerId or 'NP')
   * @param {Object} [options] - Optional overrides
   * @param {Object} [options.partner] - Partner document for GST, reseller_name, company_name
   * @returns {Object} Shiprocket order payload
   */
  mapOrderToShiprocketPayloadForPartner(order, itemsSubset, pickupLocationName, orderIdSuffix, options = {}) {
    const { partner } = options;
    const shippingAddr = this.mapAddress(order.shippingAddressSnapshot);
    let billingAddr = this.mapAddress(order.billingAddressSnapshot) || shippingAddr;

    if (!shippingAddr) {
      throw new Error('Shipping address is required for Shiprocket order');
    }

    // We only collect shipping address; billing = shipping, shipping_is_billing = true always
    const fallback = (b, s) => (b && String(b).trim()) ? String(b).trim() : (s && String(s).trim()) || '';
    billingAddr = {
      line1: fallback(billingAddr?.line1, shippingAddr.line1) || 'Address not provided',
      line2: fallback(billingAddr?.line2, shippingAddr.line2),
      city: fallback(billingAddr?.city, shippingAddr.city) || 'N/A',
      state: fallback(billingAddr?.state, shippingAddr.state) || 'N/A',
      postalCode: fallback(billingAddr?.postalCode, shippingAddr.postalCode) || shippingAddr.postalCode || '',
      country: fallback(billingAddr?.country, shippingAddr.country) || 'India',
      fullName: fallback(billingAddr?.fullName, shippingAddr.fullName),
      phone: fallback(billingAddr?.phone, shippingAddr.phone)
    };

    const effectivePostal = (shippingAddr.postalCode || billingAddr.postalCode || '').toString().trim();
    if (!effectivePostal) {
      throw new Error('Shipping postal code is required for Shiprocket order');
    }
    billingAddr.postalCode = effectivePostal;

    const orderItems = this.mapOrderItems(itemsSubset);
    if (orderItems.length === 0) {
      throw new Error('Items subset must contain at least one shippable product');
    }

    const dimensions = this.calculateDimensionsAndWeight(itemsSubset);

    const billingCustomerName = this.extractCustomerName(billingAddr, order.contact);
    const billingPhone = this.extractPhone(billingAddr, order.contact, order.user);
    const billingEmail = this.extractEmail(order.contact, order.user);

    const nameParts = billingCustomerName.split(' ');
    const billingFirstName = nameParts[0] || 'Customer';
    const billingLastName = nameParts.slice(1).join(' ') || '';

    const subsetSubtotal = itemsSubset.reduce((sum, item) => {
      const price = item.price ?? item.originalPrice ?? 0;
      const discount = item.discount ?? 0;
      const qty = item.quantity ?? 1;
      return sum + (price - discount) * qty;
    }, 0);
    const subsetDiscount = itemsSubset.reduce((sum, item) => sum + (item.discount ?? 0) * (item.quantity ?? 1), 0);

    const payload = {
      order_id: `${order.orderNumber || order._id}-${orderIdSuffix}`,
      order_date: this.formatOrderDate(order.createdAt),
      pickup_location: pickupLocationName,
      comment: (order.notes?.internal || '').toString().substring(0, 200),
      reseller_name: (partner?.name || '').toString().substring(0, 100),
      company_name: (partner?.name || '').toString().substring(0, 100),
      billing_customer_name: billingFirstName.substring(0, 50),
      billing_last_name: billingLastName.substring(0, 50),
      billing_address: (billingAddr.line1 || '').substring(0, 200),
      billing_address_2: (billingAddr.line2 || '').substring(0, 200),
      billing_isd_code: '+91',
      billing_city: (billingAddr.city || '').substring(0, 30),
      billing_pincode: parseInt(billingAddr.postalCode || '0', 10),
      billing_state: (billingAddr.state || '').substring(0, 30),
      billing_country: (billingAddr.country || 'India').substring(0, 30),
      billing_email: billingEmail || '',
      billing_phone: billingPhone,
      billing_alternate_phone: '',
      shipping_is_billing: true,
      shipping_customer_name: '',
      shipping_last_name: '',
      shipping_address: '',
      shipping_address_2: '',
      shipping_city: '',
      shipping_pincode: '',
      shipping_country: '',
      shipping_state: '',
      shipping_email: '',
      shipping_phone: '',
      order_items: orderItems,
      payment_method: order.payment?.method === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges: 0,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: subsetDiscount,
      sub_total: subsetSubtotal,
      length: dimensions.length,
      breadth: dimensions.breadth,
      height: dimensions.height,
      weight: dimensions.weight,
      ewaybill_no: '',
      customer_gstin: (partner?.legal?.gstin || '').toString().substring(0, 20),
      invoice_number: `${order.orderNumber || order._id}-${orderIdSuffix}`,
      order_type: ''
    };

    return payload;
  }
}

module.exports = new ShiprocketOrderMapper();

