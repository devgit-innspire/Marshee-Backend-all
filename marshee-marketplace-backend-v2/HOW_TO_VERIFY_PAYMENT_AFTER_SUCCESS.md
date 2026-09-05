# How to Verify Payment Status After Successful Payment

## Overview
After a user completes payment on Razorpay, you have **two ways** to verify the payment:

1. **Full Verification with Signature** (Recommended) - Most secure
2. **Status Check** - Simple status check without signature

---

## Method 1: Verify Payment (Full Verification with Signature) ✅ RECOMMENDED

### When to Use:
- After Razorpay redirects user back to your callback URL
- When you have `razorpay_payment_id` and `razorpay_signature` from callback

### Endpoint:
```
POST /api/v1/payments/razorpay/verify
```

### Step-by-Step:

#### 1. Extract Parameters from Callback URL

When user completes payment, Razorpay redirects to:
```
https://www.marshee.com/payment/status?
  razorpay_payment_link_id=plink_RntkVxBHS7QYZM&
  razorpay_payment_id=pay_LP1234567890&
  razorpay_signature=a1b2c3d4e5f6789...
```

**Frontend Code:**
```javascript
// Extract from URL
const urlParams = new URLSearchParams(window.location.search);
const razorpay_payment_id = urlParams.get('razorpay_payment_id');
const razorpay_signature = urlParams.get('razorpay_signature');
const razorpay_order_id = urlParams.get('razorpay_order_id') || 
                          urlParams.get('razorpay_payment_link_id');

// Or get from your order document
const merchantOrderId = "8d065523-75ff-4d8c-ad38-2ed2a4a4ea69"; // From order
```

#### 2. Call Verify API

```javascript
const response = await fetch('/api/v1/payments/razorpay/verify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    razorpay_order_id: razorpay_order_id,      // "plink_RntkVxBHS7QYZM"
    razorpay_payment_id: razorpay_payment_id,  // "pay_LP1234567890"
    razorpay_signature: razorpay_signature,    // "a1b2c3d4e5f6..."
    merchantOrderId: merchantOrderId           // Optional but recommended
  })
});

const result = await response.json();
```

#### 3. Success Response

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
    "id": "6932b4ac1a8fcab9c50e0b27",
    "orderNumber": "ORD251205756",
    "status": "confirmed",
    "paymentStatus": "completed"
  }
}
```

#### 4. Handle Response

```javascript
if (result.success && result.verified) {
  // Payment verified successfully!
  console.log('Payment confirmed:', result.order);
  
  // Redirect to success page
  window.location.href = `/payment/success?orderId=${result.order.id}`;
} else {
  // Verification failed
  console.error('Verification failed:', result.message);
  window.location.href = `/payment/failure?error=${result.message}`;
}
```

---

## Method 2: Check Payment Status (Simple Status Check)

### When to Use:
- To check payment status periodically (polling)
- When signature is not available
- For manual status checks

### Endpoint:
```
GET /api/v1/payments/razorpay/status
```

### Options:

#### Option A: Using Merchant Order ID (Recommended)
```javascript
const response = await fetch(
  `/api/v1/payments/razorpay/status?merchantOrderId=8d065523-75ff-4d8c-ad38-2ed2a4a4ea69`,
  {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  }
);
```

#### Option B: Using Razorpay Order/Payment Link ID
```javascript
const response = await fetch(
  `/api/v1/payments/razorpay/status?orderId=plink_RntkVxBHS7QYZM`,
  {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  }
);
```

### Response:
```json
{
  "success": true,
  "order": {
    "id": "6932b4ac1a8fcab9c50e0b27",
    "orderNumber": "ORD251205756",
    "status": "confirmed",
    "payment": {
      "status": "completed",
      "transactionId": "plink_RntkVxBHS7QYZM",
      "merchantOrderId": "8d065523-75ff-4d8c-ad38-2ed2a4a4ea69",
      "paidAt": "2024-12-05T10:35:00.000Z",
      "gateway": "razorpay",
      "gatewayTransactionId": "pay_LP1234567890"
    }
  },
  "razorpay": {
    "status": "completed",
    "amount": 950,
    "currency": "INR",
    "updatedAt": "2024-12-05T10:35:00.000Z"
  }
}
```

---

## Complete Frontend Implementation Example

### Full Payment Verification Flow:

```javascript
// After Razorpay redirects to your callback page
async function verifyPaymentAfterRedirect() {
  try {
    // Step 1: Extract parameters from URL
    const urlParams = new URLSearchParams(window.location.search);
    const razorpay_payment_id = urlParams.get('razorpay_payment_id');
    const razorpay_signature = urlParams.get('razorpay_signature');
    const razorpay_order_id = urlParams.get('razorpay_order_id') || 
                              urlParams.get('razorpay_payment_link_id');
    
    // Get merchantOrderId from localStorage (saved when creating payment)
    const merchantOrderId = localStorage.getItem('razorpay_merchantOrderId');
    
    if (!razorpay_payment_id || !razorpay_signature || !razorpay_order_id) {
      console.error('Missing payment parameters in URL');
      window.location.href = '/payment/failure?error=missing_params';
      return;
    }
    
    // Step 2: Verify payment with signature
    const response = await fetch('/api/v1/payments/razorpay/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        razorpay_order_id: razorpay_order_id,
        razorpay_payment_id: razorpay_payment_id,
        razorpay_signature: razorpay_signature,
        merchantOrderId: merchantOrderId
      })
    });
    
    const result = await response.json();
    
    // Step 3: Handle result
    if (result.success && result.verified) {
      // ✅ Payment verified successfully
      console.log('✅ Payment verified:', result.order);
      
      // Clear merchantOrderId from localStorage
      localStorage.removeItem('razorpay_merchantOrderId');
      
      // Redirect to success page
      window.location.href = `/payment/success?orderId=${result.order.id}&orderNumber=${result.order.orderNumber}`;
    } else {
      // ❌ Verification failed
      console.error('❌ Verification failed:', result.message);
      window.location.href = `/payment/failure?error=${encodeURIComponent(result.message)}`;
    }
    
  } catch (error) {
    console.error('Error verifying payment:', error);
    window.location.href = `/payment/failure?error=${encodeURIComponent(error.message)}`;
  }
}

// Call on page load (if on callback page)
if (window.location.pathname.includes('/payment/status')) {
  verifyPaymentAfterRedirect();
}
```

---

## Polling for Status (Alternative Approach)

If you want to poll for payment status instead of waiting for callback:

```javascript
// Poll payment status every 5 seconds
async function pollPaymentStatus(merchantOrderId, maxAttempts = 60) {
  let attempts = 0;
  
  const pollInterval = setInterval(async () => {
    attempts++;
    
    try {
      const response = await fetch(
        `/api/v1/payments/razorpay/status?merchantOrderId=${merchantOrderId}`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
          }
        }
      );
      
      const result = await response.json();
      
      if (result.success) {
        const paymentStatus = result.order.payment.status;
        
        if (paymentStatus === 'completed') {
          // ✅ Payment completed!
          clearInterval(pollInterval);
          console.log('✅ Payment completed:', result.order);
          window.location.href = `/payment/success?orderId=${result.order.id}`;
        } else if (paymentStatus === 'failed') {
          // ❌ Payment failed
          clearInterval(pollInterval);
          console.error('❌ Payment failed');
          window.location.href = `/payment/failure`;
        } else if (attempts >= maxAttempts) {
          // ⏱️ Timeout
          clearInterval(pollInterval);
          console.warn('⏱️ Status check timeout');
          window.location.href = `/payment/pending?orderId=${result.order.id}`;
        }
        // Otherwise continue polling...
      }
    } catch (error) {
      console.error('Error checking status:', error);
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
      }
    }
  }, 5000); // Check every 5 seconds
  
  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    clearInterval(pollInterval);
  });
}

// Usage: Start polling after redirecting user to payment page
pollPaymentStatus('8d065523-75ff-4d8c-ad38-2ed2a4a4ea69');
```

---

## Save merchantOrderId When Creating Payment

When creating payment, save `merchantOrderId` for later use:

```javascript
// When creating payment from cart
const createPaymentResponse = await fetch('/api/v1/payments/razorpay/create-from-cart', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    shippingAddressId: addressId
  })
});

const paymentData = await createPaymentResponse.json();

if (paymentData.success) {
  // ✅ Save merchantOrderId for verification
  localStorage.setItem('razorpay_merchantOrderId', paymentData.merchantOrderId);
  
  // Redirect user to payment page
  window.location.href = paymentData.checkoutPageUrl;
}
```

---

## Summary

### After User Completes Payment:

1. **Razorpay redirects** to your `callbackUrl` with payment details
2. **Extract** `razorpay_payment_id`, `razorpay_signature`, `razorpay_order_id` from URL
3. **Call verify API** with all parameters
4. **Backend verifies** signature and updates order status
5. **Redirect** user to success/failure page

### Quick Reference:

| Method | Endpoint | When to Use |
|--------|----------|-------------|
| **Verify (Signature)** | `POST /razorpay/verify` | After callback redirect ✅ |
| **Check Status** | `GET /razorpay/status` | Polling or manual check |

### Required for Verification:
- ✅ `razorpay_order_id` - From order doc or URL
- ✅ `razorpay_payment_id` - From callback URL
- ✅ `razorpay_signature` - From callback URL
- ⚪ `merchantOrderId` - Optional (from order doc)

---

## Testing

### Test with cURL:

```bash
# Verify Payment (with signature)
curl -X POST http://localhost:5001/api/v1/payments/razorpay/verify \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "razorpay_order_id": "plink_RntkVxBHS7QYZM",
    "razorpay_payment_id": "pay_xxxxx",
    "razorpay_signature": "signature_hash",
    "merchantOrderId": "8d065523-75ff-4d8c-ad38-2ed2a4a4ea69"
  }'

# Check Status
curl -X GET "http://localhost:5001/api/v1/payments/razorpay/status?merchantOrderId=8d065523-75ff-4d8c-ad38-2ed2a4a4ea69" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

**Note:** The status check endpoint now automatically detects if you're using Payment Links (`plink_xxx`) or Orders (`order_xxx`) and fetches the correct status from Razorpay!

