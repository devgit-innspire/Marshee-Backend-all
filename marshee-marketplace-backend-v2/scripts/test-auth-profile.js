const request = require('supertest');
const app = require('../server');

function nowIso() {
  return new Date().toISOString();
}

function randomUid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

async function run() {
  try {
    const firebaseUID = randomUid('profileUID');
    const phoneNumber = '+919876543210';
    const timestamp = nowIso();

    // 1) Login via Firebase token to get JWT + user
    const tokenRes = await request(app)
      .post('/api/v1/auth/token')
      .send({ firebaseUID, phoneNumber, timestamp });

    if (!tokenRes.body?.success || !tokenRes.body?.token) {
      throw new Error('auth/token failed: ' + JSON.stringify(tokenRes.body));
    }

    const token = tokenRes.body.token;
    const userBefore = tokenRes.body.user;
    console.log('Logged in user:', userBefore.id);

    // 2) GET /auth/me before updates
    const meBefore = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    if (!meBefore.body?.success || !meBefore.body?.data) {
      throw new Error('GET /auth/me (before) failed: ' + JSON.stringify(meBefore.body));
    }
    console.log('GET /me before: role=', meBefore.body.data.role);

    // 3) PUT /auth/profile to update user fields and address (no address.email)
    const newEmail = `profile_${Date.now()}@example.com`;
    const updatePayload = {
      name: 'Profile Test',
      email: newEmail,
      avatar: 'https://example.com/p.png',
      address: {
        addressType: 'home',
        billingAddress: { street: '10 Downing', city: 'London', state: 'London', postalCode: 'SW1A', country: 'UK' },
        shippingAddress: { street: '1 Infinite Loop', city: 'Cupertino', state: 'CA', postalCode: '95014', country: 'US' },
        isDefaultBilling: true,
        isDefaultShipping: true
      }
    };

    const updateRes = await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(updatePayload);

    if (!updateRes.body?.success) {
      throw new Error('PUT /auth/profile failed: ' + JSON.stringify(updateRes.body));
    }

    const updated = updateRes.body.data;
    if (updated.email !== newEmail) {
      throw new Error('Email not updated on user');
    }
    if (!updated.address) {
      throw new Error('User.address not set/linked after profile update');
    }

    console.log('Profile updated. user.email=', updated.email, 'addressId=', updated.address._id || updated.address);

    // 4) GET /auth/me after updates
    const meAfter = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    if (!meAfter.body?.success || !meAfter.body?.data) {
      throw new Error('GET /auth/me (after) failed: ' + JSON.stringify(meAfter.body));
    }

    if (meAfter.body.data.email !== newEmail) {
      throw new Error('GET /auth/me does not reflect updated email');
    }
    console.log('GET /me after: email=', meAfter.body.data.email);

    console.log('SUCCESS: Profile routes (GET /me, PUT /profile) working as expected');
    process.exit(0);
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
}

run();


