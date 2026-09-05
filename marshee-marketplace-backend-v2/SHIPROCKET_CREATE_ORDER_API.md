# Shiprocket Create Order API

## Endpoint

**POST** `/api/v1/shiprocket/orders/create`

## Description

Create a custom order (adhoc order) in Shiprocket. This API allows you to create orders without storing product details in the master catalogue.

## Authentication

**Required**: Bearer token in Authorization header

```
Authorization: Bearer <your-token>
```

Get the token from: `POST /api/v1/shiprocket/login`

## Request Body

### Required Fields

```json
{
  "order_id": "224-447",
  "order_date": "2019-07-24 11:11",
  "pickup_location": "Jammu",
  "billing_customer_name": "Naruto",
  "billing_address": "House 221B, Leaf Village",
  "billing_city": "New Delhi",
  "billing_pincode": 110002,
  "billing_state": "Delhi",
  "billing_country": "India",
  "billing_email": "naruto@uzumaki.com",
  "billing_phone": 9876543210,
  "shipping_is_billing": true,
  "order_items": [
    {
      "name": "Kunai",
      "sku": "chakra123",
      "units": 10,
      "selling_price": 900
    }
  ],
  "payment_method": "Prepaid",
  "sub_total": 9000,
  "length": 10,
  "breadth": 15,
  "height": 20,
  "weight": 2.5
}
```

### Optional Fields

```json
{
  "channel_id": 27022,
  "comment": "Reseller: M/s Goku",
  "reseller_name": "Reseller: Divine",
  "company_name": "Amazon",
  "billing_last_name": "Uzumaki",
  "billing_address_2": "Near Hokage House",
  "billing_isd_code": "+91",
  "billing_alternate_phone": 8604690454,
  "shipping_customer_name": "Jane",
  "shipping_last_name": "Doe",
  "shipping_address": "Lane number 69",
  "shipping_address_2": "Andheri",
  "shipping_city": "Mumbai",
  "shipping_pincode": 200912,
  "shipping_country": "India",
  "shipping_state": "Maharashtra",
  "shipping_email": "jane@doe.com",
  "shipping_phone": 9876543210,
  "shipping_charges": 5,
  "giftwrap_charges": 5,
  "transaction_charges": 5,
  "total_discount": 15,
  "longitude": 69.0747,
  "latitude": 22.4064,
  "ewaybill_no": "K92373490",
  "customer_gstin": "29ABCDE1234F2Z5",
  "invoice_number": "INV-123",
  "order_type": "ESSENTIALS",
  "checkout_shipping_method": "SR_STANDARD",
  "what3words_address": "toddler.geologist.animated",
  "is_insurance_opt": true,
  "is_document": 0,
  "order_tag": "abc, xyz"
}
```

### Order Items Structure

Each item in `order_items` array:

```json
{
  "name": "Product Name",      // Required
  "sku": "SKU123",             // Required
  "units": 10,                 // Required, must be > 0
  "selling_price": 900,         // Required
  "discount": 10,               // Optional
  "tax": 5,                     // Optional
  "hsn": 441122                 // Optional
}
```

## Response

### Success (201 Created)

```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "order_id": 123456,
    "shipment_id": 789012,
    "status": "NEW",
    "status_code": 1,
    "onboarding_completed_now": 0,
    "awb_code": null,
    "courier_company_id": null,
    "courier_name": null
  }
}
```

### Error (400 Bad Request)

```json
{
  "success": false,
  "message": "order_id is required"
}
```

## Example Usage

### Using cURL

```bash
# 1. First, get token
TOKEN=$(curl -X POST http://localhost:5000/api/v1/shiprocket/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "marshee01@marshee.com",
    "password": "f1f@VfIV&7yw0A1i!LCINy9i47au5jnR"
  }' | jq -r '.data.token')

# 2. Create order
curl -X POST http://localhost:5000/api/v1/shiprocket/orders/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "order_id": "224-447",
    "order_date": "2019-07-24 11:11",
    "pickup_location": "Jammu",
    "billing_customer_name": "Naruto",
    "billing_address": "House 221B, Leaf Village",
    "billing_city": "New Delhi",
    "billing_pincode": 110002,
    "billing_state": "Delhi",
    "billing_country": "India",
    "billing_email": "naruto@uzumaki.com",
    "billing_phone": 9876543210,
    "shipping_is_billing": true,
    "order_items": [
      {
        "name": "Kunai",
        "sku": "chakra123",
        "units": 10,
        "selling_price": 900
      }
    ],
    "payment_method": "Prepaid",
    "sub_total": 9000,
    "length": 10,
    "breadth": 15,
    "height": 20,
    "weight": 2.5
  }'
```

### Using JavaScript/Fetch

```javascript
// Step 1: Login
const loginResponse = await fetch('http://localhost:5000/api/v1/shiprocket/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'marshee01@marshee.com',
    password: 'f1f@VfIV&7yw0A1i!LCINy9i47au5jnR'
  })
});
const { data: { token } } = await loginResponse.json();

// Step 2: Create order
const orderResponse = await fetch('http://localhost:5000/api/v1/shiprocket/orders/create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    order_id: '224-447',
    order_date: '2019-07-24 11:11',
    pickup_location: 'Jammu',
    billing_customer_name: 'Naruto',
    billing_address: 'House 221B, Leaf Village',
    billing_city: 'New Delhi',
    billing_pincode: 110002,
    billing_state: 'Delhi',
    billing_country: 'India',
    billing_email: 'naruto@uzumaki.com',
    billing_phone: 9876543210,
    shipping_is_billing: true,
    order_items: [
      {
        name: 'Kunai',
        sku: 'chakra123',
        units: 10,
        selling_price: 900
      }
    ],
    payment_method: 'Prepaid',
    sub_total: 9000,
    length: 10,
    breadth: 15,
    height: 20,
    weight: 2.5
  })
});

const orderData = await orderResponse.json();
console.log('Order created:', orderData.data);
```

### Using Axios

```javascript
const axios = require('axios');

// Step 1: Login
const loginResponse = await axios.post('http://localhost:5000/api/v1/shiprocket/login', {
  email: 'marshee01@marshee.com',
  password: 'f1f@VfIV&7yw0A1i!LCINy9i47au5jnR'
});
const token = loginResponse.data.data.token;

// Step 2: Create order
const orderResponse = await axios.post(
  'http://localhost:5000/api/v1/shiprocket/orders/create',
  {
    order_id: '224-447',
    order_date: '2019-07-24 11:11',
    pickup_location: 'Jammu',
    billing_customer_name: 'Naruto',
    billing_address: 'House 221B, Leaf Village',
    billing_city: 'New Delhi',
    billing_pincode: 110002,
    billing_state: 'Delhi',
    billing_country: 'India',
    billing_email: 'naruto@uzumaki.com',
    billing_phone: 9876543210,
    shipping_is_billing: true,
    order_items: [
      {
        name: 'Kunai',
        sku: 'chakra123',
        units: 10,
        selling_price: 900
      }
    ],
    payment_method: 'Prepaid',
    sub_total: 9000,
    length: 10,
    breadth: 15,
    height: 20,
    weight: 2.5
  },
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

console.log('Order created:', orderResponse.data.data);
```

## Important Notes

1. **order_id**: Must be unique. Cannot be the same as an existing or cancelled order.
2. **order_date**: Format: `yyyy-mm-dd HH:mm` (e.g., "2019-07-24 11:11")
3. **pickup_location**: Must match a pickup location name in your Shiprocket account
4. **shipping_is_billing**: 
   - If `true`: Shipping address fields are not required
   - If `false`: All shipping address fields are required
5. **Dimensions**: `length`, `breadth`, `height` must be > 0.5 cm
6. **Weight**: Must be > 0 kg
7. **sub_total**: Must be calculated correctly (not auto-calculated by API)
8. **payment_method**: Must be either `"COD"` or `"Prepaid"`
9. **order_items**: Array must contain at least one item

## Field Validation

The API validates:
- ✅ All required fields are present
- ✅ order_items array is not empty
- ✅ Each order item has required fields (name, sku, units, selling_price)
- ✅ Dimensions are > 0.5
- ✅ Weight is > 0
- ✅ Shipping address fields when shipping_is_billing is false

## Error Responses

### Missing Required Field (400)
```json
{
  "success": false,
  "message": "order_id is required"
}
```

### Invalid Dimensions (400)
```json
{
  "success": false,
  "message": "length is required and must be more than 0.5"
}
```

### Missing Shipping Address (400)
```json
{
  "success": false,
  "message": "shipping_customer_name is required when shipping_is_billing is false"
}
```

### Duplicate Order ID (422)
```json
{
  "success": false,
  "message": "Order ID already exists"
}
```

## Next Steps

After creating an order, you can:
1. ✅ Assign courier - `/courier/assign/awb`
2. ✅ Generate pickup - `/courier/generate/pickup`
3. ✅ Track order - Use the `order_id` returned in response

