/**
 * One-off migration: give every existing sub-admin the full permission set.
 *
 * Before per-account permissions existed, a sub-admin could do everything an
 * admin could except payment-out, user records and staff management. The new
 * `permissions` field defaults to an empty array, so without this backfill
 * every existing sub-admin would lose all access the moment this deploys.
 *
 * Granting everything preserves exactly today's behaviour; an admin can then
 * narrow each account from Settings → Users.
 *
 * Usage:
 *   node scripts/backfill-staff-permissions.js          # report only
 *   node scripts/backfill-staff-permissions.js --apply  # write
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user.model');
const { ALL_PERMISSIONS } = require('../config/permissions');

const APPLY = process.argv.includes('--apply');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // Only sub-admins that have not been given an explicit set yet. Anyone an
  // admin has already configured is left exactly as they are, so re-running
  // this never widens someone who was deliberately narrowed.
  const filter = {
    role: 'subadmin',
    $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }]
  };

  const targets = await User.find(filter).select('name email permissions').lean();

  if (!targets.length) {
    console.log('Nothing to backfill — every sub-admin already has permissions set.');
  } else {
    console.log(`${targets.length} sub-admin(s) would receive the full permission set:`);
    targets.forEach((u) => console.log(`  - ${u.name || '(no name)'} <${u.email}>`));

    if (APPLY) {
      const result = await User.updateMany(filter, { $set: { permissions: ALL_PERMISSIONS } });
      console.log(`\nUpdated ${result.modifiedCount} account(s).`);
    } else {
      console.log('\nDry run — re-run with --apply to write these changes.');
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
