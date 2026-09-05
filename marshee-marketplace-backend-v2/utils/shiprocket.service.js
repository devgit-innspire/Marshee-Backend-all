const axios = require('axios');

/**
 * Shiprocket Service
 * Handles Shiprocket API interactions
 */
class ShiprocketService {
  constructor() {
    this.baseURL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
  }

  /**
   * Login to Shiprocket and get access token
   * @param {String} email - Shiprocket email
   * @param {String} password - Shiprocket password
   * @returns {Promise<Object>} Response with token
   */
  async login(email, password) {
    try {
      const response = await axios.post(`${this.baseURL}/auth/login`, {
        email: email,
        password: password
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.token) {
        return response.data;
      }

      throw new Error('Token not received from Shiprocket');
    } catch (error) {
      console.error('Shiprocket login error:', error.response?.data || error.message);
      
      // Provide more detailed error message
      if (error.response?.data) {
        const errorMsg = error.response.data.message || error.response.data.error || 'Failed to login to Shiprocket';
        throw new Error(errorMsg);
      }
      
      throw new Error(error.message || 'Failed to login to Shiprocket');
    }
  }

  /**
   * Make authenticated GET request with query parameters
   * @param {String} endpoint - API endpoint
   * @param {String} token - Bearer token
   * @param {Object} queryParams - Query parameters object
   * @returns {Promise<Object>} API response
   */
  async makeAuthenticatedGetRequest(endpoint, token, queryParams = {}) {
    try {
      // Build query string from params object
      const queryString = new URLSearchParams();
      Object.keys(queryParams).forEach(key => {
        if (queryParams[key] !== undefined && queryParams[key] !== null) {
          queryString.append(key, queryParams[key]);
        }
      });

      const url = queryString.toString() 
        ? `${this.baseURL}${endpoint}?${queryString.toString()}`
        : `${this.baseURL}${endpoint}`;

      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      return response.data;
    } catch (error) {
      console.error(`Shiprocket API error (GET ${endpoint}):`, error.response?.data || error.message);
      
      if (error.response?.data) {
        const errorMsg = error.response.data.message || error.response.data.error || `API request failed`;
        throw new Error(errorMsg);
      }
      
      throw new Error(error.message || `Failed to make API request to ${endpoint}`);
    }
  }

  /**
   * Check serviceability - Get available courier companies for shipping
   * @param {String} token - Bearer token
   * @param {Object} params - Query parameters
   * @param {String} params.order_id - Shiprocket order ID (optional, if provided, cod/weight not needed)
   * @param {String} params.pickup_postcode - Pickup pincode (required if no order_id)
   * @param {String} params.delivery_postcode - Delivery pincode (required if no order_id)
   * @param {String} params.weight - Weight in kgs (required if no order_id)
   * @param {Boolean} params.cod - Cash on delivery flag (required if no order_id)
   * @param {Number} params.length - Length in cms (optional)
   * @param {Number} params.breadth - Breadth in cms (optional)
   * @param {Number} params.height - Height in cms (optional)
   * @param {Number} params.declared_value - Price in rupees (optional)
   * @param {String} params.mode - Mode: Surface or Air (optional)
   * @param {Number} params.is_return - Return order flag: 1 or 0 (optional)
   * @param {Number} params.couriers_type - Filter documents couriers: 1 (optional)
   * @param {Number} params.only_local - Filter hyperlocal couriers: 1 (optional)
   * @param {Number} params.qc_check - QC-enabled couriers: 1 (optional, requires is_return=1)
   * @returns {Promise<Object>} Serviceability response with available couriers
   */
  async checkServiceability(token, params) {
    try {
      const response = await this.makeAuthenticatedGetRequest(
        '/courier/serviceability/',
        token,
        params
      );
      return response;
    } catch (error) {
      console.error('Error checking serviceability:', error);
      throw error;
    }
  }

  /**
   * Make authenticated POST request with body data
   * @param {String} endpoint - API endpoint
   * @param {String} token - Bearer token
   * @param {Object} data - Request body data
   * @returns {Promise<Object>} API response
   */
  async makeAuthenticatedPostRequest(endpoint, token, data) {
    try {
      const response = await axios.post(
        `${this.baseURL}${endpoint}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        }
      );

      return response.data;
    } catch (error) {
      const data = error.response?.data;
      console.error(`Shiprocket API error (POST ${endpoint}):`, data || error.message);
      if (data?.errors && typeof data.errors === 'object') {
        console.error('Shiprocket validation errors:', JSON.stringify(data.errors));
      }
      if (data) {
        const errorMsg = data.message || data.error || `API request failed`;
        const err = new Error(errorMsg);
        err.shiprocketResponse = data;
        err.shiprocketErrors = data.errors;
        throw err;
      }
      throw new Error(error.message || `Failed to make API request to ${endpoint}`);
    }
  }

  /**
   * Create a custom order (adhoc order)
   * @param {String} token - Bearer token
   * @param {Object} orderData - Order data
   * @returns {Promise<Object>} Order creation response
   */
  async createOrder(token, orderData) {
    try {
      const response = await this.makeAuthenticatedPostRequest(
        '/orders/create/adhoc',
        token,
        orderData
      );
      return response;
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  }

  /**
   * Cancel order(s)
   * @param {String} token - Bearer token
   * @param {Array<Number>} orderIds - Array of Shiprocket order IDs to cancel
   * @returns {Promise<Object>} Cancel order response
   */
  async cancelOrder(token, orderIds) {
    try {
      const response = await this.makeAuthenticatedPostRequest(
        '/orders/cancel',
        token,
        { ids: orderIds }
      );
      return response;
    } catch (error) {
      console.error('Error cancelling order:', error);
      throw error;
    }
  }

  /**
   * Get all pickup locations
   * @param {String} token - Bearer token
   * @returns {Promise<Object>} List of pickup locations
   */
  async getPickupLocations(token) {
    try {
      const response = await this.makeAuthenticatedGetRequest(
        '/settings/company/pickup',
        token
      );
      return response;
    } catch (error) {
      console.error('Error getting pickup locations:', error);
      throw error;
    }
  }

  /**
   * Add pickup location
   * POST /settings/company/addpickup
   * @param {String} token - Bearer token
   * @param {Object} pickupData - Pickup location details
   * @returns {Promise<Object>} Add pickup response
   */
  async addPickupLocation(token, pickupData) {
    try {
      const response = await this.makeAuthenticatedPostRequest(
        '/settings/company/addpickup',
        token,
        pickupData
      );
      return response;
    } catch (error) {
      console.error('Error adding pickup location:', error);
      throw error;
    }
  }

  /**
   * Get all orders with optional filters and pagination
   * @param {String} token - Bearer token
   * @param {Object} params - Query parameters for filtering, sorting, and pagination
   * @returns {Promise<Object>} List of orders
   */
  async getOrders(token, params = {}) {
    try {
      const response = await this.makeAuthenticatedGetRequest(
        '/orders',
        token,
        params
      );
      return response;
    } catch (error) {
      console.error('Error getting orders:', error);
      throw error;
    }
  }

  /**
   * Generate/Assign AWB for a shipment
   * @param {String} token - Bearer token
   * @param {Object} awbData - AWB assignment data
   * @param {Number} awbData.shipment_id - Shipment ID (required)
   * @param {Number} awbData.courier_id - Courier ID (optional)
   * @param {String} awbData.status - Status for reassignment: "reassign" (optional)
   * @returns {Promise<Object>} AWB assignment response
   */
  async assignAWB(token, awbData) {
    try {
      const response = await this.makeAuthenticatedPostRequest(
        '/courier/assign/awb',
        token,
        awbData
      );
      return response;
    } catch (error) {
      console.error('Error assigning AWB:', error);
      throw error;
    }
  }

  /**
   * Request shipment pickup
   * @param {String} token - Bearer token
   * @param {Object} pickupData - Pickup request data
   * @param {Array<Number>} pickupData.shipment_id - Array of shipment IDs (only one allowed)
   * @param {String} pickupData.status - Status for retry: "retry" (optional)
   * @param {Array<String>} pickupData.pickup_date - Array of dates in YYYY-MM-DD format (optional)
   * @returns {Promise<Object>} Pickup request response
   */
  async requestPickup(token, pickupData) {
    try {
      const response = await this.makeAuthenticatedPostRequest(
        '/courier/generate/pickup',
        token,
        pickupData
      );
      return response;
    } catch (error) {
      console.error('Error requesting pickup:', error);
      throw error;
    }
  }

  /**
   * Track shipment by AWB code
   * @param {String} token - Bearer token
   * @param {String} awbCode - AWB (Air Waybill) code
   * @returns {Promise<Object>} Tracking details response
   */
  async trackByAWB(token, awbCode) {
    try {
      const response = await this.makeAuthenticatedGetRequest(
        `/courier/track/awb/${awbCode}`,
        token
      );
      return response;
    } catch (error) {
      console.error('Error tracking by AWB:', error);
      throw error;
    }
  }

  /**
   * Get specific order details by order ID
   * @param {String} token - Bearer token
   * @param {Number} orderId - Shiprocket order ID
   * @returns {Promise<Object>} Order details response
   */
  async getOrderById(token, orderId) {
    try {
      const response = await this.makeAuthenticatedGetRequest(
        `/orders/show/${orderId}`,
        token
      );
      return response;
    } catch (error) {
      console.error('Error getting order by ID:', error);
      throw error;
    }
  }
}

module.exports = new ShiprocketService();

