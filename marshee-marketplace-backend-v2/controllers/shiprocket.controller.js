const shiprocketService = require('../utils/shiprocket.service');
const shiprocketIntegration = require('../utils/shiprocket.integration');
const Product = require('../models/product.model');
const Partner = require('../models/partner.model');
const Order = require('../models/order.model');
const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');

/**
 * Shiprocket Controller
 */
class ShiprocketController {
  /**
   * Login to Shiprocket
   * POST /api/v1/shiprocket/login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      console.log("email:-", email);

      // Validate input
      if (!email || !password) {
        throw new ErrorResponse('Email and password are required', StatusCodes.BAD_REQUEST);
      }

      // Call Shiprocket login API
      const response = await shiprocketService.login(email, password);
      console.log('Shiprocket auth successful');

      if (response && response.token) {
        return res.status(StatusCodes.OK).json({
          success: true,
          message: 'Login successful',
          data: {
            token: response.token,
            expiresIn: response.expires_in || null
          }
        });
      }

      throw new ErrorResponse('Failed to get token from Shiprocket', StatusCodes.INTERNAL_SERVER_ERROR);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check serviceability - Get available courier companies
   * GET /api/v1/shiprocket/serviceability
   */
  async checkServiceability(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Get query parameters (GET request uses query params, not body)
      const {
        order_id,
        pickup_postcode,
        delivery_postcode,
        weight,
        cod,
        length,
        breadth,
        height,
        declared_value,
        mode,
        is_return,
        couriers_type,
        only_local,
        qc_check
      } = req.query;

      // Validate: Either order_id OR (pickup_postcode, delivery_postcode, weight, cod) must be provided
      if (!order_id) {
        if (!pickup_postcode || !delivery_postcode) {
          throw new ErrorResponse(
            'Either order_id OR (pickup_postcode and delivery_postcode) must be provided',
            StatusCodes.BAD_REQUEST
          );
        }
        if (weight === undefined || cod === undefined) {
          throw new ErrorResponse(
            'When using postcodes, both weight and cod are required',
            StatusCodes.BAD_REQUEST
          );
        }
      }

      // Prepare serviceability parameters
      const serviceabilityParams = {};
      
      if (order_id) {
        serviceabilityParams.order_id = order_id;
      } else {
        serviceabilityParams.pickup_postcode = pickup_postcode;
        serviceabilityParams.delivery_postcode = delivery_postcode;
        serviceabilityParams.weight = weight;
        serviceabilityParams.cod = cod === 'true' || cod === '1' || cod === true ? 1 : 0;
      }

      // Add optional parameters
      if (length) serviceabilityParams.length = parseInt(length);
      if (breadth) serviceabilityParams.breadth = parseInt(breadth);
      if (height) serviceabilityParams.height = parseInt(height);
      if (declared_value) serviceabilityParams.declared_value = parseInt(declared_value);
      if (mode) serviceabilityParams.mode = mode;
      if (is_return !== undefined) serviceabilityParams.is_return = is_return === 'true' || is_return === '1' ? 1 : 0;
      if (couriers_type) serviceabilityParams.couriers_type = parseInt(couriers_type);
      if (only_local) serviceabilityParams.only_local = parseInt(only_local);
      if (qc_check) serviceabilityParams.qc_check = parseInt(qc_check);

      // Call Shiprocket serviceability API
      const response = await shiprocketService.checkServiceability(token, serviceabilityParams);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Serviceability checked successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check delivery - Predict delivery time for a product to a pincode (for product detail page).
   * Uses Shiprocket serviceability; pickup from product's partner or env SHIPROCKET_PICKUP_PINCODE.
   * GET /api/v1/shiprocket/check-delivery?productId=...&delivery_postcode=...&variantId=...
   * No auth required (uses env SHIPROCKET_EMAIL/PASSWORD if no Bearer token).
   */
  async checkDelivery(req, res, next) {
    try {
      const { productId, delivery_postcode, variantId } = req.query;

      console.log('req.query:-', req.query);

      if (!productId || !delivery_postcode) {
        throw new ErrorResponse('productId and delivery_postcode are required', StatusCodes.BAD_REQUEST);
      }

      const deliveryPostcode = String(delivery_postcode).trim();
      if (!/^\d{6}$/.test(deliveryPostcode)) {
        throw new ErrorResponse('delivery_postcode must be a 6-digit Indian pincode', StatusCodes.BAD_REQUEST);
      }

      const product = await Product.findById(productId)
        .populate('partner')
        .select('partner dimensions variants')
        .lean();

      if (!product) {
        throw new ErrorResponse('Product not found', StatusCodes.NOT_FOUND);
      }

      let pickupPostcode = process.env.SHIPROCKET_PICKUP_PINCODE || '';
      if (product.partner && typeof product.partner === 'object') {
        const partner = await Partner.findById(product.partner._id).select('shiprocket').lean();
        const firstPickup = partner?.shiprocket?.pickupLocations?.[0];
        if (firstPickup?.pin_code) {
          pickupPostcode = String(firstPickup.pin_code).trim();
        }
      }
      if (!pickupPostcode) {
        throw new ErrorResponse(
          'Pickup pincode not configured for this product. Set SHIPROCKET_PICKUP_PINCODE or add partner pickup.',
          StatusCodes.BAD_REQUEST
        );
      }

      let weightGrams = product.dimensions?.weight_g || 500;
      if (variantId && Array.isArray(product.variants)) {
        const variant = product.variants.find(
          v => String(v._id) === String(variantId) || String((v).variantId) === String(variantId)
        );
        if (variant?.dimensions?.weight) {
          weightGrams = Number(variant.dimensions.weight);
        }
      }
      const weightKg = Math.max(weightGrams / 1000, 0.5);

      // Use env credentials only (do not use req Authorization — frontend may send user JWT)
      const token = await shiprocketIntegration.getToken({}).catch(() => null);
      if (!token) {
        throw new ErrorResponse(
          'Shiprocket not configured. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD.',
          StatusCodes.SERVICE_UNAVAILABLE
        );
      }

      const response = await shiprocketService.checkServiceability(token, {
        pickup_postcode: pickupPostcode,
        delivery_postcode: deliveryPostcode,
        weight: weightKg,
        cod: 0
      });

      const bestCourier = shiprocketIntegration.selectBestCourier(response);
      if (!bestCourier) {
        return res.status(StatusCodes.OK).json({
          success: true,
          data: {
            deliverable: false,
            message: 'We don\'t deliver to this pincode yet.'
          }
        });
      }

      const estimatedDays = bestCourier.estimated_delivery_days || bestCourier.edd_hours;
      const etd = bestCourier.etd || null;
      const rate = shiprocketIntegration.getCourierCharge(bestCourier);

      return res.status(StatusCodes.OK).json({
        success: true,
        data: {
          deliverable: true,
          estimated_delivery_days: estimatedDays ? String(estimatedDays) : null,
          etd: etd || null,
          courier_name: bestCourier.courier_name || null,
          rate: rate > 0 ? rate : null,
          message: etd
            ? `Delivery by ${etd}`
            : (estimatedDays ? `Usually delivered in ${estimatedDays} business days` : 'Delivery available')
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create order - Create a custom order in Shiprocket
   * POST /api/v1/shiprocket/orders/create
   */
  async createOrder(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const {
        order_id,
        order_date,
        pickup_location,
        channel_id,
        comment,
        reseller_name,
        company_name,
        billing_customer_name,
        billing_last_name,
        billing_address,
        billing_address_2,
        billing_isd_code,
        billing_city,
        billing_pincode,
        billing_state,
        billing_country,
        billing_email,
        billing_phone,
        billing_alternate_phone,
        shipping_is_billing,
        shipping_customer_name,
        shipping_last_name,
        shipping_address,
        shipping_address_2,
        shipping_city,
        shipping_pincode,
        shipping_country,
        shipping_state,
        shipping_email,
        shipping_phone,
        order_items,
        payment_method,
        shipping_charges,
        giftwrap_charges,
        transaction_charges,
        total_discount,
        sub_total,
        length,
        breadth,
        height,
        weight,
        longitude,
        latitude,
        ewaybill_no,
        customer_gstin,
        invoice_number,
        order_type,
        checkout_shipping_method,
        what3words_address,
        is_insurance_opt,
        is_document,
        order_tag
      } = req.body;

      // Validate required fields
      if (!order_id || order_id === '') {
        throw new ErrorResponse('order_id is required', StatusCodes.BAD_REQUEST);
      }
      if (!order_date || order_date === '') {
        throw new ErrorResponse('order_date is required', StatusCodes.BAD_REQUEST);
      }
      if (!pickup_location || pickup_location === '') {
        throw new ErrorResponse('pickup_location is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_customer_name || billing_customer_name === '') {
        throw new ErrorResponse('billing_customer_name is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_address || billing_address === '') {
        throw new ErrorResponse('billing_address is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_city || billing_city === '') {
        throw new ErrorResponse('billing_city is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_pincode || billing_pincode === '') {
        throw new ErrorResponse('billing_pincode is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_state || billing_state === '') {
        throw new ErrorResponse('billing_state is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_country || billing_country === '') {
        throw new ErrorResponse('billing_country is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_email || billing_email === '') {
        throw new ErrorResponse('billing_email is required', StatusCodes.BAD_REQUEST);
      }
      if (!billing_phone || billing_phone === '') {
        throw new ErrorResponse('billing_phone is required', StatusCodes.BAD_REQUEST);
      }
      if (shipping_is_billing === '' || shipping_is_billing === undefined || shipping_is_billing === null) {
        throw new ErrorResponse('shipping_is_billing is required', StatusCodes.BAD_REQUEST);
      }
      if (!order_items || !Array.isArray(order_items) || order_items.length === 0) {
        throw new ErrorResponse('order_items is required and must not be empty', StatusCodes.BAD_REQUEST);
      }
      if (!payment_method || payment_method === '') {
        throw new ErrorResponse('payment_method is required', StatusCodes.BAD_REQUEST);
      }
      if (!sub_total || sub_total === '') {
        throw new ErrorResponse('sub_total is required', StatusCodes.BAD_REQUEST);
      }
      if (!length || length === '') {
        throw new ErrorResponse('length is required', StatusCodes.BAD_REQUEST);
      }
      if (!breadth || breadth === '') {
        throw new ErrorResponse('breadth is required', StatusCodes.BAD_REQUEST);
      }
      if (!height || height === '') {
        throw new ErrorResponse('height is required', StatusCodes.BAD_REQUEST);
      }
      if (!weight || weight === '') {
        throw new ErrorResponse('weight is required', StatusCodes.BAD_REQUEST);
      }

      // Validate order_items required fields
      for (let i = 0; i < order_items.length; i++) {
        const item = order_items[i];
        if (!item.name || item.name === '') {
          throw new ErrorResponse(`order_items[${i}].name is required`, StatusCodes.BAD_REQUEST);
        }
        if (!item.sku || item.sku === '') {
          throw new ErrorResponse(`order_items[${i}].sku is required`, StatusCodes.BAD_REQUEST);
        }
        if (!item.units || item.units === '') {
          throw new ErrorResponse(`order_items[${i}].units is required`, StatusCodes.BAD_REQUEST);
        }
        if (!item.selling_price || item.selling_price === '') {
          throw new ErrorResponse(`order_items[${i}].selling_price is required`, StatusCodes.BAD_REQUEST);
        }
      }

      // Validate shipping address if shipping_is_billing is false
      const isShippingSameAsBilling = shipping_is_billing === true || shipping_is_billing === 1 || shipping_is_billing === 'true' || shipping_is_billing === '1';
      if (!isShippingSameAsBilling) {
        if (!shipping_customer_name || shipping_customer_name === '') {
          throw new ErrorResponse('shipping_customer_name is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_address || shipping_address === '') {
          throw new ErrorResponse('shipping_address is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_city || shipping_city === '') {
          throw new ErrorResponse('shipping_city is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_pincode || shipping_pincode === '') {
          throw new ErrorResponse('shipping_pincode is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_country || shipping_country === '') {
          throw new ErrorResponse('shipping_country is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_state || shipping_state === '') {
          throw new ErrorResponse('shipping_state is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
        if (!shipping_phone || shipping_phone === '') {
          throw new ErrorResponse('shipping_phone is required when shipping_is_billing is false', StatusCodes.BAD_REQUEST);
        }
      }

      // Prepare order data - convert empty strings to "" or 0
      const orderData = {
        order_id,
        order_date,
        pickup_location,
        billing_customer_name,
        billing_address,
        billing_city,
        billing_pincode: billing_pincode === '' ? '' : parseInt(billing_pincode),
        billing_state,
        billing_country,
        billing_email,
        billing_phone: billing_phone === '' ? '' : parseInt(billing_phone),
        shipping_is_billing: isShippingSameAsBilling,
        order_items: order_items.map(item => ({
          name: item.name,
          sku: item.sku,
          units: item.units === '' ? '' : parseInt(item.units),
          selling_price: item.selling_price === '' ? '' : parseFloat(item.selling_price),
          discount: item.discount === '' || item.discount === undefined || item.discount === null ? '' : parseFloat(item.discount),
          tax: item.tax === '' || item.tax === undefined || item.tax === null ? '' : parseFloat(item.tax),
          hsn: item.hsn === '' || item.hsn === undefined || item.hsn === null ? '' : item.hsn
        })),
        payment_method,
        sub_total: sub_total === '' ? '' : parseFloat(sub_total),
        length: length === '' ? '' : parseFloat(length),
        breadth: breadth === '' ? '' : parseFloat(breadth),
        height: height === '' ? '' : parseFloat(height),
        weight: weight === '' ? '' : parseFloat(weight)
      };

      // Add optional fields - convert empty strings to "" or 0
      if (channel_id !== undefined && channel_id !== '') {
        orderData.channel_id = parseInt(channel_id);
      }
      if (comment !== undefined && comment !== '') {
        orderData.comment = comment;
      }
      if (reseller_name !== undefined && reseller_name !== '') {
        orderData.reseller_name = reseller_name;
      }
      if (company_name !== undefined && company_name !== '') {
        orderData.company_name = company_name;
      }
      if (billing_last_name !== undefined && billing_last_name !== '') {
        orderData.billing_last_name = billing_last_name;
      }
      if (billing_address_2 !== undefined && billing_address_2 !== '') {
        orderData.billing_address_2 = billing_address_2;
      }
      if (billing_isd_code !== undefined && billing_isd_code !== '') {
        orderData.billing_isd_code = billing_isd_code;
      }
      if (billing_alternate_phone !== undefined && billing_alternate_phone !== '') {
        orderData.billing_alternate_phone = parseInt(billing_alternate_phone);
      }
      if (shipping_charges !== undefined && shipping_charges !== '') {
        orderData.shipping_charges = parseFloat(shipping_charges);
      } else if (shipping_charges === '') {
        orderData.shipping_charges = 0;
      }
      if (giftwrap_charges !== undefined && giftwrap_charges !== '') {
        orderData.giftwrap_charges = parseFloat(giftwrap_charges);
      } else if (giftwrap_charges === '') {
        orderData.giftwrap_charges = 0;
      }
      if (transaction_charges !== undefined && transaction_charges !== '') {
        orderData.transaction_charges = parseFloat(transaction_charges);
      } else if (transaction_charges === '') {
        orderData.transaction_charges = 0;
      }
      if (total_discount !== undefined && total_discount !== '') {
        orderData.total_discount = parseFloat(total_discount);
      } else if (total_discount === '') {
        orderData.total_discount = 0;
      }
      if (longitude !== undefined && longitude !== '') {
        orderData.longitude = parseFloat(longitude);
      }
      if (latitude !== undefined && latitude !== '') {
        orderData.latitude = parseFloat(latitude);
      }
      if (ewaybill_no !== undefined && ewaybill_no !== '') {
        orderData.ewaybill_no = ewaybill_no;
      }
      if (customer_gstin !== undefined && customer_gstin !== '') {
        orderData.customer_gstin = customer_gstin;
      }
      if (invoice_number !== undefined && invoice_number !== '') {
        orderData.invoice_number = invoice_number;
      }
      if (order_type !== undefined && order_type !== '') {
        orderData.order_type = order_type;
      }
      if (checkout_shipping_method !== undefined && checkout_shipping_method !== '') {
        orderData.checkout_shipping_method = checkout_shipping_method;
      }
      if (what3words_address !== undefined && what3words_address !== '') {
        orderData.what3words_address = what3words_address;
      }
      if (is_insurance_opt !== undefined && is_insurance_opt !== '') {
        orderData.is_insurance_opt = is_insurance_opt === true || is_insurance_opt === 1 || is_insurance_opt === 'true';
      }
      if (is_document !== undefined && is_document !== '') {
        orderData.is_document = is_document === 1 || is_document === '1' ? 1 : 0;
      }
      if (order_tag !== undefined && order_tag !== '') {
        orderData.order_tag = order_tag;
      }

      // Handle shipping address fields
      if (!isShippingSameAsBilling) {
        orderData.shipping_customer_name = shipping_customer_name;
        orderData.shipping_address = shipping_address;
        orderData.shipping_city = shipping_city;
        orderData.shipping_pincode = shipping_pincode === '' ? '' : parseInt(shipping_pincode);
        orderData.shipping_country = shipping_country;
        orderData.shipping_state = shipping_state;
        orderData.shipping_phone = shipping_phone === '' ? '' : parseInt(shipping_phone);
        
        if (shipping_last_name !== undefined && shipping_last_name !== '') {
          orderData.shipping_last_name = shipping_last_name;
        }
        if (shipping_address_2 !== undefined && shipping_address_2 !== '') {
          orderData.shipping_address_2 = shipping_address_2;
        }
        if (shipping_email !== undefined && shipping_email !== '') {
          orderData.shipping_email = shipping_email;
        }
      } else {
        // If shipping is same as billing, set empty strings for shipping fields
        orderData.shipping_customer_name = '';
        orderData.shipping_last_name = '';
        orderData.shipping_address = '';
        orderData.shipping_address_2 = '';
        orderData.shipping_city = '';
        orderData.shipping_pincode = '';
        orderData.shipping_country = '';
        orderData.shipping_state = '';
        orderData.shipping_email = '';
        orderData.shipping_phone = '';
      }

      // Call Shiprocket create order API
      const response = await shiprocketService.createOrder(token, orderData);
      console.log('Shiprocket order created successfully');

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: 'Order created successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel order(s) - Cancel one or more orders in Shiprocket
   * POST /api/v1/shiprocket/orders/cancel
   */
  async cancelOrder(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const { ids } = req.body;

      // Validate ids array
      if (!ids || !Array.isArray(ids)) {
        throw new ErrorResponse('ids is required and must be an array', StatusCodes.BAD_REQUEST);
      }

      if (ids.length === 0) {
        throw new ErrorResponse('ids array must contain at least one order ID', StatusCodes.BAD_REQUEST);
      }

      // Validate that all ids are numbers
      const invalidIds = ids.filter(id => isNaN(id) || id === null || id === undefined || id === '');
      if (invalidIds.length > 0) {
        throw new ErrorResponse('All order IDs must be valid numbers', StatusCodes.BAD_REQUEST);
      }

      // Convert all ids to numbers
      const orderIds = ids.map(id => parseInt(id));

      // Call Shiprocket cancel order API
      const response = await shiprocketService.cancelOrder(token, orderIds);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Order(s) cancelled successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all pickup locations - Get list of all pickup locations in Shiprocket account
   * GET /api/v1/shiprocket/pickup-locations
   */
  async getPickupLocations(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Call Shiprocket get pickup locations API
      const response = await shiprocketService.getPickupLocations(token);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Pickup locations retrieved successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add pickup location - Create a pickup address in Shiprocket
   * POST /api/v1/shiprocket/pickup-locations
   */
  async addPickupLocation(req, res, next) {
    try {
      // Token priority: explicit Bearer token header, else env login (SHIPROCKET_EMAIL/PASSWORD)
      const token = await shiprocketIntegration.getToken({ req });

      const {
        pickup_location,
        name,
        email,
        phone,
        address,
        address_2,
        city,
        state,
        country,
        pin_code
      } = req.body;

      // Validate required fields
      if (!pickup_location || pickup_location === '') {
        throw new ErrorResponse('pickup_location is required', StatusCodes.BAD_REQUEST);
      }
      if (!name || name === '') {
        throw new ErrorResponse('name is required', StatusCodes.BAD_REQUEST);
      }
      if (!email || email === '') {
        throw new ErrorResponse('email is required', StatusCodes.BAD_REQUEST);
      }
      if (!phone && phone !== 0) {
        throw new ErrorResponse('phone is required', StatusCodes.BAD_REQUEST);
      }
      if (!address || address === '') {
        throw new ErrorResponse('address is required', StatusCodes.BAD_REQUEST);
      }
      if (!city || city === '') {
        throw new ErrorResponse('city is required', StatusCodes.BAD_REQUEST);
      }
      if (!state || state === '') {
        throw new ErrorResponse('state is required', StatusCodes.BAD_REQUEST);
      }
      if (!country || country === '') {
        throw new ErrorResponse('country is required', StatusCodes.BAD_REQUEST);
      }
      if (!pin_code && pin_code !== 0) {
        throw new ErrorResponse('pin_code is required', StatusCodes.BAD_REQUEST);
      }

      const pickupData = {
        pickup_location: String(pickup_location).trim(),
        name: String(name).trim(),
        email: String(email).trim(),
        phone: String(phone).trim(),
        address: String(address).trim(),
        address_2: address_2 === undefined || address_2 === null ? '' : String(address_2),
        city: String(city).trim(),
        state: String(state).trim(),
        country: String(country).trim(),
        pin_code: String(pin_code).trim()
      };

      const response = await shiprocketService.addPickupLocation(token, pickupData);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: 'Pickup location created successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all orders - Get list of all orders with optional filters and pagination
   * GET /api/v1/shiprocket/orders
   */
  async getOrders(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Get query parameters
      const {
        page,
        per_page,
        sort,
        sort_by,
        to,
        from,
        filter_by,
        filter,
        search,
        pickup_location,
        channel_id,
        fbs,
        updated_from,
        updated_to
      } = req.query;

      // Validate date parameters according to Shiprocket rules
      if (updated_to && !updated_from) {
        throw new ErrorResponse('Please send updated_from date along with updated_to date', StatusCodes.BAD_REQUEST);
      }

      if (updated_from && updated_to) {
        const fromDate = new Date(updated_from);
        const toDate = new Date(updated_to);
        const currentDate = new Date();
        
        // Check if difference is greater than 30 days
        const diffTime = Math.abs(toDate - fromDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 30) {
          throw new ErrorResponse('Difference between updated_from and updated_to date should not be greater than 30 days', StatusCodes.BAD_REQUEST);
        }

        // Check if updated_from is less than 30 days from current date
        const daysFromNow = Math.ceil((currentDate - fromDate) / (1000 * 60 * 60 * 24));
        if (daysFromNow < 30) {
          throw new ErrorResponse('Updated_from date should not be less than 30 days from current date', StatusCodes.BAD_REQUEST);
        }
      }

      // Prepare query parameters
      const queryParams = {};

      if (page) queryParams.page = parseInt(page);
      if (per_page) queryParams.per_page = parseInt(per_page);
      if (sort) queryParams.sort = sort;
      if (sort_by) queryParams.sort_by = sort_by;
      if (to) queryParams.to = to;
      if (from) queryParams.from = from;
      if (filter_by) queryParams.filter_by = filter_by;
      if (filter) queryParams.filter = filter;
      if (search) queryParams.search = search;
      if (pickup_location) queryParams.pickup_location = pickup_location;
      if (channel_id) queryParams.channel_id = parseInt(channel_id);
      if (fbs !== undefined) queryParams.fbs = parseInt(fbs);
      if (updated_from) queryParams.updated_from = updated_from;
      if (updated_to) queryParams.updated_to = updated_to;

      // Call Shiprocket get orders API
      const response = await shiprocketService.getOrders(token, queryParams);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Orders retrieved successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign AWB - Generate/Assign Air Waybill Number for a shipment
   * POST /api/v1/shiprocket/courier/assign/awb
   */
  async assignAWB(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const { shipment_id, courier_id, status } = req.body;

      // Validate required fields
      if (!shipment_id || shipment_id === '') {
        throw new ErrorResponse('shipment_id is required', StatusCodes.BAD_REQUEST);
      }

      // Validate shipment_id is a number
      if (isNaN(shipment_id)) {
        throw new ErrorResponse('shipment_id must be a valid number', StatusCodes.BAD_REQUEST);
      }

      // Prepare AWB data
      const awbData = {
        shipment_id: parseInt(shipment_id)
      };

      // Add optional fields
      if (courier_id !== undefined && courier_id !== '') {
        if (isNaN(courier_id)) {
          throw new ErrorResponse('courier_id must be a valid number', StatusCodes.BAD_REQUEST);
        }
        awbData.courier_id = parseInt(courier_id);
      }

      if (status !== undefined && status !== '') {
        awbData.status = status;
      }

      // Call Shiprocket assign AWB API
      const response = await shiprocketService.assignAWB(token, awbData);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'AWB assigned successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request pickup - Request pickup for a shipment
   * POST /api/v1/shiprocket/courier/generate/pickup
   */
  async requestPickup(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      const { shipment_id, status, pickup_date } = req.body;

      // Validate required fields
      if (!shipment_id) {
        throw new ErrorResponse('shipment_id is required', StatusCodes.BAD_REQUEST);
      }

      // Validate shipment_id is an array
      if (!Array.isArray(shipment_id)) {
        throw new ErrorResponse('shipment_id must be an array', StatusCodes.BAD_REQUEST);
      }

      // Validate only one shipment_id can be passed
      if (shipment_id.length === 0) {
        throw new ErrorResponse('shipment_id array must contain at least one shipment ID', StatusCodes.BAD_REQUEST);
      }

      if (shipment_id.length > 1) {
        throw new ErrorResponse('Only one shipment_id can be passed at a time', StatusCodes.BAD_REQUEST);
      }

      // Validate all shipment_ids are numbers
      const invalidIds = shipment_id.filter(id => isNaN(id) || id === null || id === undefined || id === '');
      if (invalidIds.length > 0) {
        throw new ErrorResponse('All shipment IDs must be valid numbers', StatusCodes.BAD_REQUEST);
      }

      // Prepare pickup data
      const pickupData = {
        shipment_id: shipment_id.map(id => parseInt(id))
      };

      // Add optional fields
      if (status !== undefined && status !== '') {
        pickupData.status = status;
      }

      if (pickup_date !== undefined) {
        // Validate pickup_date is an array
        if (!Array.isArray(pickup_date)) {
          throw new ErrorResponse('pickup_date must be an array', StatusCodes.BAD_REQUEST);
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const invalidDates = pickup_date.filter(date => !dateRegex.test(date));
        if (invalidDates.length > 0) {
          throw new ErrorResponse('pickup_date must be in YYYY-MM-DD format', StatusCodes.BAD_REQUEST);
        }

        pickupData.pickup_date = pickup_date;
      }

      // Call Shiprocket request pickup API
      const response = await shiprocketService.requestPickup(token, pickupData);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Pickup requested successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Track by AWB - Get tracking details of shipment using AWB code
   * GET /api/v1/shiprocket/courier/track/awb/:awb_code
   */
  async trackByAWB(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Get AWB code from URL parameter
      const { awb_code } = req.params;

      // Validate AWB code
      if (!awb_code || awb_code === '') {
        throw new ErrorResponse('AWB code is required', StatusCodes.BAD_REQUEST);
      }

      // Call Shiprocket track by AWB API
      const response = await shiprocketService.trackByAWB(token, awb_code);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Tracking details retrieved successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get order by ID - Get specific order and shipment details
   * GET /api/v1/shiprocket/orders/:order_id
   */
  async getOrderById(req, res, next) {
    try {
      // Get token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ErrorResponse('Authorization token is required. Format: Bearer <token>', StatusCodes.UNAUTHORIZED);
      }

      const token = authHeader.substring(7); // Remove 'Bearer ' prefix

      // Get order ID from URL parameter
      const { order_id } = req.params;

      // Validate order ID
      if (!order_id || order_id === '') {
        throw new ErrorResponse('order_id is required', StatusCodes.BAD_REQUEST);
      }

      // Validate order_id is a number
      if (isNaN(order_id)) {
        throw new ErrorResponse('order_id must be a valid number', StatusCodes.BAD_REQUEST);
      }

      const orderId = parseInt(order_id);

      // Call Shiprocket get order by ID API
      const response = await shiprocketService.getOrderById(token, orderId);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'Order details retrieved successfully',
        data: response
      });
    } catch (error) {
      next(error);
    }
  }

}

module.exports = new ShiprocketController();

