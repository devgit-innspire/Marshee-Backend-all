/**
 * Staff permission catalogue.
 *
 * A full `admin` implicitly holds every permission — the catalogue exists to
 * describe what a `subadmin` may be granted. Before this existed a sub-admin
 * could do everything an admin could except payment-out, user records and staff
 * management; now an admin hands out exactly the checkpoints each person needs.
 *
 * Keys are stable strings stored on the user document. Renaming one silently
 * revokes access for everyone who held it, so treat them as permanent: add a
 * new key and migrate rather than editing an existing one.
 */

const PERMISSION_GROUPS = [
  {
    group: 'Catalogue',
    permissions: [
      { key: 'products.view', label: 'View products', description: 'See the product catalogue and its details.' },
      { key: 'products.edit', label: 'Add & edit products', description: 'Create products and change their content — title, description, images, stock.' },
      {
        key: 'products.pricing',
        label: 'Change rates & pricing',
        description: 'Change list price, MRP, discounts, cost price and partner commission. Without this, a user can edit a product but not what it sells for.'
      },
      { key: 'products.approve', label: 'Approve products', description: 'Approve or reject products submitted by partners.' },
      { key: 'categories.manage', label: 'Manage categories', description: 'Create, edit and delete super, service and sub categories.' },
      { key: 'brands.manage', label: 'Manage brands', description: 'Create and edit brands.' }
    ]
  },
  {
    group: 'Sales',
    permissions: [
      { key: 'orders.view', label: 'View orders', description: 'See the order book and order details.' },
      { key: 'orders.manage', label: 'Manage orders', description: 'Change order status, trigger shipping and manage fulfilment.' },
      {
        key: 'coupons.manage',
        label: 'Manage coupons & discounts',
        description: 'Create and edit discount codes. This changes what customers pay, so grant it alongside pricing.'
      },
      { key: 'cartleads.view', label: 'View cart leads', description: 'See abandoned carts and the contact details attached to them.' }
    ]
  },
  {
    group: 'Partners',
    permissions: [
      { key: 'partners.view', label: 'View partners', description: 'See partner accounts and their applications.' },
      { key: 'partners.manage', label: 'Manage partners', description: 'Approve, reject and edit partner accounts.' }
    ]
  },
  {
    group: 'Devices',
    permissions: [
      { key: 'devices.view', label: 'View device registry', description: 'See registered collars and their QR status.' },
      { key: 'devices.manage', label: 'Register devices & issue QR', description: 'Register units and generate or reprint QR labels. This is the firmware team\'s permission.' }
    ]
  },
  {
    group: 'Customers & content',
    permissions: [
      { key: 'preorders.manage', label: 'Manage pre-orders', description: 'See and update pre-order and Woggle enquiries.' },
      { key: 'community.moderate', label: 'Moderate community', description: 'Review reports and moderate user content.' },
      { key: 'analytics.view', label: 'View analytics', description: 'See dashboard, sales and product analytics.' }
    ]
  }
];

/** Flat list of every grantable key. */
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

/**
 * A sensible starting set for a new sub-admin: read-only visibility, nothing
 * that changes what a customer pays or what ships.
 */
const DEFAULT_PERMISSIONS = ['products.view', 'orders.view', 'analytics.view'];

/** True when `key` is a real permission — used to reject typos from the API. */
const isValidPermission = (key) => ALL_PERMISSIONS.includes(key);

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  isValidPermission
};
