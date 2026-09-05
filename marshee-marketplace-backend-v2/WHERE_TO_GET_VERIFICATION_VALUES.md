# Where to Get Razorpay Verification Values

## 📋 Quick Reference

Based on **your order document**, here's exactly where each value comes from:

---

## 1️⃣ razorpay_order_id ✅ YOU HAVE THIS

**Source:** Your Order Document  
**Location:** `payment.transactionId`

```json
// From your order document:
{
  "payment": {
    "transactionId": "order_RmIep9e4D5KpAW"  // ← THIS IS YOUR razorpay_order_id
  }
}
```

**Value for API:** `"order_RmIep9e4D5KpAW"`

---

## 2️⃣ merchantOrderId ⚠️ OPTIONAL (Can skip if not available)

**Source:** 
- Should be in `payment.merchantOrderId` (but not in your doc)
- OR use `orderNumber` as fallback: `"ORD251201330"`

**Value for API:** `"ORD251201330"` (your orderNumber) or leave it out

**Note:** The verify endpoint can work without this - it will find your order by `razorpay_order_id` first.

---

## 3️⃣ razorpay_payment_id ❌ NOT YET AVAILABLE

**Source:** Razorpay Callback/Redirect URL (after user pays)

**When user completes payment on Razorpay page, they are redirected to your callback URL with:**

```
https://your-callback-url.com/payment/status?
  razorpay_payment_id=pay_LP1234567890  ← GET THIS FROM URL
```

**Extract with JavaScript:**
```javascript
const urlParams = new URLSearchParams(window.location.search);
const razorpay_payment_id = urlParams.get('razorpay_payment_id');
```

**Value for API:** `"pay_LP1234567890"` (example - will be different for each payment)

---

## 4️⃣ razorpay_signature ❌ NOT YET AVAILABLE

**Source:** Razorpay Callback/Redirect URL (after user pays)

**From the same redirect URL:**

```
https://your-callback-url.com/payment/status?
  razorpay_signature=a1b2c3d4e5f6789...  ← GET THIS FROM URL
```

**Extract with JavaScript:**
```javascript
const urlParams = new URLSearchParams(window.location.search);
const razorpay_signature = urlParams.get('razorpay_signature');
```

**Value for API:** `"a1b2c3d4e5f6789..."` (long hash string)

---

## 📝 Complete Example: How to Call Verify API

### After User Pays (Frontend Code)

```javascript
// Step 1: Get values from URL (after Razorpay redirect)
const urlParams = new URLSearchParams(window.location.search);
const razorpay_payment_id = urlParams.get('razorpay_payment_id');
const razorpay_signature = urlParams.get('razorpay_signature');
const razorpay_order_id = urlParams.get('razorpay_order_id') || 
                          urlParams.get('razorpay_payment_link_id');

// Step 2: Get razorpay_order_id from your order (or URL)
// From your order document: "order_RmIep9e4D5KpAW"
const orderRazorpayId = "order_RmIep9e4D5KpAW"; // or from URL above

// Step 3: Get merchantOrderId (optional - can use orderNumber)
const merchantOrderId = "ORD251201330"; // Your orderNumber

// Step 4: Call verify API
const response = await fetch('/api/v1/payments/razorpay/verify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    razorpay_order_id: orderRazorpayId,      // ✅ From order doc or URL
    razorpay_payment_id: razorpay_payment_id, // ✅ From URL (after payment)
    razorpay_signature: razorpay_signature,   // ✅ From URL (after payment)
    merchantOrderId: merchantOrderId          // ⚪ Optional (your orderNumber)
  })
});

const result = await response.json();
console.log('Verification result:', result);
```

---

## 🔄 Alternative: Check Status (Without Signature)

If you just want to check if payment is completed (without full verification):

```javascript
// Check status using your orderNumber or razorpay_order_id
const response = await fetch(
  `/api/v1/payments/razorpay/status?merchantOrderId=ORD251201330`,
  {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  }
);

// OR using razorpay_order_id:
const response2 = await fetch(
  `/api/v1/payments/razorpay/status?orderId=order_RmIep9e4D5KpAW`,
  {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  }
);
```

---

## ⚡ Summary Table

| Field | Where to Get | Your Value | Status |
|-------|-------------|------------|--------|
| **razorpay_order_id** | `payment.transactionId` in order doc | `"order_RmIep9e4D5KpAW"` | ✅ Available |
| **merchantOrderId** | `orderNumber` (fallback) | `"ORD251201330"` | ⚠️ Optional |
| **razorpay_payment_id** | URL params after payment | Not yet | ⏳ Wait for payment |
| **razorpay_signature** | URL params after payment | Not yet | ⏳ Wait for payment |

---

## 🎯 Next Steps

1. ✅ **You already have:** `razorpay_order_id` = `"order_RmIep9e4D5KpAW"`
2. ⏳ **Wait for user to pay:** They will be redirected to your callback URL
3. ✅ **Extract from URL:** `razorpay_payment_id` and `razorpay_signature`
4. ✅ **Call verify API:** Use all values to verify payment

---

## 📞 Callback URL Configuration

Make sure your callback URL is set correctly. When creating payment, the callback URL should be:
- Set in `RAZORPAY_CALLBACK_URL` environment variable, OR
- Defaults to: `${BASE_URL}/payment/status`

This is where Razorpay will redirect users after payment with the verification parameters.

