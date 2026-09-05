# Shiprocket Serviceability API (GET)

## Endpoint

**GET** `/api/v1/shiprocket/serviceability`

## Description

Check serviceability and get available courier companies for shipping between two locations. This is a GET request that uses query parameters.

## Authentication

**Required**: Bearer token in Authorization header

```
Authorization: Bearer <your-token>
```

Get the token from: `POST /api/v1/shiprocket/login`

## Query Parameters

### Option 1: Using Order ID (Simplest)

```
GET /api/v1/shiprocket/serviceability?order_id=1090927728
```

**Parameters:**
- `order_id` (required): Shiprocket order ID

### Option 2: Using Postcodes (Most Common)

```
GET /api/v1/shiprocket/serviceability?pickup_postcode=110030&delivery_postcode=122002&weight=2&cod=1
```

**Required Parameters:**
- `pickup_postcode` (required): Pickup location pincode
- `delivery_postcode` (required): Delivery location pincode
- `weight` (required): Weight in kgs (as string, e.g., "2")
- `cod` (required): Cash on delivery - `true`/`false` or `1`/`0`

**Optional Parameters:**
- `length`: Length in cms (integer)
- `breadth`: Breadth in cms (integer)
- `height`: Height in cms (integer)
- `declared_value`: Price in rupees (integer)
- `mode`: `Surface` or `Air` (string)
- `is_return`: Return order flag - `1` or `0` (integer)
- `couriers_type`: Filter documents couriers - `1` (integer)
- `only_local`: Filter hyperlocal couriers - `1` (integer)
- `qc_check`: QC-enabled couriers - `1` (integer, requires `is_return=1`)

## Response

### Success (200 OK)

```json
{
  "success": true,
  "message": "Serviceability checked successfully",
  "data": {
    "status": 200,
    "data": {
      "available_courier_companies": [
        {
          "courier_company_id": 101,
          "courier_name": "Delhivery Surface 20kg",
          "rate": 887.95,
          "freight_charge": 839.6,
          "cod_charges": 48.35,
          "estimated_delivery_days": "4",
          "etd": "Dec 23, 2025",
          "cod": 1,
          "weight": 20
        }
      ]
    }
  }
}
```

## Example Usage

### Using Order ID

```bash
curl -X GET "http://localhost:5000/api/v1/shiprocket/serviceability?order_id=1090927728" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using Postcodes

```bash
curl -X GET "http://localhost:5000/api/v1/shiprocket/serviceability?pickup_postcode=110030&delivery_postcode=122002&weight=2&cod=1" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### With Optional Parameters

```bash
curl -X GET "http://localhost:5000/api/v1/shiprocket/serviceability?pickup_postcode=110030&delivery_postcode=122002&weight=2&cod=1&length=15&breadth=10&height=5&mode=Air" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Using JavaScript/Fetch

```javascript
// Step 1: Login and get token
const loginResponse = await fetch('http://localhost:5000/api/v1/shiprocket/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'marshee01@marshee.com',
    password: 'f1f@VfIV&7yw0A1i!LCINy9i47au5jnR'
  })
});
const { data: { token } } = await loginResponse.json();

// Step 2: Check serviceability using order_id
const serviceabilityResponse = await fetch(
  'http://localhost:5000/api/v1/shiprocket/serviceability?order_id=1090927728',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
const serviceabilityData = await serviceabilityResponse.json();
console.log('Available couriers:', serviceabilityData.data.data.available_courier_companies);

// Or using postcodes
const serviceabilityResponse2 = await fetch(
  'http://localhost:5000/api/v1/shiprocket/serviceability?pickup_postcode=110030&delivery_postcode=122002&weight=2&cod=1',
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
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

// Step 2: Check serviceability
const serviceabilityResponse = await axios.get(
  'http://localhost:5000/api/v1/shiprocket/serviceability',
  {
    params: {
      order_id: '1090927728'
      // OR use postcodes:
      // pickup_postcode: '110030',
      // delivery_postcode: '122002',
      // weight: '2',
      // cod: '1'
    },
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);

console.log('Available couriers:', serviceabilityResponse.data.data.data.available_courier_companies);
```

## Notes

- **GET Request**: This is a GET request, so parameters go in the URL query string, not in the request body
- **COD Format**: `cod` can be `true`/`false`, `1`/`0`, or `"1"`/`"0"` - all will be converted to 1 or 0
- **Weight Format**: Weight should be provided as a string (e.g., `"2"` not `2`)
- **Order ID vs Postcodes**: Use either `order_id` OR the combination of `pickup_postcode`, `delivery_postcode`, `weight`, and `cod`
- **Response**: Returns an array of available courier companies with rates, delivery times, and performance metrics

## Error Responses

### Missing Token (401)
```json
{
  "success": false,
  "message": "Authorization token is required. Format: Bearer <token>"
}
```

### Missing Parameters (400)
```json
{
  "success": false,
  "message": "Either order_id OR (pickup_postcode and delivery_postcode) must be provided"
}
```

### Missing Weight/COD (400)
```json
{
  "success": false,
  "message": "When using postcodes, both weight and cod are required"
}
```

