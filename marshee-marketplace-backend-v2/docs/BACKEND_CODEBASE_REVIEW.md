# Marshee Marketplace Backend – Codebase Review

**Generated:** February 2025  
**Scope:** Full backend review for technologies, APIs, security, performance, database design, and resume-ready impact bullets.

---

## 1. Backend Technologies, Frameworks & Patterns

| Layer | Technology | Notes |
|-------|------------|--------|
| **Runtime** | Node.js | — |
| **Framework** | Express 4.x | REST API, middleware pipeline |
| **Database** | MongoDB | Mongoose ODM (v8.x) |
| **Auth** | JWT (jsonwebtoken), bcryptjs, firebase-admin | Bearer/cookie/x-access-token; Firebase for phone OTP |
| **Payments** | Razorpay SDK, PhonePe (pg-sdk-node + axios) | Create order, verify, webhooks |
| **Shipping** | Shiprocket | HTTP client (axios) in `utils/shiprocket.*` |
| **Images** | Multer + Cloudinary | Product/service image uploads |
| **Email** | Nodemailer | OTP, partner emails via SMTP |
| **Security** | Helmet, CORS, compression | Response compression, security headers |
| **Validation** | express-validator | Product, cart, coupon validation |
| **Docs** | Swagger (swagger-jsdoc, swagger-ui-express) | `/api-docs` |
| **Config** | dotenv, config.js | Env-based secrets and config |

**Architectural patterns:**
- **Layered:** Routes → Middleware (auth, validation, webhook) → Controllers → Models
- **Async:** Centralized `asyncHandler` for controller errors
- **Error handling:** Custom `ErrorResponse`, global error middleware, 404 handler
- **Webhook-safe body:** Raw body preserved for Razorpay/PhonePe webhooks; conditional JSON parsing
- **Cloud-ready:** Server starts without blocking on DB (Cloud Run); health check at `/health`; Docker multi-stage build, non-root user

---

## 2. APIs and Core Modules

All APIs are under base path **`/api/v1/`**.

| Module | Prefix | Purpose | Auth |
|--------|--------|---------|------|
| **Auth** | `/auth` | Register (email OTP), verify OTP, login, Firebase OTP verify, token exchange, profile, delete account, partner password setup | Mixed (public + protect + authorize) |
| **Products** | `/products` | CRUD, list, search (advanced/quick), by category, dashboard (partner/admin), for-review (admin), approval (admin) | Mixed |
| **Categories** | `/categories` | Super / service / sub category CRUD and hierarchy | Mixed |
| **Brands** | `/brands` | CRUD, list, my brands (partner/admin) | Mixed |
| **Partners** | `/partners` | Create, list, apply, approve/reject, stats, pickup locations | Mixed |
| **Coupons** | `/coupons` | Create, list, validate (cart apply), paginated list | Mixed |
| **Cart** | `/cart` | Get, add, update, remove, clear; apply/remove coupon; add/update/remove service | protect |
| **Wishlist** | `/wishlist` | Get, add, remove | protect |
| **Orders** | `/orders` | Create, list, get by id, tracking, cancel; admin: all, status, payment status | protect (+ authorize admin) |
| **Pets** | `/pets` | CRUD pets (limit 5 per user) | protect |
| **Payments** | `/payments` | Razorpay/PhonePe create-from-cart, verify, webhooks; pre-order payments; status/check | protect for create; no auth for webhooks/callback |
| **Services** | `/services` | CRUD, search, nearby (geo), by type/category, paginated | Mixed |
| **Addresses** | `/addresses` | CRUD, list, billing, shipping, default shipping/billing, soft delete | protect |
| **Survey** | `/survey` | Submit, list, analytics, by email | Public / mixed |
| **Pre-order** | `/preOrder` | Pre-order form CRUD, stats, paginated | Mixed |
| **Woggle** | `/woggle` | Woggle pre-order CRUD, payment create/verify/webhook | Mixed |
| **Shiprocket** | `/shiprocket` | Login, serviceability, create/cancel order, AWB, pickup, track | Often env/backend token |
| **Analytics** | `/analytics` | Dashboard, products, orders, sales, categories (admin), partners (admin) | protect, authorize(partner, admin) |

**Other endpoints:**
- `GET /health` — Health check (no auth)
- `GET /api-docs` — Swagger UI

**No dedicated chat or courses APIs** in this repo; community/chat and fitness are noted as separate or future.

---

## 3. Security Practices

| Practice | Implementation |
|----------|----------------|
| **JWT** | Issued after Firebase OTP verify or email OTP/login; configurable expiry (e.g. 30d). Accepted via `Authorization: Bearer`, cookie `token`, or `x-access-token`. |
| **OAuth / Firebase** | Firebase Admin verifies phone OTP ID token; backend finds/creates user by `firebaseUID`/phone, then issues JWT. No social OAuth in this codebase. |
| **Password hashing** | bcrypt (bcryptjs), salt rounds 10; hashing in User model `pre('save')`. Passwords not returned (`select: false`). |
| **RBAC** | Roles: `user`, `partner`, `admin`. `protect` loads user; `authorize(...roles)` restricts by role (e.g. admin-only, partner/admin). |
| **Validation** | express-validator for product (name, SKU, category, pricing, inventory, etc.), cart add/update/remove/apply-coupon. Rejects invalid ObjectIds and required fields. |
| **Webhook security** | Razorpay: raw body preserved, HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`, timing-safe comparison. PhonePe: webhook routes use raw body; verification noted in code. |
| **Secrets** | JWT secret, Razorpay/PhonePe keys and webhook secrets, Firebase service account, Shiprocket, SMTP, Cloudinary from env (no hardcoded production secrets in code). |
| **HTTP security** | Helmet for headers; CORS enabled; cookie-parser for token cookie. |
| **Deployment** | Docker runs as non-root user; multi-stage build reduces image surface. |

---

## 4. Performance & Scalability Techniques

| Technique | Where / How |
|-----------|-------------|
| **Pagination** | Products (list, search, by category, dashboard, for-review), orders (user + admin), services, coupons, pre-order, Woggle pre-order. `page`, `limit` (or `per_page`); skip/limit or slice. |
| **Indexing** | See Section 5; indexes on User, Product, Order, Cart, Address, Category, Brand, Partner, Coupon, Wishlist, OTP (TTL), Service (text + 2dsphere), WogglePreOrder, PreOrderForm. |
| **Compression** | `compression()` middleware for responses. |
| **DB connection** | Single Mongoose connection; `connectDB` tries primary/secondary/fallback URIs; server does not block startup on DB (Cloud Run–friendly). |
| **Async / non-blocking** | Controllers wrapped in asyncHandler; webhook handlers verify then persist without blocking. |
| **Idempotent webhooks** | Razorpay/PhonePe webhooks check existing payment/order status before updating to avoid duplicate state changes. |
| **No in-repo caching/queues** | No Redis, in-memory cache, or Bull/queue in dependencies or code; scaling is via stateless app + MongoDB. |
| **Cloud** | Designed for Cloud Run (PORT, 0.0.0.0); health check for load balancer; Dockerfile for GCP. |

---

## 5. Database Design & Relationships

**Database:** MongoDB (Mongoose).

**Main entities and relationships:**

- **User**  
  - Optional refs: Address, Pet, connections/connectionRequests.  
  - Partial unique index on `email` (only when present).  
  - Unique sparse `firebaseUID`.  
  - Roles: user, partner, admin.

- **Address**  
  - `user` → User.  
  - Indexes: (user, createdAt), (user, isDefaultShipping), (user, isDefaultBilling) with partial filters.  
  - Soft delete: `isDeleted`, `deletedAt`.

- **Pet**  
  - Linked to User (via user ref or user.pets).  
  - Limit enforced in controller (e.g. 5 per user).

- **Product**  
  - Refs: category (superCategory[], serviceCategory, subCategory), brand, partner.  
  - Embedded: variants (Variant subdocuments).  
  - Indexes: slug, inventory.sku, category fields, brand, status, petDetails.targetPet, text search, compound (e.g. approval + active).

- **Variant**  
  - Embedded in Product; variantId index.

- **Category hierarchy**  
  - SuperCategory → ServiceCategory (superCategory[]) → SubCategory (serviceCategory).  
  - Indexes on slug and parent refs.

- **Brand**  
  - Optional `partner` ref.  
  - Indexes: slug, partner.

- **Partner**  
  - `user` → User (unique sparse).  
  - Indexes: legal.cinNumber (unique sparse), user.

- **Cart**  
  - `user` → User (unique index).  
  - Items: product, variant or service refs; quantity, price, totals.  
  - Coupon ref; calculated totals.

- **Order**  
  - `user` → User.  
  - `items[]`: product/variant or service refs, snapshots (sku, name, price, etc.), fulfillment, cancellation, return, refund.  
  - `shippingAddress`, `billingAddress` → Address; plus snapshots.  
  - `payment`: status, transactionId, merchantOrderId, gateway, callback verification.  
  - `appliedCoupon` → Coupon.  
  - Indexes: user, status, payment status/ids, createdAt, items.product, tracking, partnerPayments.partner, (user, createdAt).

- **Wishlist**  
  - user → User; products[] → Product.  
  - Indexes: user, isPublic.

- **Coupon**  
  - Indexes: validFrom/validUntil, isActive/isPublic.

- **Service**  
  - Text index (name, descriptions); 2dsphere on location for “nearby”.

- **Otp**  
  - email, purpose; TTL index on expiresAt for auto-delete.

- **PreOrderForm / PreOrderPayment**  
  - PreOrder contact + payment; indexes on payment IDs and dates.

- **WogglePreOrder**  
  - Payment and status indexes; merchantOrderId/transactionId for lookups.

**Design choices:**
- Order/cart support both **product** and **service** line items (itemType, refs, snapshots).  
- Order stores **address snapshots** and item snapshots for immutability.  
- **Partial and sparse indexes** used for optional/conditional uniqueness (email, firebaseUID, defaults).  
- **TTL** on OTP for automatic expiry.

---

## 6. Resume Bullet Points (Backend Contributions, Measurable Impact)

Use these as a starting point; adjust numbers and context to match your actual role and metrics.

1. **Architected and developed a Node.js/Express REST API** for a pet marketplace (auth, catalog, cart, orders, payments, shipping, services), serving mobile clients via 18+ API modules and 80+ endpoints with Swagger documentation and role-based access (user, partner, admin).

2. **Implemented secure auth and payments:** Firebase phone OTP verification with JWT issuance, email OTP registration, bcrypt password hashing, and RBAC; integrated Razorpay and PhonePe with HMAC webhook verification (raw-body + timing-safe compare) and idempotent order status updates to reduce duplicate or erroneous payment state changes.

3. **Designed MongoDB schema and indexing** for users, products, orders, cart, addresses, categories, and partners (30+ indexes including compound and text/geo), with partial/sparse indexes for optional fields and TTL for OTP; supported pagination across list/search endpoints to keep response sizes and query cost bounded.

4. **Integrated third-party services** (Razorpay, PhonePe, Shiprocket, Cloudinary, Firebase Admin, SMTP) for payments, shipping, product images, and auth; implemented webhook middleware to preserve raw body for signature verification and conditional JSON parsing for non-webhook routes.

5. **Improved reliability and deployability:** Centralized error handling and async wrappers, health check endpoint, DB connection fallbacks with non-blocking startup for Cloud Run, and Docker multi-stage build with non-root user; applied Helmet, CORS, and response compression for security and performance.

6. **Delivered cart and order flows** supporting products and services (variants, extras, coupons), with address snapshots and item snapshots at checkout; order creation from cart, payment creation/verify and webhook handling, and post-payment Shiprocket order creation for fulfillment.

7. **Built analytics and partner tooling:** Role-scoped analytics (dashboard, products, orders, sales, categories, partners) and product approval workflow (draft → for-review → approved/rejected), enabling partners and admins to manage catalog and view performance metrics.

---

**References:**  
- High-level design: `docs/BACKEND_HLD.md`  
- API docs: Swagger at `/api-docs`  
- Config: `config/`, `.env` (not committed)
