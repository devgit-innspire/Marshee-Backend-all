const crypto = require('crypto');
require('dotenv').config();

/**
 * Generate signature from an exact JSON body string
 * 
 * Usage:
 * node scripts/generate-signature-from-body.js
 * 
 * Then paste the exact JSON body you're sending in Postman
 */

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!webhookSecret) {
    console.error('❌ RAZORPAY_WEBHOOK_SECRET not found in .env file');
    process.exit(1);
}

// Paste your EXACT JSON body here (copy from Postman or from the webhook logs)
// IMPORTANT: Copy the EXACT body including all spaces, newlines, and formatting
// This is the formatted version that Postman sends when you use "JSON" type
const bodyString = `{
  "event": "payment_link.paid",
  "payload": {
    "payment_link": {
      "entity": {
        "id": "plink_Rozf8WF6Ulenbc",
        "entity": "payment_link",
        "amount": 50000,
        "currency": "INR",
        "accept_partial": false,
        "first_min_partial_amount": 0,
        "description": "Test Payment",
        "customer": {
          "name": "Test User",
          "email": "test@example.com",
          "contact": "9876543210"
        },
        "notify": {
          "sms": true,
          "email": true
        },
        "reminder_enable": false,
        "notes": {},
        "created_at": 1765170080,
        "updated_at": 1765170080,
        "status": "paid",
        "amount_paid": 50000,
        "amount_due": 0,
        "payments": [
          {
            "entity": {
              "id": "pay_RozfZVh6hT5TJt",
              "entity": "payment",
              "amount": 50000,
              "currency": "INR",
              "status": "captured",
              "order_id": null,
              "invoice_id": null,
              "international": false,
              "method": "netbanking",
              "amount_refunded": 0,
              "refund_status": null,
              "captured": true,
              "description": "Test Payment",
              "card_id": null,
              "bank": "HDFC",
              "wallet": null,
              "vpa": null,
              "email": "test@example.com",
              "contact": "+919999999999",
              "notes": {},
              "fee": 236,
              "tax": 36,
              "error_code": null,
              "error_description": null,
              "error_source": null,
              "error_step": null,
              "error_reason": null,
              "acquirer_data": {},
              "created_at": 1765170080
            }
          }
        ]
      }
    }
  }
}`;

// Generate signature from the exact body
const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(bodyString)
    .digest('hex');

console.log('\n📋 Signature for your exact body:\n');
console.log('x-razorpay-signature:', signature);
console.log('\n✅ Use this signature in Postman header\n');

