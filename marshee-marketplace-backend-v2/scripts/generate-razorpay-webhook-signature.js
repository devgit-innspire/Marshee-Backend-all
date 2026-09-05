const crypto = require('crypto');
require('dotenv').config();

/**
 * Helper script to generate Razorpay webhook signature for testing
 * 
 * Usage:
 * node scripts/generate-razorpay-webhook-signature.js
 */

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!webhookSecret) {
    console.error('❌ RAZORPAY_WEBHOOK_SECRET not found in .env file');
    process.exit(1);
}

// Sample webhook payload (payment.captured event)
const samplePayload = {
    event: "payment.captured",
    payload: {
        payment: {
            entity: {
                id: "pay_test123",
                entity: "payment",
                amount: 10000,
                currency: "INR",
                status: "captured",
                order_id: "order_test123",
                invoice_id: null,
                international: false,
                method: "netbanking",
                amount_refunded: 0,
                refund_status: null,
                captured: true,
                description: "Test payment",
                card_id: null,
                bank: "HDFC",
                wallet: null,
                vpa: null,
                email: "test@example.com",
                contact: "+919999999999",
                notes: {
                    merchantOrderId: "ORDER_12345"
                },
                fee: 236,
                tax: 36,
                error_code: null,
                error_description: null,
                error_source: null,
                error_step: null,
                error_reason: null,
                acquirer_data: {},
                created_at: Math.floor(Date.now() / 1000)
            }
        }
    }
};

// Convert payload to JSON string (this is what Razorpay sends)
const body = JSON.stringify(samplePayload);

// Generate signature
const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

console.log('\n📋 Postman Configuration:\n');
console.log('URL: POST http://localhost:5000/api/v1/payments/razorpay/webhook\n');
console.log('Headers:');
console.log('  Content-Type: application/json');
console.log(`  x-razorpay-signature: ${signature}\n`);
console.log('Body (raw JSON):');
console.log(JSON.stringify(samplePayload, null, 2));
console.log('\n✅ Copy the signature above to Postman header: x-razorpay-signature\n');

