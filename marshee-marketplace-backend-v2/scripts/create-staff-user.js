/**
 * Create (or update) a staff account directly, with a password and a permission set.
 *
 * The normal path is an admin inviting someone from Users & Access, which emails a
 * password-setup link. That needs SMTP configured. This script exists for the case where
 * it is not — notably standing up the firmware team's first login — by setting the
 * password directly instead of mailing a link.
 *
 * Safe to re-run: an existing account is updated in place rather than duplicated.
 *
 * Usage:
 *   # see what it would do
 *   node scripts/create-staff-user.js --email firmware@marshee.com --preset firmware
 *
 *   # actually create it
 *   node scripts/create-staff-user.js --email firmware@marshee.com --preset firmware \
 *     --name "Firmware Team" --password 'S0me-Strong-Pass' --apply
 *
 *   # or pick permissions explicitly
 *   node scripts/create-staff-user.js --email ops@marshee.com \
 *     --permissions devices.view,orders.view --password '...' --apply
 *
 * Presets:
 *   firmware  devices.view, devices.manage   — register units and issue QR labels
 *   readonly  the read-only starter set
 *   all       every permission (equivalent to an unrestricted sub-admin)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user.model');
const {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  isValidPermission
} = require('../config/permissions');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const APPLY = process.argv.includes('--apply');
const email = (arg('--email') || '').toLowerCase().trim();
const name = arg('--name');
const password = arg('--password');
const preset = arg('--preset');
const permsArg = arg('--permissions');

const PRESETS = {
  firmware: ['devices.view', 'devices.manage'],
  readonly: DEFAULT_PERMISSIONS,
  all: ALL_PERMISSIONS
};

(async () => {
  if (!email) {
    console.error('Usage: node scripts/create-staff-user.js --email <address> [--preset firmware|readonly|all] [--permissions a,b] [--name "Name"] [--password <pass>] [--apply]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  // Work out the permission set
  let permissions;
  if (permsArg) {
    permissions = permsArg.split(',').map((p) => p.trim()).filter(Boolean);
    const bad = permissions.filter((p) => !isValidPermission(p));
    if (bad.length) {
      console.error(`Unknown permission(s): ${bad.join(', ')}`);
      console.error(`Valid keys:\n  ${ALL_PERMISSIONS.join('\n  ')}`);
      process.exit(1);
    }
  } else if (preset) {
    if (!PRESETS[preset]) {
      console.error(`Unknown preset "${preset}". Choose one of: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    permissions = PRESETS[preset];
  } else {
    permissions = DEFAULT_PERMISSIONS;
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  const existing = await User.findOne({ email }).select('+password');

  console.log(existing ? `Updating existing account ${email}:` : `Creating sub-admin ${email}:`);
  console.log(`  role        : subadmin`);
  console.log(`  permissions : ${permissions.join(', ') || '(none)'}`);
  console.log(`  password    : ${password ? (existing ? 'will be reset' : 'will be set') : (existing ? 'left unchanged' : 'NOT SET — cannot sign in')}`);

  if (!existing && !password) {
    console.error('\nRefusing to create an account with no password — it could never sign in.');
    console.error('Pass --password, or invite the user from Users & Access once SMTP is configured.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (existing && existing.role === 'admin') {
    console.error('\nThis account is a full admin. Admins hold every permission implicitly and');
    console.error('cannot be narrowed here. Use scripts/set-main-admin.js instead.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (APPLY) {
    if (existing) {
      existing.role = 'subadmin';
      existing.isActive = true;
      existing.permissions = permissions;
      if (name) existing.name = name;
      if (password) existing.password = password;
      await existing.save();
      console.log('\nUpdated.');
    } else {
      const user = await User.create({
        name: name || email.split('@')[0],
        email,
        role: 'subadmin',
        permissions,
        password
      });
      console.log(`\nCreated ${user.email} (${user._id}).`);
    }
  } else {
    console.log('\nDry run — re-run with --apply to write.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
