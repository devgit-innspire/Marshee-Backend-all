# Shiprocket Login API

## Endpoint

**POST** `/api/v1/shiprocket/login`

## Description

Login to Shiprocket and get an access token. This token is required for all other Shiprocket API calls.

## Request Body

```json
{
  "email": "marshee01@marshee.com",
  "password": "f1f@VfIV&7yw0A1i!LCINy9i47au5jnR"
}
```

## Response

### Success (200 OK)

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

### Error (400 Bad Request)

```json
{
  "success": false,
  "message": "Email and password are required"
}
```

### Error (401 Unauthorized)

```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

## Example Usage

### Using cURL

```bash
curl -X POST http://localhost:5000/api/v1/shiprocket/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "marshee01@marshee.com",
    "password": "f1f@VfIV&7yw0A1i!LCINy9i47au5jnR"
  }'
```

### Using JavaScript/Fetch

```javascript
const response = await fetch('http://localhost:5000/api/v1/shiprocket/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'marshee01@marshee.com',
    password: 'f1f@VfIV&7yw0A1i!LCINy9i47au5jnR'
  })
});

const data = await response.json();
console.log('Token:', data.data.token);
```

### Using Axios

```javascript
const axios = require('axios');

const response = await axios.post('http://localhost:5000/api/v1/shiprocket/login', {
  email: 'marshee01@marshee.com',
  password: 'f1f@VfIV&7yw0A1i!LCINy9i47au5jnR'
});

console.log('Token:', response.data.data.token);
```

## Environment Variables

Make sure you have the base URL set in your `.env` file (optional, has default):

```env
SHIPROCKET_BASE_URL=https://apiv2.shiprocket.in/v1/external
```

If not set, it will use the default URL: `https://apiv2.shiprocket.in/v1/external`

## Next Steps

After getting the token, you can use it for:

1. ✅ Check serviceability - `/courier/serviceability`
2. ✅ Create order - `/orders/create/adhoc`
3. ✅ Assign courier - `/courier/assign/awb`
4. ✅ Generate pickup - `/courier/generate/pickup`

All these APIs will be implemented next!

## Notes

- The token is valid for a limited time (usually 10 days)
- Store the token securely
- You'll need to login again when the token expires
- The token should be sent in the `Authorization` header as `Bearer <token>` for other Shiprocket API calls

