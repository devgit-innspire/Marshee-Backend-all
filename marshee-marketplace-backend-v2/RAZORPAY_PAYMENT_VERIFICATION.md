# Razorpay Payment Verification Guide

## Overview
There are **two ways** to verify/check Razorpay payment status:

1. **Verify Payment** - Full verification with signature (after payment completion)
2. **Check Status** - Simple status check (without signature verification)

---

## 📍 Where to Get Verification Values

### From Your Order Document (MongoDB)

Looking at your order document, here's where each value comes from:

| Verification Field | Source in Order Document | Example from Your Doc |
|-------------------|-------------------------|----------------------|
| **razorpay_order_id** | `payment.transactionId` | `"order_RmIep9e4D5KpAW"` ✅ (You have this) |
| **merchantOrderId** | `payment.merchantOrderId` | Should be UUID like `"8a53c493-..."` ⚠️ (Not in your doc - might need to check API response) |
| **razorpay_payment_id** | ❌ Not in order doc | Comes from **Razorpay callback/redirect** after user pays |
| **razorpay_signature** | ❌ Not in order doc | Comes from **Razorpay callback/redirect** after user pays |

### From Razorpay Callback/Redirect (After Payment) ⭐ MOST IMPORTANT

When user completes payment on Razorpay page, Razorpay redirects to your `callbackUrl` with these query parameters:

```
https://your-callback-url.com/payment/status?
  razorpay_payment_link_id=plink_xxxxx&
  razorpay_payment_id=pay_LP1234567890&
  razorpay_signature=a1b2c3d4e5f6...&
  razorpay_order_id=order_RmIep9e4D5KpAW
```

**Extract these from URL parameters:**
- ✅ `razorpay_payment_id` - Payment ID from URL param (REQUIRED)
- ✅ `razorpay_signature` - Signature from URL param (REQUIRED)
- ✅ `razorpay_order_id` or `razorpay_payment_link_id` - From URL param (REQUIRED)

**Example JavaScript to extract:**
```javascript
// After Razorpay redirects to your callback page
const urlParams = new URLSearchParams(window.location.search);
const razorpay_payment_id = urlParams.get('razorpay_payment_id');
const razorpay_signature = urlParams.get('razorpay_signature');
const razorpay_order_id = urlParams.get('razorpay_order_id') || urlParams.get('razorpay_payment_link_id');
```

**⚠️ Note:** If `merchantOrderId` is not in your order document, you can:
- Use the `orderNumber` as fallback: `"ORD251201330"` (from your doc)
- Or query by `razorpay_order_id` only (the verify endpoint will find the order)

### From API Response (When Creating Payment)

When you call `/razorpay/create-from-cart`, the response includes:

```json
{
  "success": true,
  "checkoutPageUrl": "https://rzp.io/i/xxxxx",
  "merchantOrderId": "8a53c493-a57f-4382-b6c8-ecfed82ed76a",  // ✅ Save this!
  "order": {
    "id": "69329d01dcd79e8f0c33d606",
    "orderNumber": "ORD251205947"
  }
}
```

**Save `merchantOrderId` in your frontend** (localStorage/sessionStorage) to use later for verification.

---

## 🔍 Your Current Order Status

Based on your order document:
```json
{
  "payment": {
    "transactionId": "order_RmIep9e4D5KpAW",  // ✅ This is your razorpay_order_id
    "status": "pending",                       // Payment not yet completed
    "gateway": "razorpay"
  }
}
```

**Missing:**
- ❌ `payment.merchantOrderId` - Check the API response when you created the payment
- ❌ `razorpay_payment_id` - Will be available after user completes payment
- ❌ `razorpay_signature` - Will be available after user completes payment

**To verify payment, you need:**
1. ✅ `razorpay_order_id` = `"order_RmIep9e4D5KpAW"` (from your doc)
2. ⚠️ `merchantOrderId` = Check your frontend/localStorage or API response
3. ⏳ `razorpay_payment_id` = Wait for user to complete payment (from callback)
4. ⏳ `razorpay_signature` = Wait for user to complete payment (from callback)

---

## 1. Verify Payment (Signature Verification)

### Endpoint
```
POST /api/v1/payments/razorpay/verify
```

### Authentication
✅ Requires authentication (`Bearer token` in header)

### Request Headers
```json
{
  "Authorization": "Bearer <your_jwt_token>",
  "Content-Type": "application/json"
}
```

### Request Body (JSON)

#### For Standard Razorpay Checkout:
```json
{
  "razorpay_order_id": "order_Rns1rctCgP9ofc",
  "razorpay_payment_id": "pay_LP1234567890",
  "razorpay_signature": "a1b2c3d4e5f6...",
  "merchantOrderId": "8a53c493-a57f-4382-b6c8-ecfed82ed76a"
}
```

#### For Payment Links (if callback provides):
```json
{
  "razorpay_order_id": "plink_xxxxx",  // Payment Link ID
  "razorpay_payment_id": "pay_LP1234567890",
  "razorpay_signature": "a1b2c3d4e5f6...",
  "merchantOrderId": "8a53c493-a57f-4382-b6c8-ecfed82ed76a"
}
```

### Required Fields
- ✅ `razorpay_order_id` - Razorpay Order ID or Payment Link ID
- ✅ `razorpay_payment_id` - Razorpay Payment ID
- ✅ `razorpay_signature` - HMAC SHA256 signature
- ⚪ `merchantOrderId` - Your internal merchant order ID (optional, but recommended)

### Success Response (200)
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "verified": true,
  "payment": {
    "id": "pay_LP1234567890",
    "status": "captured",
    "amount": 47500,
    "currency": "INR",
    "method": "netbanking"
  },
  "order": {
    "id": "69329d01dcd79e8f0c33d606",
    "orderNumber": "ORD251205947",
    "status": "confirmed",
    "paymentStatus": "completed"
  }
}
```

### Error Responses

#### Invalid Signature (400)
```json
{
  "success": false,
  "message": "Payment signature verification failed",
  "verification": {
    "success": false,
    "isValid": false,
    "message": "Signature verification failed"
  }
}
```

#### Missing Fields (400)
```json
{
  "success": false,
  "message": "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required"
}
```

#### Order Not Found (404)
```json
{
  "success": false,
  "message": "Order not found"
}
```

---

## 2. Check Payment Status (Simple Status Check)

### Endpoint
```
GET /api/v1/payments/razorpay/status
```

### Authentication
✅ Requires authentication (`Bearer token` in header)

### Query Parameters

#### Option 1: Using Razorpay Order ID
```
GET /api/v1/payments/razorpay/status?orderId=order_Rns1rctCgP9ofc
```

#### Option 2: Using Merchant Order ID
```
GET /api/v1/payments/razorpay/status?merchantOrderId=8a53c493-a57f-4382-b6c8-ecfed82ed76a
```

#### Option 3: Using Both (merchantOrderId takes precedence)
```
GET /api/v1/payments/razorpay/status?orderId=order_xxx&merchantOrderId=merchant_xxx
```

### Request Headers
```json
{
  "Authorization": "Bearer <your_jwt_token>"
}
```

### Success Response (200)
```json
{
  "success": true,
  "order": {
    "id": "69329d01dcd79e8f0c33d606",
    "orderNumber": "ORD251205947",
    "status": "confirmed",
    "payment": {
      "status": "completed",
      "transactionId": "plink_xxxxx",
      "merchantOrderId": "8a53c493-a57f-4382-b6c8-ecfed82ed76a",
      "paidAt": "2024-12-25T10:30:00.000Z",
      "gateway": "razorpay"
    }
  }
}
```

### Error Responses

#### Missing Parameters (400)
```json
{
  "success": false,
  "message": "orderId (Razorpay order_id) or merchantOrderId is required"
}
```

#### Order Not Found (404)
```json
{
  "success": false,
  "message": "Order not found"
}
```

---

## Frontend Integration Examples

### Example 1: After Payment Link Redirect (Callback)

```javascript
// When Razorpay redirects to your callback URL
// URL params will be: ?razorpay_payment_link_id=plink_xxx&razorpay_payment_id=pay_xxx&razorpay_signature=xxx

const urlParams = new URLSearchParams(window.location.search);
const paymentLinkId = urlParams.get('razorpay_payment_link_id');
const paymentId = urlParams.get('razorpay_payment_id');
const signature = urlParams.get('razorpay_signature');

// Call verify endpoint
const response = await fetch('/api/v1/payments/razorpay/verify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    razorpay_order_id: paymentLinkId,  // Payment Link ID
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
    merchantOrderId: 'your-merchant-order-id'  // From your order
  })
});

const result = await response.json();
if (result.success) {
  // Payment verified successfully
  console.log('Order confirmed:', result.order);
} else {
  // Handle error
  console.error('Verification failed:', result.message);
}
```

### Example 2: Polling for Status (Periodic Check)

```javascript
// Check status every 5 seconds until payment is completed
const checkPaymentStatus = async (merchantOrderId) => {
  const response = await fetch(
    `/api/v1/payments/razorpay/status?merchantOrderId=${merchantOrderId}`,
    {
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    }
  );

  const result = await response.json();
  
  if (result.success && result.order.payment.status === 'completed') {
    // Payment completed!
    return result.order;
  } else if (result.success && result.order.payment.status === 'pending') {
    // Still pending, check again
    return null;
  } else {
    // Payment failed or error
    throw new Error(result.message || 'Payment check failed');
  }
};

// Poll every 5 seconds
const pollInterval = setInterval(async () => {
  try {
    const order = await checkPaymentStatus('your-merchant-order-id');
    if (order) {
      clearInterval(pollInterval);
      console.log('Payment completed!', order);
    }
  } catch (error) {
    clearInterval(pollInterval);
    console.error('Payment check error:', error);
  }
}, 5000);
```

### Example 3: Using cURL

#### Verify Payment:
```bash
curl -X POST https://your-domain.com/api/v1/payments/razorpay/verify \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id": "order_Rns1rctCgP9ofc",
    "razorpay_payment_id": "pay_LP1234567890",
    "razorpay_signature": "a1b2c3d4e5f6...",
    "merchantOrderId": "8a53c493-a57f-4382-b6c8-ecfed82ed76a"
  }'
```

#### Check Status:
```bash
curl -X GET "https://your-domain.com/api/v1/payments/razorpay/status?merchantOrderId=8a53c493-a57f-4382-b6c8-ecfed82ed76a" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Payment Status Values

### Payment Status
- `pending` - Payment not yet initiated or in progress
- `completed` - Payment successful and captured
- `failed` - Payment failed

### Order Status
- `pending` - Order created, awaiting payment
- `confirmed` - Payment received, order confirmed
- `processing` - Order being processed
- `shipped` - Order shipped
- `delivered` - Order delivered
- `cancelled` - Order cancelled

---

## Notes

1. **Signature Verification**: The verify endpoint uses HMAC SHA256 to verify the payment signature for security.

2. **Payment Links**: When using Payment Links, the `razorpay_order_id` parameter should contain the Payment Link ID (`plink_xxxxx`).

3. **Order Lookup**: The system first tries to find orders by `razorpay_order_id`, then falls back to `merchantOrderId`.

4. **Auto-updates**: Both endpoints automatically update your database order status based on Razorpay's response.

5. **Cart Clearing**: Successful verification automatically clears the user's cart.

