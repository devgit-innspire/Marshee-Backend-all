const phonePeService = require('../config/phonePeService');
const { StatusCodes } = require('http-status-codes');
const Order = require('../models/order.model');
const { randomUUID } = require('crypto');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { queuePurchaseCapiEvent } = require('../utils/metaCapi');


const initiatePhonePePayment = async (req, res, next) => {
    try {
        const userId = req.user?.id;
        const { amount } = req.body;

        console.log("User ID:", userId);

        console.log("PhonePe Payment Request:", amount);

        if (!amount || amount <= 0) {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                message: 'Valid amount is required'
            });
        }

        // Use provided callback URL or default
        // const redirectUrl = callbackUrl || `${process.env.BASE_URL}/api/v1/payments/phonepe/callback`;

        // console.log("Using Redirect URL:", redirectUrl);

        const result = await phonePeService.createPaymentOrder({ amount, merchantOrderId: randomUUID(), orderId: randomUUID(), userId: userId });

        console.log("PhonePe Payment Response:", result);

        if (result.success) {
            // Optional: Save payment record to your database
            // await PaymentModel.create({
            //     merchantOrderId: result.merchantOrderId,
            //     userId,
            //     amount: result.originalAmount,
            //     status: 'INITIATED'
            // });

            return res.status(StatusCodes.OK).json({
                success: true,
                data: {
                    merchantOrderId: result.merchantOrderId,
                    paymentUrl: result.paymentUrl,
                    token: result.token,
                    amount: result.originalAmount,
                    checkoutPageUrl: result.checkoutPageUrl
                }
            });
        } else {
            return res.status(StatusCodes.BAD_GATEWAY).json({
                success: false,
                message: 'Payment initiation failed',
                error: result.error
            });
        }
    } catch (error) {
        console.error('Controller error:', error);
        next(error);
    }
};

// Optional: Add callback handler
const handlePhonePeCallback = async (req, res) => {
    try {
        console.log('PhonePe callback received:', req.body, req.query);
        
        // Handle payment success/failure logic here
        // Verify payment status, update database, etc.
        
        res.status(200).json({ success: true, message: 'Callback processed' });
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).json({ success: false, message: 'Callback processing failed' });
    }
};

const createPaymentForOrder = async (req, res, next) => {
  try {
    const userId = req.user?.id; // Ensure this comes from auth middleware
    const { orderId, amount, paymentMethod = 'online', gateway = 'PhonePe' } = req.body;

    console.log("📦 Create Payment Request:", { userId, orderId, amount, paymentMethod, gateway });


    if (!orderId || !amount || Number(amount) <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Valid orderId and amount are required'
      });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Valid numeric amount is required',
      });
    }

    // 1️⃣ Fetch and validate order
    const order = await Order.findById(orderId).select(
      '_id user totalAmount payment status orderNumber paymentAttempts'
    );

    if (!order) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user.toString() !== userId.toString()) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'You are not authorized to pay for this order'
      });
    }

    if (order.payment.status === 'completed') {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Payment already completed for this order'
      });
    }

    // 2️⃣ Validate amount matches DB
    const roundedOrderAmount = Number(order.totalAmount.toFixed(2));
    if (Number(amount) !== roundedOrderAmount) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: `Amount mismatch. Expected ₹${roundedOrderAmount}`
      });
    }

    // 3️⃣ Generate unique merchant order reference
    const merchantOrderId = `${order.orderNumber}-${Date.now().toString().slice(-6)}`;

    console.log("Merchant Order ID:", merchantOrderId);
    console.log("Amount:", amountNum);
    console.log("Order ID:", order.orderNumber);
    console.log("User ID:", userId);    

    // 4️⃣ Initiate payment via PhonePe
    const result = await phonePeService.createPaymentOrder({
      amount: Number(amountNum),
      merchantOrderId,
      orderId: order.orderNumber,
      userId,
    });

    if (!result?.success) {
      console.error("🚨 PhonePe Payment Init Failed:", result?.error || result);
      return res.status(StatusCodes.BAD_GATEWAY).json({
        success: false,
        message: 'Failed to initiate payment with gateway',
        error: result?.error || 'Unknown error'
      });
    }

    // 5️⃣ Record payment attempt in DB
    order.paymentAttempts.push({
      method: paymentMethod,
      gateway,
      transactionId: result.merchantOrderId,
      status: 'pending',
      attemptedAt: new Date()
    });

    // 6️⃣ Update payment metadata
    order.payment = {
      ...order.payment,
      method: paymentMethod,
      status: 'pending',
      gateway,
      transactionId: result.merchantOrderId
    };

    await order.save();

    // 7️⃣ Return payment details to frontend
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Payment initiated successfully',
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        gateway,
        paymentMethod,
        amount,
        merchantOrderId,
        token: result.token,
        checkoutUrl: result.checkoutPageUrl || result.paymentUrl
      }
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    next(error);
  }
};

const phonePeWebhookHandler = async (req, res) => {
  try {
    console.log('📩 PhonePe webhook received payload:', JSON.stringify(req.body, null, 2));
    console.log('📩 PhonePe webhook headers:', req.headers);

    // Normalize incoming payload (handle multiple possible field names)
    const payload = req.body || {};
    const merchantOrderId = payload.merchantOrderId || payload.merchantTransactionId || payload.orderId;
    const transactionId = payload.transactionId || payload.providerReferenceId || payload.pgTransactionId;
    const rawStatus = payload.status || payload.state || payload.code || payload.responseCode;

    if (!merchantOrderId) {
      console.error('❌ Missing merchantOrderId in webhook payload');
      return res.status(400).json({ success: false, message: 'merchantOrderId is required' });
    }

    // Optional: signature verification (implementation depends on your PhonePe config)
    // Skipping strict verification here to avoid false negatives in sandbox.

    const receivedSignature = req.headers['x-verify'];
if (receivedSignature) {
  const computed = crypto
    .createHash('sha256')
    .update(`${merchantOrderId}${process.env.PHONEPE_SALT_KEY}`)
    .digest('hex');

  if (computed !== receivedSignature) {
    console.warn(`❌ Invalid webhook signature for order ${merchantOrderId}`);
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }
}


    // Find order by the transaction reference we set at initiation time
    const order = await Order.findOne({ 'payment.transactionId': merchantOrderId });
    if (!order) {
      console.error('❌ Order not found for merchantOrderId:', merchantOrderId);
      // Always return 200 to PhonePe even if order not found (to avoid retries)
      return res.status(200).json({ success: false, message: 'Order not found' });
    }

    console.log(`✅ Found order: ${order.orderNumber} (${order._id})`);

    // Idempotency: if already completed, acknowledge without changing
    if (order.payment && order.payment.status === 'completed') {
      console.log(`⚠️ Payment already completed for order ${order.orderNumber}, acknowledging webhook`);
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // Normalize status
    const status = String(rawStatus || '').toUpperCase();

    // Find the corresponding payment attempt to update (by matching transactionId)
    let paymentAttempt = null;
    if (order.paymentAttempts && order.paymentAttempts.length > 0) {
      // Try to find attempt by transactionId match, otherwise use the last one
      paymentAttempt = order.paymentAttempts.find(
        attempt => attempt.transactionId === merchantOrderId
      ) || order.paymentAttempts[order.paymentAttempts.length - 1];
    }

    if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'PAYMENT_SUCCESS') {
      order.payment.status = 'completed';
      order.payment.gateway = 'PhonePe';
      order.payment.transactionId = merchantOrderId;
      order.payment.paidAt = new Date();
      
      // Update payment attempt status
      if (paymentAttempt) {
        paymentAttempt.status = 'completed';
        // Use PhonePe's provider transaction ID if available, otherwise keep merchantOrderId
        if (transactionId) {
          paymentAttempt.transactionId = transactionId;
        } else {
          paymentAttempt.transactionId = merchantOrderId;
        }
      }
      
      // Use model method to update order status and history
      if (typeof order.updateStatus === 'function') {
        order.updateStatus('confirmed');
      } else {
        order.status = 'confirmed';
      }

      // Clear user's cart on successful payment
      try {
        const Cart = require('../models/cart.model');
        const userCart = await Cart.findOne({ user: order.user });
        if (userCart) {
          userCart.clearCart();
          await userCart.save();
          console.log(`✅ Cart cleared for user ${order.user}`);
        }
      } catch (cartError) {
        console.warn('⚠️ Cart clear after webhook payment failed:', cartError?.message);
      }

      await order.save();
      console.log(`✅ Payment SUCCESS processed for order ${order.orderNumber}`);
      // Best-effort analytics event (do not block webhook response)
      queuePurchaseCapiEvent({ req, order });
      return res.status(200).json({ success: true, message: 'Payment completed' });
      
    } else if (status === 'FAILED' || status === 'FAILURE' || status === 'PAYMENT_FAILED' || status === 'PAYMENT_ERROR') {
      order.payment.status = 'failed';
      order.payment.gateway = 'PhonePe';
      order.payment.transactionId = merchantOrderId;
      
      // Update payment attempt status
      if (paymentAttempt) {
        paymentAttempt.status = 'failed';
        paymentAttempt.errorCode = payload.errorCode || payload.code || 'PAYMENT_FAILED';
        paymentAttempt.errorMessage = payload.message || payload.errorMessage || 'Payment failed';
        if (transactionId) {
          paymentAttempt.transactionId = transactionId;
        }
      }
      
      // Don't change order status on failure - keep it as pending/confirmed
      
      await order.save();
      console.log(`⚠️ Payment FAILED for order ${order.orderNumber}`);
      return res.status(200).json({ success: true, message: 'Payment failed recorded' });
      
    } else {
      // Unknown/processing state → acknowledge without changes
      console.warn(`⚠️ Unrecognized webhook status: ${rawStatus} for order ${order.orderNumber}`);
      return res.status(200).json({ success: true, message: 'Unknown status acknowledged' });
    }

  } catch (error) {
    console.error('❌ Webhook error:', error);
    console.error('❌ Error stack:', error.stack);
    // Always return 200 to PhonePe to prevent retries on our errors
    return res.status(200).json({ success: false, message: 'Webhook processing error' });
  }
};

const razorpayPaymentTest= async (req, res, next) => {
  try {
console.log("razorpayPaymentTest started");

var instance = new Razorpay({ key_id: 'rzp_live_Rpqfpo279jJa1h', key_secret: 'yn5qaJt7gFiHLEDo2jDPJHLQ' })

  // step 1 create order only (no payment link)
  const order = await instance.orders.create({
    amount: Number(100), // in paise
    currency: "INR",
    receipt: "receipt#1",
    notes: {
      key1: "value3",
      key2: "value2"
    }
  });

  console.log("order in razorpayPaymentTest:", order);

  return res.status(StatusCodes.OK).json({
    success: true,
    message: "Razorpay order created successfully",
    data: {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      fullResponse: order
    },
  });

  } catch (error) {
    console.error('❌ Razorpay payment error:', error);
    next(error);
  }
};

const razorpayPaymentLinkVerifyTest = async (req, res, next) => {
  try {

    console.log("razorpayPaymentLinkVerifyTest started");
    // Accept from query (GET callback) or body (POST webhook)
    const payload = { ...req.query, ...req.body };
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = payload;

    console.log("razorpay_payment_id in razorpayPaymentLinkVerifyTest:", razorpay_payment_id);
    console.log("razorpay_order_id in razorpayPaymentLinkVerifyTest:", razorpay_order_id);
    console.log("razorpay_signature in razorpayPaymentLinkVerifyTest:", razorpay_signature);

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing razorpay_payment_id, razorpay_order_id or razorpay_signature'
      });
    }

    // Build signature body: order_id|payment_id
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;

    // Use Razorpay key_secret (never key_id) for HMAC
    const secret = process.env.RAZORPAY_TEST_KEY_SECRET;
    console.log("secret in razorpayPaymentLinkVerifyTest:", secret);
    if (!secret) {
      return res.status(500).json({ success: false, message: 'Razorpay secret not configured' });
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body.toString())
      .digest("hex");

    const isValid = expectedSignature === razorpay_signature;

    console.log("Razorpay verify computed:", expectedSignature);
    console.log("Razorpay verify provided:", razorpay_signature);
    console.log("Razorpay verify valid:", isValid);

    if (isValid) {
      return res.status(200).json({ success: true, message: "Payment verified", data: { razorpay_order_id, razorpay_payment_id } });
    }

    return res.status(400).json({ success: false, message: "Invalid signature" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Webhook error" });
  }
};

module.exports = {
    initiatePhonePePayment,
    handlePhonePeCallback,
    createPaymentForOrder,
    razorpayPaymentTest,
    razorpayPaymentLinkVerifyTest,
};
