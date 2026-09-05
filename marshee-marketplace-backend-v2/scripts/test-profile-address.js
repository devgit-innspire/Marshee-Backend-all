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
    const firebaseUID = randomUid('testUID');
    const phoneNumber = '+911234567890';
    const timestamp = nowIso();

    // 1) Firebase token login (creates/returns user and token)
    const authRes = await request(app)
      .post('/api/v1/auth/token')
      .send({ firebaseUID, phoneNumber, timestamp });

    if (!authRes.body || !authRes.body.success) {
      throw new Error('Auth/token failed: ' + JSON.stringify(authRes.body));
    }

    const token = authRes.body.token;
    const userId = authRes.body.user.id;
    console.log('Token acquired for user:', userId);

    // 2) Update profile with email and address (address has no email field)
    const profilePayload = {
      name: 'Test User',
      email: `test_${Date.now()}@example.com`,
      avatar: 'https://example.com/a.png',
      address: {
        addressType: 'home',
        billingAddress: {
          street: '221B Baker Street',
          city: 'London',
          state: 'London',
          postalCode: 'NW1',
          country: 'UK'
        },
        shippingAddress: {
          street: '742 Evergreen Terrace',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62704',
          country: 'US'
        },
        isDefaultBilling: true,
        isDefaultShipping: true
      }
    };

    const updRes = await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(profilePayload);

    if (!updRes.body || !updRes.body.success) {
      throw new Error('Profile update failed: ' + JSON.stringify(updRes.body));
    }

    const updatedUser = updRes.body.data;
    console.log('Profile updated. Email:', updatedUser.email, 'AddressId:', updatedUser.address);

    if (!updatedUser.email) {
      throw new Error('User email missing after profile update');
    }
    if (!updatedUser.address) {
      throw new Error('User address not linked after profile update');
    }

    // 3) Fetch addresses and ensure there is no email field on Address docs
    const addrRes = await request(app)
      .get('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .query({ user: userId, page: 1, limit: 5 });

    if (!addrRes.body || !addrRes.body.success) {
      throw new Error('Get addresses failed: ' + JSON.stringify(addrRes.body));
    }

    const addresses = addrRes.body.data || [];
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error('No addresses returned for user');
    }

    const hasEmailKey = addresses.some(a => Object.prototype.hasOwnProperty.call(a, 'email'));
    if (hasEmailKey) {
      throw new Error('Address contains email field, which should be removed');
    }

    console.log('Addresses validated. No email on Address documents. Count:', addresses.length);

    console.log('SUCCESS: Profile and Address flows are working as expected');
    process.exit(0);
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
}

run();


