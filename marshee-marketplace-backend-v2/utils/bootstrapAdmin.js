/**
 * One-shot bootstrap run at server start.
 *
 * Standing up a new environment has a chicken-and-egg problem: only a full admin can create
 * another admin, and the permission backfill has to run before the first sub-admin signs in.
 * Both normally need a database connection from an operator's machine, which is awkward when
 * the credentials live only in the deployment environment.
 *
 * The server already holds those credentials, so it can do both itself when asked — driven
 * entirely by environment variables that an operator can set in Cloud Run.
 *
 * Everything here is idempotent and safe to leave enabled, but the variables are best removed
 * once the environment is up: they keep a password in the deployment config.
 */

const User = require('../models/user.model');
const { ALL_PERMISSIONS } = require('../config/permissions');

/**
 * Ensure the account named by BOOTSTRAP_ADMIN_EMAIL exists and is a full admin.
 * BOOTSTRAP_ADMIN_PASSWORD is applied only when creating the account, or when
 * BOOTSTRAP_ADMIN_RESET_PASSWORD is explicitly "true" — so a redeploy does not
 * silently reset a password the owner has since changed.
 */
async function ensureAdmin() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME;
  const resetPassword = process.env.BOOTSTRAP_ADMIN_RESET_PASSWORD === 'true';

  if (!email) return;

  const existing = await User.findOne({ email }).select('+password');

  if (!existing) {
    if (!password) {
      console.warn(`[bootstrap] BOOTSTRAP_ADMIN_EMAIL=${email} has no account and no BOOTSTRAP_ADMIN_PASSWORD — skipping (an admin with no password could never sign in).`);
      return;
    }
    const user = await User.create({
      name: name || email.split('@')[0],
      email,
      role: 'admin',
      password
    });
    console.log(`[bootstrap] Created full admin ${user.email}.`);
    return;
  }

  const changes = [];
  if (existing.role !== 'admin') {
    existing.role = 'admin';
    // Admins hold everything implicitly; a leftover sub-admin list would imply
    // a restriction that is never actually enforced.
    existing.permissions = [];
    changes.push('promoted to admin');
  }
  if (existing.isActive === false) {
    existing.isActive = true;
    changes.push('reactivated');
  }
  if (name && existing.name !== name) {
    existing.name = name;
    changes.push('name updated');
  }
  if (password && resetPassword) {
    existing.password = password;
    changes.push('password reset');
  }

  if (changes.length) {
    await existing.save();
    console.log(`[bootstrap] ${existing.email}: ${changes.join(', ')}.`);
  } else {
    console.log(`[bootstrap] ${existing.email} is already a full admin — nothing to do.`);
  }
}

/**
 * Grant the full permission set to sub-admins that have none.
 *
 * Accounts predating per-account permissions have an empty list, which now means "no access
 * at all" — so without this they are locked out on first deploy. Anyone an admin has already
 * configured is left alone, so this never widens a deliberately narrowed account.
 */
async function backfillPermissions() {
  if (process.env.BOOTSTRAP_BACKFILL_PERMISSIONS !== 'true') return;

  const filter = {
    role: 'subadmin',
    $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }]
  };

  const count = await User.countDocuments(filter);
  if (count === 0) {
    console.log('[bootstrap] Permission backfill: nothing to do.');
    return;
  }

  const result = await User.updateMany(filter, { $set: { permissions: ALL_PERMISSIONS } });
  console.log(`[bootstrap] Permission backfill: granted the full set to ${result.modifiedCount} sub-admin(s).`);
}

/**
 * Run the bootstrap steps. Never throws — a failure here must not stop the server
 * from serving traffic, so problems are logged and swallowed.
 */
async function runBootstrap() {
  try {
    await ensureAdmin();
    await backfillPermissions();
  } catch (err) {
    console.error('[bootstrap] Failed:', err.message);
  }
}

module.exports = { runBootstrap, ensureAdmin, backfillPermissions };
