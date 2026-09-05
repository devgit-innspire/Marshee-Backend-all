/**
 * Helper script to generate a test JWT token for a specific user ID
 * Usage: node scripts/generateTestToken.js
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const config = require('../config/config');

const userId = '691eafe4599823147045af87';
const jwtSecret = process.env.JWT_SECRET || config.jwtSecret || 'your-secret-key';
const jwtExpire = process.env.JWT_EXPIRE || config.jwtExpire || '30d';

// Create token payload
const payload = {
    id: userId,
    // Add other fields if needed
    role: 'user'
};

// Generate token
const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpire });

console.log('\n=== TEST JWT TOKEN GENERATED ===\n');
console.log('User ID:', userId);
console.log('Token:', token);
console.log('\n=== POSTMAN SETUP ===');
console.log('1. Copy the token above');
console.log('2. In Postman, go to Authorization tab');
console.log('3. Select "Bearer Token" type');
console.log('4. Paste the token');
console.log('\n=== OR USE HEADER ===');
console.log('Header: Authorization');
console.log('Value: Bearer ' + token);
console.log('\n=== TEST ENDPOINT ===');
console.log('GET http://localhost:8080/api/v1/pet-fitness-sessions/pet/YOUR_PET_ID');
console.log('\n');




