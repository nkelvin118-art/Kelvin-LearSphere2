# Kelvins LearnSphere

A JavaScript/HTML/CSS starter for an educational e-book platform. It includes a responsive gold-and-charcoal interface, a Node.js/Express backend, SQLite data storage, account registration/login, a three-free-book welcome entitlement, order creation, Daraja STK Push initiation, callback verification attempt, manual payment submissions, admin payment review endpoints, and entitlement-protected downloads.

## Important status and limitations

This is a **starter project, not a certified production payment system**. It is designed to be runnable locally and extended safely. Before accepting real money, arrange a security review and finish the production requirements below.

- Email verification and password reset are not implemented in this starter.
- Sessions are in memory and are lost when the server restarts. Use a persistent, secure session store before production.
- The initial admin is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` only when both are explicitly set to non-placeholder values. Never commit `.env`.
- Admin book metadata endpoints are included, but secure file upload is deliberately disabled until vetted multipart handling, file-type inspection, malware scanning, and private object storage are configured.
- The manual payment endpoint records a claim. An admin must verify the transaction against a trusted M-Pesa record/statement before approving it.
- The Daraja callback queries STK status before considering payment, but production callback validation and transaction reconciliation must be reviewed against the current Daraja API behavior and your account configuration. Do not assume callback payloads alone prove payment.
- This starter does not implement donations, community posting, email delivery, school groups, teacher moderation, or a full admin UI yet.
- Downloaded books cannot be made impossible to copy. Upload only content you own or are authorized to distribute.
- SQLite is suitable for local development and a small demo. For production hosting with multiple instances, use PostgreSQL and durable private object storage.

## Requirements

- Node.js 20 or later
- npm

## Run locally

1. Download/extract the project.
2. Copy `.env.example` to `.env`.
3. Set a strong `SESSION_SECRET`. Set a unique `ADMIN_EMAIL` and `ADMIN_PASSWORD` if you want an administrator account.
4. Install packages:

   ```bash
   npm install
   ```

5. Start the server:

   ```bash
   npm start
   ```

6. Open `http://localhost:3000`.

The SQLite database is created automatically on first run. Sample book listings are metadata examples only; no sample copyrighted files are included.

## Upload to GitHub

1. Create a new **private** GitHub repository while you are developing.
2. Upload the project files, including `.gitignore`.
3. Do **not** upload `.env`, database files, production credentials, or private book files.
4. For larger projects, use Git from your computer:

   ```bash
   git init
   git add .
   git commit -m "Initial Kelvins LearnSphere starter"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPOSITORY_URL
   git push -u origin main
   ```

## Configure M-Pesa

1. Register/sign in at https://developer.safaricom.co.ke/ and create a Daraja app.
2. Test with sandbox credentials first.
3. Configure an authorized shortcode, passkey, transaction type, and a publicly reachable HTTPS callback URL.
4. Set the values in the server environment, never in browser JavaScript.
5. Confirm the selected transaction type matches your approved business account.
6. Test successful, failed, delayed, duplicate, and mismatched-amount scenarios before production.
7. Use official provider transaction records for reconciliation. A phone number alone does not enable STK Push.

`MPESA_CALLBACK_URL` must point to `https://YOUR_DOMAIN/api/payments/mpesa/callback` after deployment. Localhost callbacks are not publicly reachable by Safaricom.

## Manual verification

Users submit a transaction reference to `/api/payments/manual`. An administrator can view pending claims using `GET /api/admin/payments` and decide through `POST /api/admin/payments/:paymentId/verify` with JSON such as:

```json
{
  "decision": "approve",
  "note": "Matched transaction in the authorized M-Pesa statement; amount and order verified."
}
```

Only approve after checking the trusted payment record, correct amount, transaction reference, and that the reference has not already been used. The app cannot independently validate a user-supplied reference without a trusted provider feed.

## Useful API routes

- `GET /api/health`
- `GET /api/books?q=biology`
- `POST /api/register`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/me`
- `GET /api/library`
- `POST /api/orders`
- `POST /api/payments/mpesa/stk`
- `POST /api/payments/manual`
- `GET /api/orders/:id`
- `GET /api/download/:bookId`
- `GET /api/admin/payments` (admin)
- `POST /api/admin/payments/:paymentId/verify` (admin)
- `GET /api/admin/books` (admin)
- `POST /api/admin/books` (admin)
- `GET /api/admin/audit` (admin)

## Production checklist

- Move from in-memory sessions to a persistent session store with secure cookie configuration and CSRF protections.
- Add email verification and password reset.
- Use PostgreSQL, automated backups, and private S3-compatible object storage.
- Add secure uploads with size/type checks and malware scanning.
- Add MFA for administrators and a proper admin dashboard.
- Add monitoring, error reporting, dependency scanning, log retention, and a security incident plan.
- Add rate limiting backed by a shared store for multi-instance deployments.
- Complete privacy, terms, copyright, refund, and data deletion policies.
- Conduct an independent security review and payment integration testing.
- Configure DNS, HTTPS, environment secrets, and deployment health checks.
- Implement the remaining community, donation, teacher submission, and email features before advertising them as available.

## Tests

Run:

```bash
npm test
```

This starter uses Node's built-in test runner. Additional integration tests should be added before deployment.
