/**
 * Role helpers.
 *
 * The console has two staff roles:
 *   - `admin`    full access, including payment-out actions, user records
 *                and creating other staff accounts.
 *   - `subadmin` day-to-day operations staff (including the firmware team).
 *                Same operational reach as an admin — products, orders,
 *                categories, partners, devices — but never payment-out,
 *                user records or staff management.
 *
 * Use `isStaff` wherever the old code asked "is this an admin?" purely to decide
 * whether the caller sees the whole catalogue/order book rather than just their
 * own records. Use `isFullAdmin` for the protected actions.
 */

const STAFF_ROLES = ['admin', 'subadmin'];

/** True for admins and sub-admins — i.e. anyone with console-wide visibility. */
const isStaff = (user) => !!user && STAFF_ROLES.includes(user.role);

/** True only for full admins. Gate payment-out and staff management with this. */
const isFullAdmin = (user) => !!user && user.role === 'admin';

/**
 * True when `user` may perform `permission`.
 *
 * Full admins bypass the list entirely — they are the ones handing permissions
 * out, so gating them on their own grants would let an admin lock themselves
 * out of the console. Everyone else must hold the exact key.
 */
const hasPermission = (user, permission) => {
  if (!user) return false;
  if (isFullAdmin(user)) return true;
  // Permissions are a staff concept. A partner or customer never holds one,
  // even if a stray key ended up on their document.
  if (!isStaff(user)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
};

/** True when the user holds at least one of the given permissions. */
const hasAnyPermission = (user, ...permissions) =>
  permissions.some((p) => hasPermission(user, p));

module.exports = { STAFF_ROLES, isStaff, isFullAdmin, hasPermission, hasAnyPermission };
