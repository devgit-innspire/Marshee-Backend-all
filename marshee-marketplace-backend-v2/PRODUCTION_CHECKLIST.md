# Production checklist — staff permissions & console users

Covers what must be true before the Users & Access feature and the firmware portal
work in production. Written 2026-09-12.

## Deploying

The live service is **`marketplace-v2` in europe-west1**, which replaces the older
`marshee-marketplace-backend-v2` in asia-southeast1.

```bash
gcloud builds submit --config=cloudbuild.yaml
```

That builds the image, pushes it, and deploys the Cloud Run revision in one step. Runtime
configuration is deliberately not in `cloudbuild.yaml` — it lives on the Cloud Run service so
secrets never enter the repo, and existing variables carry over to each new revision.

Verify afterwards:

```bash
curl -o /dev/null -w '%{http_code}\n' https://<service-url>/api/v1/staff/permissions
# 401 = new code live.  404 = still the old build.
```

## 0. Easiest path: let the server bootstrap itself

If you would rather not hand the database password to anyone, the backend can do steps 1 and 2
itself on startup — it already holds the credentials. Set these on Cloud Run and redeploy:

| Variable | Value |
| --- | --- |
| `BOOTSTRAP_ADMIN_EMAIL` | `pankaj@marshee.com` |
| `BOOTSTRAP_ADMIN_PASSWORD` | a strong password |
| `BOOTSTRAP_ADMIN_NAME` | `Pankaj` |
| `BOOTSTRAP_BACKFILL_PERMISSIONS` | `true` |

On boot it creates or promotes that full admin and grants the full permission set to any
sub-admin that has none. Both steps are idempotent, and a redeploy will **not** overwrite a
password the owner has since changed (pass `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` to force it).

Remove the variables once the environment is up — they keep a password in the deploy config.

The scripts below do the same thing from a laptop, if you have the database URI.

## 1. Run the permissions migration FIRST

Per-account permissions default to an empty list, so **every existing sub-admin loses all
access the moment the new backend deploys** until this is run.

```bash
node scripts/backfill-staff-permissions.js          # dry run, writes nothing
node scripts/backfill-staff-permissions.js --apply  # grant existing sub-admins everything
```

It grants the full set, reproducing today's behaviour, and skips anyone already configured
so re-running never widens an account that was deliberately narrowed. Admins are unaffected —
they hold every permission implicitly.

## 2. Seed the main admin

A full admin is the only account that can invite others, and `POST /auth/admin-9969/register`
itself requires an existing admin — so day one needs this:

```bash
node scripts/set-main-admin.js --email pankaj@marshee.com --apply \
  --name "Pankaj" --password '<strong password>'
```

Safe to re-run. On an existing account it promotes to `admin`, reactivates, and clears any
stale sub-admin permission list; the password is only touched if `--password` is passed.

## 2b. Give the firmware team a login

The firmware portal signs in with a staff account. Normally an admin invites one from
Users & Access, but that emails a setup link and so needs SMTP. Until SMTP is configured,
provision the account directly:

```bash
node scripts/create-staff-user.js --email firmware@marshee.com --preset firmware \
  --name "Firmware Team" --password '<strong password>' --apply
```

`--preset firmware` grants exactly `devices.view` and `devices.manage` — enough to register
units and issue QR labels, and nothing else. Verified: that account gets 200 on the device
routes and 403 on coupons, orders and staff.

Re-runnable; an existing account is updated rather than duplicated.

## 3. Required environment variables

| Variable | Why it is required | Consequence if unset |
| --- | --- | --- |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Sends the invite / password-setup email | **Invites cannot be delivered.** The account is created but the person never receives a link, and the link is not shown to the admin either. |
| `ADMIN_CONSOLE_URL` | Base of the invite link | Falls back to `http://www.marshee.com` — the **storefront**, not the console — so the link 404s. Set it to the admin dashboard origin. |
| `CORS_ORIGIN` | Comma-separated allowed origins | The firmware portal and any non-default console origin cannot sign in. Include both the dashboard and the firmware portal URLs. |
| `MONGODB_URI` | Database | — |
| `JWT_SECRET` | Server refuses to start without it | — |
| `DEVICE_ACTIVATION_BASE_URL` | Base of the QR activation URL | Defaults to `https://marshee.com/activate`. Set before printing production labels — changing it later invalidates every label already printed. |

## 4. Verify after deploy

```bash
# main admin can sign in and reach the staff API
curl -X POST $API/auth/login -d '{"email":"pankaj@marshee.com","password":"..."}'
curl $API/staff -H "Authorization: Bearer <token>"          # expect 200
curl $API/staff/permissions -H "Authorization: Bearer <token>"  # expect the catalogue

# an invited sub-admin's link actually resolves
# -> $ADMIN_CONSOLE_URL/setup-password?token=... must load the password form
```

## 5. Known issues not yet fixed

- **`models/variant.model.js:80`** — `this.constructor.findOne()` in a `pre('save')` hook.
  `variantSchema` is embedded in products, so `this.constructor` is a subdocument class with
  no `.findOne()`. **Any product save where a variant has no SKU returns a 500**, surfaced
  only as "Error updating product". Pre-existing; affects product create and update.
