# Backend Overview for UI Team

Answers to the UI team’s questions, based on the current Marshee Marketplace Backend codebase and docs (`BACKEND_HLD.md`, `BACKEND_CODEBASE_REVIEW.md`).

---

## 1. Has backend development commenced, or is it scheduled to begin shortly?

**Backend development has already commenced and is in place.**  
The Marshee Marketplace Backend is a live Node.js/Express REST API with 18+ API modules, 80+ endpoints, Swagger at `/api-docs`, and integrations (Firebase, Razorpay, PhonePe, Shiprocket, Cloudinary). The codebase is structured (routes → middleware → controllers → models) and documented. UI can integrate against existing APIs.

---

## 2. What is the planned tech stack and architecture?

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js |
| **Framework** | Express 4.x |
| **Database** | MongoDB (Mongoose ODM v8.x) |
| **API style** | REST, JSON; base path **`/api/v1/`** |
| **Auth** | JWT (jsonwebtoken), bcryptjs, firebase-admin |
| **Payments** | Razorpay SDK, PhonePe (pg-sdk-node + axios) |
| **Shipping** | Shiprocket (axios in `utils/shiprocket.*`) |
| **Images** | Multer + Cloudinary |
| **Email** | Nodemailer (SMTP) |
| **Security** | Helmet, CORS, compression |
| **Validation** | express-validator |
| **Docs** | Swagger at `/api-docs` |
| **Config** | dotenv, `config/config.js` |

**Architecture:**  
Layered: **Routes** → **Middleware** (auth, validation, webhook) → **Controllers** → **Models**. Centralized async error handling, custom `ErrorResponse`, global error middleware, 404 handler. Webhook routes use raw body for Razorpay/PhonePe signature verification.

---

## 3. Authentication and role management

- **Identity**
  - **Phone:** Firebase OTP → app sends Firebase ID token → `POST /api/v1/auth/firebase-otp-verify` (Bearer &lt;idToken&gt;) → backend verifies with Firebase Admin, finds/creates user by `firebaseUID`/phone, issues JWT.
  - **Email:** `POST /api/v1/auth/register` → OTP email → `POST /api/v1/auth/verify-registration-otp` → user created, JWT returned.
  - **Login:** `POST /api/v1/auth/login` (email/password) or `POST /api/v1/auth/token` (firebaseUID, phoneNumber, timestamp) → JWT.
- **Token**
  - JWT accepted via: `Authorization: Bearer <token>`, cookie `token`, or header `x-access-token`. Expiry configurable (e.g. 30d) via `JWT_EXPIRE`.
- **Roles**
  - **user**, **partner**, **admin** (stored on User model).
  - **protect** middleware: verifies JWT, loads user with `User.findById(decoded.id)`, sets `req.user`.
  - **authorize(...roles)**: used on routes to restrict by role (e.g. `authorize('admin')`, `authorize('partner', 'admin')`). Returns 403 if role not allowed.
- **Verification**
  - Passwords hashed with bcrypt (salt rounds 10). Partner password setup flow uses purpose-specific JWT (purpose, role, email). Webhooks (Razorpay/PhonePe) use signature verification only (no JWT).

---

## 4. Marketplace structure

**PDP (Product) schema (high level)**  
- Product: `productId`, `sku`, `name`, `slug`, `description`, category (superCategory[], serviceCategory, subCategory), brand, partner, inventory, variants (embedded), petDetails (targetPet, productType, age/weight suitability, breeds, healthConditions, dietaryInfo), manufacturingDetails, media, pricing via variants, `status` (isActive, approval).  
- **Approval:** `status.approval.status`: `draft` → `pending` → `approved` | `rejected`. Admin uses `PATCH /products/:id/approval` with `{ status, notes }`.

**Order lifecycle**  
- **Order status enum:** `pending` → `confirmed` → `processing` → `shipped` → `delivered` | `cancelled` | `refunded`.  
- **Payment status:** `pending` | `completed` | `failed` | `refunded`.  
- Flow: Cart add → `POST /orders` (create order, clear cart) → `POST /payments/razorpay/create-from-cart` (or PhonePe) → app completes payment → `GET /payments/razorpay/verify` (or callback) → backend verifies signature and updates order payment status. Razorpay/PhonePe webhooks also update payment/order state (idempotent).  
- Per-item fulfillment: statuses include pending, allocated, packed, shipped, delivered, cancelled, returned, refunded. Shiprocket used for shipping (AWB, tracking).

**Payment integration**  
- **Razorpay:** Create order, verify (callback + webhook), HMAC-SHA256 webhook verification (raw body).  
- **PhonePe:** Initiate, callback, webhook (raw body).  
- Pre-order and Woggle pre-order have their own payment create/verify/webhook flows.

---

## 5. Adoption / Rescue module flow and analytics source structure

**Adoption/Rescue is not implemented in this backend.**  
The HLD and codebase review state that community/chat and similar modules are out of scope or future. There are no adoption/rescue-specific routes, models, or flows.  
**Analytics** that do exist: `/api/v1/analytics` — dashboard, products, orders, sales, categories (admin), partners (admin). Role-protected (`authorize('partner', 'admin')`). Data comes from MongoDB aggregations on Product, Order, Partner (e.g. counts by status, date filters). No adoption/rescue analytics in this codebase.

---

## 6. Lost & Found multi-platform broadcasting — planned technical approach?

**Lost & Found and multi-platform broadcasting are not implemented in this backend.**  
There are no Lost & Found models, routes, or broadcasting logic. The docs describe community/chat as separate or future. Any technical approach for Lost & Found (e.g. cross-platform posting, notifications) would need to be designed and built (either in this repo or a separate service).

---

## 7. Device and real-time communication handling

**No device-specific or real-time APIs in this backend.**  
- No WebSockets, Server-Sent Events, or long-polling.  
- Fitness/BLE tracker is mentioned in the combined app HLD as a separate **Fitness Backend**; device–pet linkage is not implemented here.  
- Client–server interaction is request/response REST only. Any real-time or device features would be additional work (separate service or new modules).

---

## 8. Notification system architecture

**Current “notifications” are email-only, no push/FCM.**  
- **Email:** Nodemailer (SMTP) via `utils/emailService.js` — OTP emails (registration, etc.), partner-related emails. Config from env (SMTP_HOST, SMTP_USER, SMTP_PASS).  
- **Push / in-app:** No FCM, APNs, or in-app notification service in this repo.  
- **Service model** has a `claimNotification` field (structure only); no broader notification pipeline.  
So: notification *architecture* today is SMTP-based email; push/in-app would require new design and implementation.

---

## 9. Admin panel scope and moderation controls

**Scope (all via existing APIs, no separate “admin app” codebase):**  
- **Auth:** Admin-only admin registration (`POST /auth/admin-9969/register` with `authorize('admin')`).  
- **Products:** List all / dashboard; **for-review** queue: `GET /products/for-review` (draft/pending); **approve/reject:** `PATCH /products/:id/approval` with `{ status: 'approved'|'rejected', notes? }`.  
- **Partners:** Pending list, approve/reject (`PATCH /partners/:id/approve`, `PATCH /partners/:id/reject`), stats, status filters.  
- **Orders:** `GET /orders/admin/all`, `PUT /orders/:id/status`, `PUT /orders/:id/payment` (admin).  
- **Categories/Brands:** CRUD on super/service/sub categories and brands (admin or partner where applicable).  
- **Coupons:** Full CRUD (admin).  
- **Analytics:** Dashboard, product/order/sales/category/partner analytics (partner sees own scope; admin sees broader).

**Moderation:**  
Product approval workflow (draft → pending → approved/rejected) and partner approval/rejection are the main moderation controls. No content-moderation (e.g. text/image filters) or report/flag flows in this backend.

---

## 10. Infrastructure, hosting, and security standards

**Infrastructure & hosting**  
- **Process:** Listens on `PORT` (default 5000; Cloud Run 8080), bind `0.0.0.0`.  
- **Database:** MongoDB; URI from `MONGODB_URI` (with fallbacks). Server starts without blocking on DB (Cloud Run–friendly).  
- **Deployment:** Docker multi-stage build (Node 20-slim), non-root user at runtime; suitable for **GCP Cloud Run** or similar.  
- **Health:** `GET /health` returns 200 + timestamp for load balancers.

**Security**  
- **Secrets:** JWT secret, Razorpay/PhonePe keys and webhook secrets, Firebase service account, Shiprocket, SMTP, Cloudinary from env (no hardcoded production secrets).  
- **HTTP:** Helmet (security headers), CORS, compression; cookie-parser for token cookie.  
- **Auth:** All protected routes require valid JWT; webhooks verify gateway signature (raw body + timing-safe compare).  
- **Validation:** express-validator on product, cart, coupon, etc.; invalid ObjectIds and required fields rejected.

---

## Quick reference for UI

| Need | Backend |
|------|--------|
| Auth (phone/email/login) | `/api/v1/auth/*` |
| Catalog (products, categories, brands) | `/api/v1/products`, `/categories`, `/brands` |
| Cart, wishlist, coupons | `/api/v1/cart`, `/wishlist`, `/coupons` |
| Checkout, orders, tracking | `/api/v1/orders`, `/payments/*` |
| User profile, addresses, pets | `/api/v1/auth/me`, `/addresses`, `/pets` |
| Partner product dashboard & approval | `/products/dashboard`, `/products/for-review`, `PATCH /products/:id/approval` |
| Admin: partners, orders, analytics | `/partners/*`, `/orders/admin/*`, `/analytics/*` |
| API docs | `GET /api-docs` (Swagger) |

**Not in this backend:** Adoption/Rescue flows, Lost & Found, real-time/WebSockets, push notifications (FCM/APNs), fitness/BLE device APIs. Those would be new scope.
