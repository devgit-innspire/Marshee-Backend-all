/**
 * Promote (or create) the console's main admin.
 *
 * A full admin is the only account that can invite other users, so a fresh
 * environment needs one seeded out-of-band: `POST /auth/admin-9969/register`
 * itself requires an existing admin, which is a chicken-and-egg on day one.
 *
 * Safe to re-run. If the account already exists it is promoted to `admin`,
 * reactivated, and its password is left alone unless --password is passed.
 *
 * Usage:
 *   node scripts/set-main-admin.js --email pankaj@marshee.com
 *   node scripts/set-main-admin.js --email pankaj@marshee.com --apply
 *   node scripts/set-main-admin.js --email pankaj@marshee.com --apply --name "Pankaj" --password 'S0me-Strong-Pass'
 *
 * Without --apply it reports what it would do and writes nothing.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user.model');

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const APPLY = process.argv.includes('--apply');
const email = (arg('--email') || '').toLowerCase().trim();
const name = arg('--name');
const password = arg('--password');

(async () => {
  if (!email) {
    console.error('Usage: node scripts/set-main-admin.js --email <address> [--apply] [--name "Full Name"] [--password <pass>]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  const existing = await User.findOne({ email }).select('+password');

  if (!existing) {
    console.log(`No account for ${email}. Would CREATE a full admin.`);
    if (!password) {
      // An admin with no password cannot sign in, and unlike a sub-admin there
      // is no invite email for this path — so refuse rather than create a
      // login-less account that looks fine in the database.
      console.error('\nRefusing to create an admin without a password. Pass --password.');
      await mongoose.disconnect();
      process.exit(1);
    }
    if (APPLY) {
      const user = await User.create({ name: name || email.split('@')[0], email, role: 'admin', password });
      console.log(`\nCreated admin ${user.email} (${user._id}).`);
    } else {
      console.log('\nDry run — re-run with --apply to create it.');
    }
  } else {
    console.log(`Found ${email}:`);
    console.log(`  role     : ${existing.role}${existing.role === 'admin' ? ' (already an admin)' : ' -> admin'}`);
    console.log(`  isActive : ${existing.isActive}${existing.isActive ? '' : ' -> true'}`);
    console.log(`  password : ${existing.password ? 'set' : 'NOT SET'}${password ? ' -> will be reset' : ''}`);

    if (APPLY) {
      existing.role = 'admin';
      existing.isActive = true;
      // Admins hold every permission implicitly; clear any stale sub-admin list
      // so the stored data does not imply a restriction that is never enforced.
      existing.permissions = [];
      if (name) existing.name = name;
      if (password) existing.password = password;
      await existing.save();
      console.log('\nUpdated.');
    } else {
      console.log('\nDry run — re-run with --apply to write these changes.');
    }
  }

  const admins = await User.find({ role: 'admin' }).select('name email isActive').lean();
  console.log(`\nFull admins now on record (${admins.length}):`);
  admins.forEach((a) => console.log(`  - ${a.name || '(no name)'} <${a.email}>${a.isActive ? '' : ' [inactive]'}`));

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
