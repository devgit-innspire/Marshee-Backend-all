# Razorpay Payment Verification - Callback URL Guide

## Overview

When a user completes payment via Razorpay Payment Link, Razorpay redirects them to your callback URL with query parameters. This guide shows you how to verify the payment using those parameters.

---

## 🔗 Callback URL Parameters

After payment, Razorpay redirects to your callback URL with these query parameters:

```
http://your-callback-url.com/payment/status?
  razorpay_payment_id=pay_RoBtZpFU9hYs5j
  &razorpay_payment_link_id=plink_RoBt1OMvWe84Bf
  &razorpay_payment_link_reference_id=
  &razorpay_payment_link_status=paid
  &razorpay_signature=0d259b75baf4870427ceef165202b3a27e9f0c99faeacb7619c4dbf74a683999
```

### Parameter Details:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `razorpay_payment_id` | Razorpay Payment ID | `pay_RoBtZpFU9hYs5j` |
| `razorpay_payment_link_id` | Payment Link ID | `plink_RoBt1OMvWe84Bf` |
| `razorpay_payment_link_status` | Payment status | `paid`, `failed`, etc. |
| `razorpay_signature` | HMAC SHA256 signature | `0d259b75...` |

---

## ✅ How to Verify Payment

You have **two options** to verify the payment:

### Option 1: Verify via API (Recommended)

After Razorpay redirects, call the verify API endpoint with the query parameters:

#### Endpoint
```
GET /api/v1/payments/razorpay/verify
```

#### Request Headers
```json
{
  "Authorization": "Bearer <your_jwt_token>"
}
```

#### Query Parameters
Extract from the callback URL and pass as query parameters:

```
GET /api/v1/payments/razorpay/verify?
  razorpay_payment_id=pay_RoBtZpFU9hYs5j
  &razorpay_payment_link_id=plink_RoBt1OMvWe84Bf
  &razorpay_signature=0d259b75baf4870427ceef165202b3a27e9f0c99faeacb7619c4dbf74a683999
```

#### Example JavaScript (Frontend)

```javascript
// Extract parameters from callback URL
const urlParams = new URLSearchParams(window.location.search);
const razorpayPaymentId = urlParams.get('razorpay_payment_id');
const razorpayPaymentLinkId = urlParams.get('razorpay_payment_link_id');
const razorpaySignature = urlParams.get('razorpay_signature');
const paymentStatus = urlParams.get('razorpay_payment_link_status');

// Verify payment via API
const verifyPayment = async () => {
  try {
    const response = await fetch(
      `/api/v1/payments/razorpay/verify?` +
      `razorpay_payment_id=${encodeURIComponent(razorpayPaymentId)}` +
      `&razorpay_payment_link_id=${encodeURIComponent(razorpayPaymentLinkId)}` +
      `&razorpay_signature=${encodeURIComponent(razorpaySignature)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      }
    );

    const result = await response.json();
    
    if (result.success && result.verified) {
      // Payment verified successfully!
      console.log('Payment verified:', result.order);
      // Redirect to success page
      window.location.href = `/payment/success?orderId=${result.order.id}`;
    } else {
      // Verification failed
      console.error('Payment verification failed:', result.message);
      window.location.href = `/payment/failure?error=${encodeURIComponent(result.message)}`;
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    window.location.href = `/payment/failure?error=verification_error`;
  }
};

// Call on page load if parameters are present
if (razorpayPaymentId && razorpayPaymentLinkId && razorpaySignature) {
  verifyPayment();
}
```

#### Success Response

```json
{
  "success": true,
  "message": "Payment verified successfully",
  "verified": true,
  "payment": {
    "id": "pay_RoBtZpFU9hYs5j",
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

#### Error Response

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

---

### Option 2: Verify via POST (JSON Body)

You can also send the parameters as a JSON body:

#### Endpoint
```
POST /api/v1/payments/razorpay/verify
```

#### Request Headers
```json
{
  "Authorization": "Bearer <your_jwt_token>",
  "Content-Type": "application/json"
}
```

#### Request Body
```json
{
  "razorpay_payment_id": "pay_RoBtZpFU9hYs5j",
  "razorpay_payment_link_id": "plink_RoBt1OMvWe84Bf",
  "razorpay_signature": "0d259b75baf4870427ceef165202b3a27e9f0c99faeacb7619c4dbf74a683999",
  "merchantOrderId": "optional-merchant-order-id"
}
```

---

## 🔐 How Signature Verification Works

The backend verifies the payment signature using HMAC SHA256:

1. **Concatenate**: `payment_link_id|payment_id`
   ```
   plink_RoBt1OMvWe84Bf|pay_RoBtZpFU9hYs5j
   ```

2. **Generate HMAC**: Using your Razorpay `KEY_SECRET`
   ```javascript
   crypto.createHmac('sha256', keySecret)
     .update(`${paymentLinkId}|${paymentId}`)
     .digest('hex')
   ```

3. **Compare**: Generated signature must match `razorpay_signature`

If signatures match, the payment is authentic and verified! ✅

---

## 📋 Complete Frontend Integration Example

Here's a complete React/Next.js example:

```javascript
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function PaymentCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const verifyPayment = async () => {
      // Extract parameters from URL
      const razorpayPaymentId = searchParams.get('razorpay_payment_id');
      const razorpayPaymentLinkId = searchParams.get('razorpay_payment_link_id');
      const razorpaySignature = searchParams.get('razorpay_signature');
      const paymentStatus = searchParams.get('razorpay_payment_link_status');

      // Check if we have all required parameters
      if (!razorpayPaymentId || !razorpayPaymentLinkId || !razorpaySignature) {
        setStatus('error');
        return;
      }

      try {
        // Get auth token (from localStorage, cookie, etc.)
        const token = localStorage.getItem('authToken');

        // Verify payment
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/payments/razorpay/verify?` +
          `razorpay_payment_id=${encodeURIComponent(razorpayPaymentId)}` +
          `&razorpay_payment_link_id=${encodeURIComponent(razorpayPaymentLinkId)}` +
          `&razorpay_signature=${encodeURIComponent(razorpaySignature)}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        const result = await response.json();

        if (result.success && result.verified) {
          setStatus('success');
          
          // Redirect to success page after 2 seconds
          setTimeout(() => {
            router.push(`/orders/${result.order.id}?status=success`);
          }, 2000);
        } else {
          setStatus('failed');
          
          // Redirect to failure page
          setTimeout(() => {
            router.push(`/payment/failure?error=${encodeURIComponent(result.message || 'Verification failed')}`);
          }, 2000);
        }
      } catch (error) {
        console.error('Payment verification error:', error);
        setStatus('error');
      }
    };

    verifyPayment();
  }, [searchParams, router]);

  return (
    <div className="payment-callback">
      {status === 'verifying' && (
        <div>
          <h2>Verifying Payment...</h2>
          <p>Please wait while we verify your payment.</p>
        </div>
      )}
      {status === 'success' && (
        <div>
          <h2>✅ Payment Successful!</h2>
          <p>Your payment has been verified. Redirecting...</p>
        </div>
      )}
      {status === 'failed' && (
        <div>
          <h2>❌ Payment Verification Failed</h2>
          <p>Redirecting to payment page...</p>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h2>⚠️ Error</h2>
          <p>An error occurred. Please contact support.</p>
        </div>
      )}
    </div>
  );
}
```

---

## 🔄 Alternative: Check Payment Status (Without Signature)

If you just want to check the payment status without signature verification:

### Endpoint
```
GET /api/v1/payments/razorpay/status?merchantOrderId=<your_merchant_order_id>
```

This endpoint fetches the latest status from Razorpay and updates your order accordingly.

---

## 📝 Notes

1. **Signature Verification**: Always verify the signature to ensure the payment details are authentic and not tampered with.

2. **Payment Link Status**: The `razorpay_payment_link_status` parameter indicates the status but should not be trusted alone. Always verify via API.

3. **Order Lookup**: The verify endpoint automatically finds your order using:
   - Payment Link ID (`payment.transactionId` or `payment.paymentLinkId`)
   - Merchant Order ID (`payment.merchantOrderId`)
   - Razorpay Order ID (`payment.transactionId`)

4. **Auto-Confirmation**: After successful verification, the order status is automatically updated to `confirmed` and the user's cart is cleared.

5. **Idempotency**: The verify endpoint is idempotent - calling it multiple times with the same payment details won't cause issues.

---

## 🚨 Common Issues

### Issue: Signature Verification Failed
**Solution**: 
- Ensure your Razorpay `KEY_SECRET` is correct
- Check that you're using the correct signature format: `payment_link_id|payment_id`
- Verify that query parameters are not being modified/encoded incorrectly

### Issue: Order Not Found
**Solution**:
- Check that the Payment Link ID matches what was saved in your database
- Ensure `merchantOrderId` is passed if available
- Verify the order was created successfully before payment

### Issue: 401 Unauthorized
**Solution**:
- Ensure you're passing a valid JWT token in the `Authorization` header
- Check that the token hasn't expired
- Verify the user has permission to verify payments

---

## 📚 Related Documentation

- [Razorpay Payment Links Documentation](https://razorpay.com/docs/payments/payment-links/)
- [Razorpay Signature Verification](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/verify-payment-signature/)
- [Main Payment Verification Guide](./RAZORPAY_PAYMENT_VERIFICATION.md)

