const crypto = require('crypto');
require('dotenv').config();

/**
 * Generate Razorpay webhook payload and signature for a specific payment
 * 
 * Usage:
 * node scripts/generate-webhook-for-payment.js
 * 
 * Or with custom values:
 * PAYMENT_ID=pay_xxx PAYMENT_LINK_ID=plink_xxx node scripts/generate-webhook-for-payment.js
 */

const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!webhookSecret) {
    console.error('❌ RAZORPAY_WEBHOOK_SECRET not found in .env file');
    process.exit(1);
}

// Get values from environment or use defaults from your console output
const paymentId = process.env.PAYMENT_ID || 'pay_RozLi5yqbCfrEJ';
const paymentLinkId = process.env.PAYMENT_LINK_ID || 'plink_RozL7Wg5CR882m';

// Razorpay webhook payload structure for payment_link.paid event
const webhookPayload = {
    event: "payment_link.paid",
    payload: {
        payment_link: {
            entity: {
                id: paymentLinkId,
                entity: "payment_link",
                amount: 50000,
                currency: "INR",
                accept_partial: false,
                first_min_partial_amount: 0,
                description: "Test Payment",
                customer: {
                    name: "Test User",
                    email: "test@example.com",
                    contact: "9876543210"
                },
                notify: {
                    sms: true,
                    email: true
                },
                reminder_enable: false,
                notes: {
                    // Add your merchantOrderId here if you have it
                    // merchantOrderId: "ORDER_12345"
                },
                created_at: Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000),
                status: "paid",
                amount_paid: 50000,
                amount_due: 0,
                payments: [
                    {
                        entity: {
                            id: paymentId,
                            entity: "payment",
                            amount: 50000,
                            currency: "INR",
                            status: "captured",
                            order_id: null,
                            invoice_id: null,
                            international: false,
                            method: "netbanking",
                            amount_refunded: 0,
                            refund_status: null,
                            captured: true,
                            description: "Test Payment",
                            card_id: null,
                            bank: "HDFC",
                            wallet: null,
                            vpa: null,
                            email: "test@example.com",
                            contact: "+919999999999",
                            notes: {},
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
                ]
            }
        }
    }
};

// Convert payload to JSON string (compact format - no extra whitespace)
// This matches what Postman typically sends
const body = JSON.stringify(webhookPayload);

// Generate signature from the exact body
const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

console.log('\n📋 Postman Configuration for Webhook:\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Method: POST');
console.log('URL: http://localhost:5001/api/v1/payments/razorpay/webhook\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Headers:');
console.log('  Content-Type: application/json');
console.log(`  x-razorpay-signature: ${signature}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Body (raw JSON - copy this EXACTLY, including all formatting):');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
// Show both compact and formatted versions
console.log('📋 COMPACT VERSION (use this in Postman - select "raw" and "JSON"):');
console.log(body);
console.log('\n📋 FORMATTED VERSION (for readability only):');
console.log(JSON.stringify(webhookPayload, null, 2));
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('✅ Instructions:');
console.log('1. Copy the signature above to Postman header: x-razorpay-signature');
console.log('2. Copy the JSON body above to Postman body (raw JSON)');
console.log('3. Make sure Content-Type is application/json');
console.log('4. Send the request\n');

