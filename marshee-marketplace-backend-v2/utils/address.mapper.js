// Maps an Address document (shipping or billing) to the Order address shape

function buildOrderAddressPayload(params) {
  const {
    name,
    phone,
    email,
    street,
    city,
    state,
    postalCode,
    country
  } = params;

  return {
    name: name,
    phone: phone,
    email: email,
    address: {
      street: street,
      city: city,
      state: state,
      pinCode: postalCode,
      country: country
    }
  };
}

function mapAddressDocToOrderPayload(addressDoc, fallback) {
  if (!addressDoc) {
    return buildOrderAddressPayload(fallback);
  }

  // Prefer shipping section; fallback to billing if missing
  const src = (addressDoc.shippingAddress && Object.keys(addressDoc.shippingAddress).length > 0)
    ? addressDoc.shippingAddress
    : (addressDoc.billingAddress || {});

  return buildOrderAddressPayload({
    name: fallback.name,
    phone: fallback.phone,
    email: fallback.email,
    street: src.street || fallback.street,
    city: src.city || fallback.city,
    state: src.state || fallback.state,
    postalCode: src.postalCode || fallback.postalCode,
    country: src.country || fallback.country
  });
}

module.exports = {
  mapAddressDocToOrderPayload,
  buildOrderAddressPayload
};


