const crypto = require('crypto');
const { StatusCodes } = require('http-status-codes');
const { randomUUID } = crypto;
const WogglePreOrder = require('../models/wogglePreOrder.model');
const razorpayService = require('../config/razorpayService');
const razorpayConfig = require('../config/razorpayConfig');
const { WOGGLE_PRE_ORDER_AMOUNT } = require('../config/preOrderPricing');

/**
 * Create Razorpay payment for Woggle pre-order
 */
exports.createRazorpayPaymentForWogglePreOrder = async (req, res, next) => {
  try {
    const { amount, preOrderId } = req.body;

    console.log("amount in createRazorpayPaymentForWogglePreOrder:", amount);
    console.log("preOrderId in createRazorpayPaymentForWogglePreOrder:", preOrderId);

    if (!preOrderId) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "preOrderId is required."
      });
    }

    if (!require('mongoose').Types.ObjectId.isValid(String(preOrderId))) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid preOrderId."
      });
    }

    const wogglePreOrder = await WogglePreOrder.findById(preOrderId);
    if (!wogglePreOrder) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Woggle pre-order not found for the given preOrderId."
      });
    }

    // Amount comes from the stored pre-order (itself server-priced at creation), never
    // from the request body - this route is public.
    const amountNum = Number(wogglePreOrder.amount) || WOGGLE_PRE_ORDER_AMOUNT;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "This pre-order has no payable amount."
      });
    }
    if (amount !== undefined && Number(amount) !== amountNum) {
      console.warn('[Woggle] Ignoring client-supplied amount', {
        preOrderId: wogglePreOrder._id.toString(),
        clientAmount: amount,
        serverAmount: amountNum
      });
    }

    // Create merchant order ID
    const merchantOrderId = randomUUID();

    // Initialize payment object if it doesn't exist
    if (!wogglePreOrder.payment) {
      wogglePreOrder.payment = {};
    }

    // Update payment details
    wogglePreOrder.payment.merchantOrderId = merchantOrderId;
    wogglePreOrder.payment.gateway = 'razorpay';
    wogglePreOrder.payment.currency = 'INR';
    wogglePreOrder.payment.amount = amountNum;
    wogglePreOrder.paymentStatus = 'pending';
    wogglePreOrder.status = 'payment_pending';

    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder({
      amount: amountNum,
      currency: 'INR',
      merchantOrderId: merchantOrderId,
      receipt: `WOGGLE-${wogglePreOrder._id.toString().slice(-6)}`,
      notes: {
        wogglePreOrderId: wogglePreOrder._id.toString(),
        orderNumber: merchantOrderId
      }
    });

    console.log("razorpayOrder in createRazorpayPaymentForWogglePreOrder:", razorpayOrder);

    if (!razorpayOrder.success) {
      wogglePreOrder.paymentStatus = 'failed';
      wogglePreOrder.payment.failedAt = new Date();
      wogglePreOrder.payment.gatewayResponse = razorpayOrder.error || { error: 'order creation failed' };
      await wogglePreOrder.save();

      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: razorpayOrder.message || "Failed to create Razorpay order."
      });
    }

    // Store order details for later verification
    wogglePreOrder.payment.transactionId = razorpayOrder.orderId;
    wogglePreOrder.payment.keyId = razorpayService.getKeyId();
    await wogglePreOrder.save();

    console.log('✅ Razorpay order created for Woggle pre-order:', {
      wogglePreOrderId: wogglePreOrder._id,
      razorpayOrderId: razorpayOrder.orderId,
      merchantOrderId: merchantOrderId
    });

    // Build verify URL for frontend to redirect after payment
    const verifyUrl = razorpayService.buildCallbackUrl({
      wogglePreOrderId: wogglePreOrder._id.toString(),
      merchantOrderId,
      razorpay_order_id: razorpayOrder.orderId
    });

    console.log("verifyUrl for Woggle pre-order:", verifyUrl);

    // Return response
    return res.status(StatusCodes.OK).json({
      success: true,
      keyId: razorpayService.getKeyId(),
      razorpayOrderId: razorpayOrder.orderId,
      merchantOrderId,
      amountInPaise: razorpayOrder.amount,
      amount: amountNum,
      currency: 'INR',
      verifyUrl,
      preOrderPayment: {
        id: wogglePreOrder._id,
        preOrderId: wogglePreOrder._id,
        amount: amountNum
      }
    });

  } catch (error) {
    console.error("createRazorpayPaymentForWogglePreOrder error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error.message || "Error creating Razorpay payment for Woggle pre-order"
    });
  }
};

/**
 * Verify Razorpay payment for Woggle pre-order
 */
exports.verifyRazorpayPaymentForWoggle = async (req, res, next) => {
  try {
    console.log("verifyRazorpayPaymentForWoggle started");
    
    // Accept from query (GET callback) or body (POST webhook)
    const payload = { ...req.query, ...req.body };
    
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      wogglePreOrderId,
      merchantOrderId
    } = payload;

    console.log("razorpay_payment_id:", razorpay_payment_id);
    console.log("razorpay_order_id:", razorpay_order_id);
    console.log("razorpay_signature:", razorpay_signature);

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Missing razorpay_payment_id, razorpay_order_id or razorpay_signature'
      });
    }

    // Build signature body: order_id|payment_id
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    // Resolve via razorpayConfig so prefixed and generic env names both work.
    const secret = razorpayConfig.KEY_SECRET;

    if (!secret) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
        success: false, 
        message: 'Razorpay secret not configured' 
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body.toString())
      .digest("hex");

    const isValid = expectedSignature === razorpay_signature;

    console.log("Razorpay verify computed:", expectedSignature);
    console.log("Razorpay verify provided:", razorpay_signature);
    console.log("Razorpay verify valid:", isValid);

    if (!isValid) {
      const failureUrl = razorpayService.buildFailureUrl({
        status: 'failed',
        reason: 'Invalid signature',
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        wogglePreOrderId: wogglePreOrderId
      });
      
      // Try to find and update pre-order with callback verification failure
      try {
        const preOrderForCallback = await WogglePreOrder.findOne({ 
          'payment.transactionId': razorpay_order_id 
        });
        if (preOrderForCallback) {
          if (!preOrderForCallback.payment) {
            preOrderForCallback.payment = {};
          }
          if (!preOrderForCallback.payment.callbackVerification) {
            preOrderForCallback.payment.callbackVerification = {};
          }
          preOrderForCallback.payment.callbackVerification = {
            verified: true,
            status: 'invalid_signature',
            verifiedAt: new Date(),
            razorpayPaymentId: razorpay_payment_id,
            razorpayOrderId: razorpay_order_id,
            signatureValid: false,
            error: 'Invalid signature'
          };
          await preOrderForCallback.save();
        }
      } catch (err) {
        console.warn('Failed to save callback verification for invalid signature:', err.message);
      }
      
      const wantsJson = req.headers.accept?.includes('application/json') || 
                       req.query.format === 'json';
      
      if (wantsJson) {
        return res.status(StatusCodes.BAD_REQUEST).json({ 
          success: false, 
          message: "Invalid signature",
          redirectUrl: failureUrl
        });
      }
      
      return res.redirect(failureUrl);
    }

    // Find pre-order by razorpay order_id
    let wogglePreOrder = await WogglePreOrder.findOne({ 
      'payment.transactionId': razorpay_order_id 
    });

    // Fallback: find by merchantOrderId if provided
    if (!wogglePreOrder && merchantOrderId) {
      wogglePreOrder = await WogglePreOrder.findOne({ 
        'payment.merchantOrderId': merchantOrderId 
      });
    }

    // Fallback: find by wogglePreOrderId if provided
    if (!wogglePreOrder && wogglePreOrderId) {
      wogglePreOrder = await WogglePreOrder.findById(wogglePreOrderId);
    }

    if (!wogglePreOrder) {
      console.warn('WogglePreOrder not found for Razorpay order_id:', razorpay_order_id);
      
      const failureUrl = razorpayService.buildFailureUrl({
        status: 'failed',
        reason: 'WogglePreOrder not found',
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
      
      const wantsJson = req.headers.accept?.includes('application/json') || 
                       req.query.format === 'json';
      
      if (wantsJson) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: 'WogglePreOrder not found. Please check if razorpay_order_id is correct.',
          redirectUrl: failureUrl
        });
      }
      
      return res.redirect(failureUrl);
    }

    // Fetch payment status from Razorpay
    const paymentResult = await razorpayService.fetchPayment(razorpay_payment_id);
    const isPaymentSuccessful = paymentResult.success && 
                               paymentResult.payment && 
                               (paymentResult.payment.status === 'captured' || 
                                paymentResult.payment.status === 'authorized');

    // Build redirect URLs
    const successUrl = razorpayService.buildSuccessUrl({
      wogglePreOrderId: wogglePreOrder._id.toString(),
      paymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      status: 'success'
    });

    const failureUrl = razorpayService.buildFailureUrl({
      wogglePreOrderId: wogglePreOrder._id.toString(),
      paymentId: razorpay_payment_id,
      razorpayOrderId: razorpay_order_id,
      status: 'failed',
      reason: paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'
    });

    // Check if request wants JSON response
    const wantsJson = req.headers.accept?.includes('application/json') || 
                     req.query.format === 'json' ||
                     req.body.format === 'json';

    // Save callback verification data
    try {
      if (!wogglePreOrder.payment) {
        wogglePreOrder.payment = {};
      }
      if (!wogglePreOrder.payment.callbackVerification) {
        wogglePreOrder.payment.callbackVerification = {};
      }

      wogglePreOrder.payment.callbackVerification = {
        verified: true,
        status: isPaymentSuccessful ? 'success' : 'failed',
        verifiedAt: new Date(),
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        signatureValid: true,
        paymentStatus: paymentResult.payment?.status || 'unknown',
        error: isPaymentSuccessful ? null : (paymentResult.payment?.status === 'failed' ? 'Payment failed' : 'Payment verification failed'),
        responseType: wantsJson ? 'json' : 'redirect'
      };
      
      // Update payment status if successful
      if (isPaymentSuccessful) {
        wogglePreOrder.paymentStatus = 'completed';
        wogglePreOrder.payment.completedAt = new Date();
        wogglePreOrder.payment.gatewayTransactionId = razorpay_payment_id;
        wogglePreOrder.status = 'payment_completed';
      } else {
        wogglePreOrder.paymentStatus = 'failed';
        wogglePreOrder.payment.failedAt = new Date();
      }
      
      await wogglePreOrder.save();
      console.log('✅ Callback verification data saved to Woggle pre-order:', wogglePreOrder._id);
    } catch (err) {
      console.warn('⚠️  Failed to save callback verification data:', err.message);
    }

    if (wantsJson) {
      // Return JSON for API calls
      const response = {
        success: isPaymentSuccessful, 
        message: isPaymentSuccessful ? "Payment verified successfully" : "Payment verification failed", 
        verified: true,
        redirectUrl: isPaymentSuccessful ? successUrl : failureUrl,
        data: { 
          razorpay_order_id, 
          razorpay_payment_id 
        },
        payment: {
          id: razorpay_payment_id,
          status: paymentResult.payment?.status
        },
        wogglePreOrder: {
          id: wogglePreOrder._id,
          status: wogglePreOrder.status,
          paymentStatus: wogglePreOrder.paymentStatus,
          amount: wogglePreOrder.amount
        }
      };

      return res.status(StatusCodes.OK).json(response);
    }

    // Redirect to frontend success/failure page (browser requests)
    if (isPaymentSuccessful) {
      console.log('✅ Payment verified successfully, redirecting to success page:', successUrl);
      return res.redirect(successUrl);
    } else {
      console.log('❌ Payment verification failed, redirecting to failure page:', failureUrl);
      return res.redirect(failureUrl);
    }

  } catch (error) {
    console.error("Error verifying Razorpay payment for Woggle:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: error.message || "Error verifying Razorpay payment"
    });
  }
};

/**
 * Handle Razorpay webhook for Woggle pre-orders
 */
exports.handleRazorpayWebhookForWoggle = async (req, res, next) => {
  try {
    console.log("🔔 ========== Razorpay Webhook for Woggle Received ==========");
    
    // Resolve via razorpayConfig so prefixed and generic env names both work.
    const webhookSecret = razorpayConfig.WEBHOOK_SECRET;
    const razorpaySignature = req.headers["x-razorpay-signature"];
    
    if (!webhookSecret) {
      console.error("❌ RAZORPAY_WEBHOOK_SECRET not configured");
      return res.status(500).json({ success: false, message: "Webhook secret not configured" });
    }

    if (!razorpaySignature) {
      console.error("❌ Missing x-razorpay-signature header");
      return res.status(400).json({ success: false, message: "Missing signature" });
    }

    // Ensure body is a Buffer (raw body)
    let body = req.body;
    if (!Buffer.isBuffer(body)) {
      body = Buffer.from(JSON.stringify(body));
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");

    const signaturesMatch = crypto.timingSafeEqual
      ? crypto.timingSafeEqual(Buffer.from(razorpaySignature), Buffer.from(expectedSignature))
      : razorpaySignature === expectedSignature;

    if (!signaturesMatch) {
      console.error("❌ Invalid Razorpay webhook signature");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    console.log("✅ Razorpay webhook signature verified successfully");
    
    // Parse event
    const event = JSON.parse(body.toString());
    console.log("📋 Event Type:", event?.event || 'UNKNOWN');

    if (!event || !event.event) {
      console.error("❌ Invalid webhook payload: missing event");
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    // Handle payment.captured event
    if (event.event === "payment.captured") {
      console.log("💰 ========== Processing payment.captured Event for Woggle ==========");
      const payment = event.payload?.payment?.entity;
      
      if (!payment) {
        console.error("❌ Missing payment entity in payload");
        return res.status(200).json({ success: true, received: true });
      }

      const razorpayOrderId = payment.order_id;
      const paymentId = payment.id;
      const merchantOrderId = payment.notes?.merchantOrderId || payment.notes?.orderNumber;

      console.log("🔑 Extracted Identifiers:", {
        paymentId,
        razorpayOrderId: razorpayOrderId || 'NOT FOUND',
        merchantOrderId: merchantOrderId || 'NOT FOUND'
      });

      // Find pre-order by transactionId
      let wogglePreOrder = await WogglePreOrder.findOne({ 
        'payment.transactionId': razorpayOrderId 
      });

      // Fallback: find by merchantOrderId
      if (!wogglePreOrder && merchantOrderId) {
        wogglePreOrder = await WogglePreOrder.findOne({ 
          'payment.merchantOrderId': merchantOrderId 
        });
      }

      if (!wogglePreOrder) {
        console.warn("⚠️  WogglePreOrder not found - webhook processed but no record updated");
        return res.status(200).json({ success: true, received: true });
      }

      if (wogglePreOrder.paymentStatus === 'completed') {
        console.log("ℹ️  WogglePreOrder payment already completed, skipping update");
        return res.status(200).json({ success: true, received: true });
      }

      console.log("📝 ========== Updating WogglePreOrder ==========");
      console.log("📝 WogglePreOrder ID:", wogglePreOrder._id);
      console.log("📝 Current Payment Status:", wogglePreOrder.paymentStatus);

      // Update payment status
      wogglePreOrder.paymentStatus = 'completed';
      wogglePreOrder.status = 'payment_completed';
      
      if (!wogglePreOrder.payment) {
        wogglePreOrder.payment = {};
      }
      
      wogglePreOrder.payment.gatewayTransactionId = paymentId;
      wogglePreOrder.payment.transactionId = wogglePreOrder.payment.transactionId || razorpayOrderId;
      wogglePreOrder.payment.merchantOrderId = wogglePreOrder.payment.merchantOrderId || merchantOrderId;
      wogglePreOrder.payment.completedAt = new Date();
      wogglePreOrder.payment.rawResponse = payment;
      
      if (!wogglePreOrder.payment.callbackVerification) {
        wogglePreOrder.payment.callbackVerification = {};
      }
      
      wogglePreOrder.payment.callbackVerification = {
        verified: true,
        status: 'success',
        verifiedAt: new Date(),
        razorpayPaymentId: paymentId,
        razorpayOrderId: razorpayOrderId,
        signatureValid: true,
        paymentStatus: payment.status,
        responseType: 'json'
      };

      await wogglePreOrder.save();
      console.log('✅ WogglePreOrder updated successfully via payment.captured webhook');
      console.log("✅ WogglePreOrder Status:", wogglePreOrder.status);
      console.log("✅ Payment Status:", wogglePreOrder.paymentStatus);
    } else if (event.event === "payment_link.paid") {
      console.log("🔗 ========== Processing payment_link.paid Event for Woggle ==========");
      const paymentLink = event.payload?.payment_link?.entity;
      
      if (!paymentLink) {
        console.error("❌ Missing payment_link entity in payload");
        return res.status(200).json({ success: true, received: true });
      }

      const paymentLinkId = paymentLink.id;
      const merchantOrderId = paymentLink.notes?.merchantOrderId || paymentLink.notes?.orderNumber;
      const paymentId = paymentLink.payments?.[0]?.entity?.id;

      console.log("🔑 Extracted Identifiers:", {
        paymentLinkId,
        merchantOrderId: merchantOrderId || 'NOT FOUND',
        paymentId: paymentId || 'NOT FOUND'
      });

      // Find pre-order by paymentLinkId or merchantOrderId
      let wogglePreOrder = await WogglePreOrder.findOne({ 
        'payment.paymentLinkId': paymentLinkId 
      });

      if (!wogglePreOrder && merchantOrderId) {
        wogglePreOrder = await WogglePreOrder.findOne({ 
          'payment.merchantOrderId': merchantOrderId 
        });
      }

      if (!wogglePreOrder) {
        console.warn("⚠️  WogglePreOrder not found - webhook processed but no record updated");
        return res.status(200).json({ success: true, received: true });
      }

      if (wogglePreOrder.paymentStatus === 'completed') {
        console.log("ℹ️  WogglePreOrder payment already completed, skipping update");
        return res.status(200).json({ success: true, received: true });
      }

      console.log("📝 ========== Updating WogglePreOrder (payment_link.paid) ==========");
      console.log("📝 WogglePreOrder ID:", wogglePreOrder._id);
      console.log("📝 Current Payment Status:", wogglePreOrder.paymentStatus);

      // Update payment status
      wogglePreOrder.paymentStatus = 'completed';
      wogglePreOrder.status = 'payment_completed';
      
      if (!wogglePreOrder.payment) {
        wogglePreOrder.payment = {};
      }
      
      wogglePreOrder.payment.paymentLinkId = paymentLinkId;
      wogglePreOrder.payment.gatewayTransactionId = paymentId || wogglePreOrder.payment.gatewayTransactionId;
      wogglePreOrder.payment.merchantOrderId = wogglePreOrder.payment.merchantOrderId || merchantOrderId;
      wogglePreOrder.payment.completedAt = new Date();
      wogglePreOrder.payment.rawResponse = paymentLink;
      
      if (!wogglePreOrder.payment.callbackVerification) {
        wogglePreOrder.payment.callbackVerification = {};
      }
      
      wogglePreOrder.payment.callbackVerification = {
        verified: true,
        status: 'success',
        verifiedAt: new Date(),
        razorpayPaymentId: paymentId || null,
        razorpayOrderId: null,
        signatureValid: true,
        paymentStatus: paymentLink.status,
        responseType: 'json'
      };

      await wogglePreOrder.save();
      console.log('✅ WogglePreOrder updated successfully via payment_link.paid webhook');
      console.log("✅ WogglePreOrder Status:", wogglePreOrder.status);
      console.log("✅ Payment Status:", wogglePreOrder.paymentStatus);
    } else {
      console.log("ℹ️ ========== Unhandled Event ==========");
      console.log("ℹ️ Event Type:", event.event);
    }

    console.log("✅ ========== Webhook Processing Complete ==========");
    return res.status(200).json({ success: true, received: true });
    
  } catch (error) {
    console.error("❌ ========== Webhook Error ==========");
    console.error("❌ Error Message:", error.message);
    console.error("❌ Error Stack:", error.stack);
    // Still return 200 to prevent Razorpay from retrying
    return res.status(200).json({ success: false, message: error.message });
  }
};
