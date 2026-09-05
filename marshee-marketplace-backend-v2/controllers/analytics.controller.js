const { StatusCodes } = require('http-status-codes');
const ErrorResponse = require('../utils/errorResponse');
const Product = require('../models/product.model');
const Order = require('../models/order.model');
const Partner = require('../models/partner.model');

class AnalyticsController {
  // ===== Helpers =====

  _buildDateFilter(req) {
    const { startDate, endDate } = req.query || {};
    const filter = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    return filter;
  }

  /** Resolve Partner _id for partner user (same as partner/product controllers: user first, then contact.email). */
  async _getPartnerForUser(user) {
    if (user.role !== 'partner') return null;
    let partner = await Partner.findOne({ user: user._id }).lean();
    if (!partner && user.email) {
      partner = await Partner.findOne({ 'contact.email': user.email }).lean();
    }
    return partner;
  }

  async _getPartnerId(user) {
    const partner = await this._getPartnerForUser(user);
    if (!partner) {
      if (user.role === 'partner') {
        throw new ErrorResponse('Partner profile not found', StatusCodes.NOT_FOUND);
      }
      return null;
    }
    return partner._id;
  }

  // ===== Core analytics (reusable) =====

  async _getProductAnalytics(user, dateFilter) {
    const partnerId = await this._getPartnerId(user).catch(err => {
      if (err instanceof ErrorResponse) throw err;
      throw new ErrorResponse('Failed to resolve partner', StatusCodes.INTERNAL_SERVER_ERROR);
    }) || null;

    const filter = { ...dateFilter };
    if (partnerId && user._id) filter.partner = { $in: [partnerId, user._id] };

    const productMatch = partnerId && user._id ? { partner: { $in: [partnerId, user._id] }, ...dateFilter } : dateFilter;

    const [
      totalProducts,
      activeProducts,
      pendingProducts,
      approvedProducts,
      rejectedProducts,
      productStatusBreakdown
    ] = await Promise.all([
      Product.countDocuments(productMatch),
      Product.countDocuments({ ...filter, 'status.isActive': true }),
      Product.countDocuments({ ...filter, 'status.approval.status': 'pending' }),
      Product.countDocuments({ ...filter, 'status.approval.status': 'approved' }),
      Product.countDocuments({ ...filter, 'status.approval.status': 'rejected' }),
      Product.aggregate([
        { $match: productMatch },
        {
          $group: {
            _id: '$status.approval.status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    return {
      totalProducts,
      activeProducts,
      pendingProducts,
      approvedProducts,
      rejectedProducts,
      productStatusBreakdown: productStatusBreakdown.map(item => ({
        status: item._id || 'unknown',
        count: item.count
      }))
    };
  }

  async _getOrderAnalytics(user, dateFilter) {
    const partnerId = await this._getPartnerId(user).catch(() => null);
    const partnerIds = partnerId && user._id ? [partnerId, user._id] : null;

    let totalOrders, completedOrders, pendingOrders, cancelledOrders, orderStatusBreakdown;

    if (partnerIds && partnerIds.length > 0) {
      const itemPartnerFilter = { 'items.partner': { $in: partnerIds } };
      const [orderIds, completedIds, pendingIds, cancelledIds] = await Promise.all([
        Order.distinct('_id', { ...itemPartnerFilter, ...dateFilter }),
        Order.distinct('_id', { ...itemPartnerFilter, 'status.status': 'delivered', ...dateFilter }),
        Order.distinct('_id', {
          ...itemPartnerFilter,
          'status.status': { $in: ['pending', 'confirmed', 'processing'] },
          ...dateFilter
        }),
        Order.distinct('_id', { ...itemPartnerFilter, 'status.status': 'cancelled', ...dateFilter })
      ]);

      totalOrders = orderIds.length;
      completedOrders = completedIds.length;
      pendingOrders = pendingIds.length;
      cancelledOrders = cancelledIds.length;

      orderStatusBreakdown = await Order.aggregate([
        { $match: { ...itemPartnerFilter, ...dateFilter } },
        { $unwind: '$items' },
        { $match: { 'items.partner': { $in: partnerIds } } },
        {
          $group: {
            _id: '$status.status',
            ids: { $addToSet: '$_id' }
          }
        },
        {
          $project: {
            _id: 1,
            count: { $size: '$ids' }
          }
        }
      ]);
    } else {
      [totalOrders, completedOrders, pendingOrders, cancelledOrders] = await Promise.all([
        Order.countDocuments(dateFilter),
        Order.countDocuments({ ...dateFilter, 'status.status': 'delivered' }),
        Order.countDocuments({ ...dateFilter, 'status.status': { $in: ['pending', 'confirmed', 'processing'] } }),
        Order.countDocuments({ ...dateFilter, 'status.status': 'cancelled' })
      ]);

      orderStatusBreakdown = await Order.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$status.status',
            count: { $sum: 1 }
          }
        }
      ]);
    }

    return {
      totalOrders,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      orderStatusBreakdown: orderStatusBreakdown.map(item => ({
        status: item._id || 'unknown',
        count: item.count
      }))
    };
  }

  async _getSalesAnalytics(user, dateFilter) {
    const partnerId = await this._getPartnerId(user).catch(() => null);
    const partnerIds = partnerId && user._id ? [partnerId, user._id] : null;

    const match = partnerIds && partnerIds.length > 0
      ? { 'items.partner': { $in: partnerIds }, ...dateFilter }
      : { ...dateFilter };

    const salesAggregation = await Order.aggregate([
      { $match: match },
      { $unwind: '$items' },
      ...(partnerIds ? [{ $match: { 'items.partner': { $in: partnerIds } } }] : []),
      {
        $group: {
          _id: null,
          grossSales: { $sum: '$items.totalPrice' },
          totalDiscount: { $sum: { $ifNull: ['$items.discount', 0] } },
          totalTax: { $sum: { $ifNull: ['$items.taxAmount', 0] } },
          orderCount: { $sum: 1 }
        }
      }
    ]);

    const salesData = salesAggregation[0] || {
      grossSales: 0,
      totalDiscount: 0,
      totalTax: 0,
      orderCount: 0
    };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const salesOverTime = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo },
          ...(partnerIds && partnerIds.length > 0 && { 'items.partner': { $in: partnerIds } })
        }
      },
      { $unwind: '$items' },
      ...(partnerIds ? [{ $match: { 'items.partner': { $in: partnerIds } } }] : []),
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          sales: { $sum: '$items.totalPrice' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // No discount: listPrice is the selling price; net sales = gross sales
    const grossSales = salesData.grossSales || 0;
    return {
      grossSales,
      totalDiscount: 0,
      totalTax: salesData.totalTax || 0,
      netSales: grossSales,
      averageOrderValue:
        salesData.orderCount > 0
          ? parseFloat((grossSales / salesData.orderCount).toFixed(2))
          : 0,
      salesOverTime
    };
  }

  async _getCategoryAnalytics(dateFilter) {
    const productsByCategory = await Product.aggregate([
      { $match: dateFilter },
      {
        $lookup: {
          from: 'servicecategories',
          localField: 'category.serviceCategory',
          foreignField: '_id',
          as: 'serviceCat'
        }
      },
      { $unwind: { path: '$serviceCat', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$serviceCat.name',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const salesByCategory = await Order.aggregate([
      { $match: dateFilter },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'servicecategories',
          localField: 'product.category.serviceCategory',
          foreignField: '_id',
          as: 'serviceCat'
        }
      },
      { $unwind: { path: '$serviceCat', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$serviceCat.name',
          sales: { $sum: '$items.totalPrice' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { sales: -1 } },
      { $limit: 10 }
    ]);

    return { productsByCategory, salesByCategory };
  }

  async _getPartnerSalesAnalytics(dateFilter) {
    const partnerSales = await Order.aggregate([
      { $match: dateFilter },
      { $unwind: '$items' },
      {
        $match: {
          'items.partner': { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'partners',
          localField: 'items.partner',
          foreignField: '_id',
          as: 'partner'
        }
      },
      { $unwind: '$partner' },
      {
        $group: {
          _id: '$items.partner',
          partnerName: { $first: '$partner.name' },
          partnerCode: { $first: '$partner.code' },
          sales: { $sum: '$items.totalPrice' },
          orders: { $sum: 1 },
          commission: { $sum: { $ifNull: ['$items.commission.amount', 0] } }
        }
      },
      { $sort: { sales: -1 } },
      { $limit: 10 }
    ]);

    return { partnerSales };
  }

  // ===== Route handlers =====

  async getDashboardAnalytics(req, res, next) {
    try {
      const user = req.user;
      const dateFilter = this._buildDateFilter(req);

      const [productData, orderData, salesData] = await Promise.all([
        this._getProductAnalytics(user, dateFilter),
        this._getOrderAnalytics(user, dateFilter),
        this._getSalesAnalytics(user, dateFilter)
      ]);

      const conversionRate =
        orderData.totalOrders > 0
          ? parseFloat(((orderData.completedOrders / orderData.totalOrders) * 100).toFixed(2))
          : 0;

      const response = {
        success: true,
        data: {
          overview: {
            totalProducts: productData.totalProducts,
            activeProducts: productData.activeProducts,
            pendingProducts: productData.pendingProducts,
            approvedProducts: productData.approvedProducts,
            rejectedProducts: productData.rejectedProducts,
            totalOrders: orderData.totalOrders,
            completedOrders: orderData.completedOrders,
            pendingOrders: orderData.pendingOrders,
            cancelledOrders: orderData.cancelledOrders,
            grossSales: salesData.grossSales,
            totalDiscount: salesData.totalDiscount,
            totalTax: salesData.totalTax,
            netSales: salesData.netSales,
            conversionRate,
            averageOrderValue: salesData.averageOrderValue
          },
          charts: {
            productStatusBreakdown: productData.productStatusBreakdown,
            orderStatusBreakdown: orderData.orderStatusBreakdown,
            salesOverTime: salesData.salesOverTime
          }
        }
      };

      if (user.role === 'admin') {
        const [categoryData, partnerData] = await Promise.all([
          this._getCategoryAnalytics(dateFilter),
          this._getPartnerSalesAnalytics(dateFilter)
        ]);

        response.data.charts.productsByCategory = categoryData.productsByCategory;
        response.data.charts.salesByCategory = categoryData.salesByCategory;
        response.data.charts.partnerSales = partnerData.partnerSales;
      }

      return res.status(StatusCodes.OK).json(response);
    } catch (error) {
      next(error);
    }
  }

  async getProductAnalytics(req, res, next) {
    try {
      const dateFilter = this._buildDateFilter(req);
      const data = await this._getProductAnalytics(req.user, dateFilter);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getOrderAnalytics(req, res, next) {
    try {
      const dateFilter = this._buildDateFilter(req);
      const data = await this._getOrderAnalytics(req.user, dateFilter);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getSalesAnalytics(req, res, next) {
    try {
      const dateFilter = this._buildDateFilter(req);
      const data = await this._getSalesAnalytics(req.user, dateFilter);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getCategoryAnalytics(req, res, next) {
    try {
      const dateFilter = this._buildDateFilter(req);
      const data = await this._getCategoryAnalytics(dateFilter);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async getPartnerAnalytics(req, res, next) {
    try {
      const dateFilter = this._buildDateFilter(req);
      const data = await this._getPartnerSalesAnalytics(dateFilter);
      return res.status(StatusCodes.OK).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

// Create a single instance and bind methods so `this` works correctly
const analyticsControllerInstance = new AnalyticsController();

analyticsControllerInstance.getDashboardAnalytics =
  analyticsControllerInstance.getDashboardAnalytics.bind(analyticsControllerInstance);
analyticsControllerInstance.getProductAnalytics =
  analyticsControllerInstance.getProductAnalytics.bind(analyticsControllerInstance);
analyticsControllerInstance.getOrderAnalytics =
  analyticsControllerInstance.getOrderAnalytics.bind(analyticsControllerInstance);
analyticsControllerInstance.getSalesAnalytics =
  analyticsControllerInstance.getSalesAnalytics.bind(analyticsControllerInstance);
analyticsControllerInstance.getCategoryAnalytics =
  analyticsControllerInstance.getCategoryAnalytics.bind(analyticsControllerInstance);
analyticsControllerInstance.getPartnerAnalytics =
  analyticsControllerInstance.getPartnerAnalytics.bind(analyticsControllerInstance);

module.exports = analyticsControllerInstance;
