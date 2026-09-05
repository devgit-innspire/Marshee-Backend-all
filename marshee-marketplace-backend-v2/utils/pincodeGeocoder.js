/**
 * Lightweight pincode → {lat, lng, city, state} resolver with in-memory TTL cache.
 * Uses zippopotam.us (free, no API key, CORS-friendly). Falls back to
 * api.postalpincode.in for Indian pincodes when the primary source is down.
 *
 * Returns null if the pincode cannot be resolved.
 */
const axios = require('axios');

const CACHE = new Map(); // pincode -> { value, expiresAt }
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const isValidIndianPincode = (v) => /^\d{6}$/.test(String(v || '').trim());

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const resolveFromZippopotam = async (pincode) => {
  try {
    const res = await axios.get(`https://api.zippopotam.us/in/${pincode}`, { timeout: 4000 });
    const place = res?.data?.places?.[0];
    if (!place) return null;
    const lat = Number(place.latitude);
    const lng = Number(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      pincode: String(pincode),
      lat,
      lng,
      city: String(place['place name'] || '').trim(),
      state: String(place.state || '').trim(),
      country: 'India',
      source: 'zippopotam'
    };
  } catch {
    return null;
  }
};

// OpenStreetMap Nominatim fallback for lat/lng by pincode.
// Useful when zippopotam is unavailable/rate-limited.
const resolveFromNominatim = async (pincode) => {
  try {
    const res = await axios.get('https://nominatim.openstreetmap.org/search', {
      timeout: 5000,
      params: {
        postalcode: String(pincode),
        country: 'India',
        format: 'json',
        addressdetails: 1,
        limit: 1
      },
      headers: {
        // Nominatim requests should identify a caller
        'User-Agent': 'marshee-relocation-quote/1.0'
      }
    });
    const row = Array.isArray(res?.data) ? res.data[0] : null;
    if (!row) return null;
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const address = row.address || {};
    const city =
      String(
        address.city ||
          address.town ||
          address.village ||
          address.county ||
          address.state_district ||
          ''
      ).trim();
    const state = String(address.state || '').trim();
    return {
      pincode: String(pincode),
      lat,
      lng,
      city,
      state,
      country: 'India',
      source: 'nominatim'
    };
  } catch {
    return null;
  }
};

// Indian govt API — no coords, but returns district/state. Only used as a last
// resort so the quote endpoint can still surface a city/state even if distance
// geocoding fails.
const resolveFromIndiaPost = async (pincode) => {
  try {
    const res = await axios.get(`https://api.postalpincode.in/pincode/${pincode}`, { timeout: 4000 });
    const row = Array.isArray(res?.data) ? res.data[0] : null;
    const office = row?.PostOffice?.[0];
    if (!office) return null;
    return {
      pincode: String(pincode),
      lat: null,
      lng: null,
      city: String(office.District || office.Name || '').trim(),
      state: String(office.State || '').trim(),
      country: 'India',
      source: 'india-post'
    };
  } catch {
    return null;
  }
};

const resolvePincode = async (pincode) => {
  const key = String(pincode || '').trim();
  if (!isValidIndianPincode(key)) return null;

  const cached = CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    const hasCoords =
      Number.isFinite(Number(cached?.value?.lat)) &&
      Number.isFinite(Number(cached?.value?.lng));
    if (hasCoords) return cached.value;
    // Stale/low-quality cache entry (without coords): retry upstream resolvers.
  }

  let value = await resolveFromZippopotam(key);
  if (!value) value = await resolveFromNominatim(key);
  if (!value) value = await resolveFromIndiaPost(key);

  if (value) {
    const hasCoords =
      Number.isFinite(Number(value?.lat)) &&
      Number.isFinite(Number(value?.lng));
    // Only cache coordinate-backed results; otherwise we'd pin distance to 0
    // for long TTL windows if a provider transiently returns no lat/lng.
    if (hasCoords) {
    CACHE.set(key, { value, expiresAt: Date.now() + TTL_MS });
    }
  }
  return value;
};

module.exports = {
  resolvePincode,
  haversineKm,
  isValidIndianPincode
};
