require("dotenv").config();
const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOOKS_DIR = path.resolve(process.env.PRIVATE_BOOKS_DIR || "./private-books");
fs.mkdirSync(BOOKS_DIR, { recursive: true });

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters in production.");
}
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

// This starter uses an in-memory session map for a small local demo. For production,
// replace with a persistent server-side session store and secure session cookies.
const sessions = new Map();
const SESSION_COOKIE = "kl_session";
function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { id: user.id, name: user.name, email: user.email, role: user.role, expires: Date.now() + 8 * 60 * 60 * 1000 });
  return token;
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const item = raw.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function auth(req, res, next) {
  const token = readCookie(req, SESSION_COOKIE);
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Please sign in first." });
  }
  req.user = session;
  next();
}
function admin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}
function audit(actor, action, details = "") {
  db.prepare("INSERT INTO audit_logs(actor_user_id, action, details) VALUES (?, ?, ?)").run(actor || null, action, String(details).slice(0, 500));
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

function safeBook(row) {
  return {
    id: row.id, title: row.title, author: row.author, description: row.description,
    category: row.category, level: row.level, priceKes: row.price_kes, isFree: !!row.is_free
  };
}
function grantEntitlement(userId, bookId, source, orderId = null) {
  db.prepare(`INSERT OR IGNORE INTO entitlements(user_id, book_id, source, order_id) VALUES (?, ?, ?, ?)`)
    .run(userId, bookId, source, orderId);
}
function hasEntitlement(userId, bookId) {
  return !!db.prepare("SELECT 1 FROM entitlements WHERE user_id=? AND book_id=?").get(userId, bookId);
}

// Bootstrap an administrator only when configured credentials are supplied.
// Do not commit .env or use the example credentials in a public deployment.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
    process.env.ADMIN_EMAIL !== "admin@example.com" &&
    !process.env.ADMIN_PASSWORD.startsWith("replace-")) {
  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(process.env.ADMIN_EMAIL.toLowerCase());
  if (!existing) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
    db.prepare("INSERT INTO users(name,email,password_hash,role,email_verified) VALUES(?,?,?,?,1)")
      .run("Site Administrator", process.env.ADMIN_EMAIL.toLowerCase(), hash, "admin");
    console.log("Initial administrator created from environment configuration.");
  }
}

// Seed only sample metadata; books have no downloadable files until the administrator adds licensed files.
const sampleBooks = [
  ["The Power of Good Habits", "LearnSphere Editorial", "A short sample resource about building consistent study habits.", "Motivation", "General", 0, 1],
  ["Stories of Courage", "LearnSphere Editorial", "A sample collection of inspirational stories.", "Inspirational", "General", 0, 1],
  ["Learning with Purpose", "LearnSphere Editorial", "A sample guide to setting meaningful learning goals.", "Personal Development", "General", 0, 1],
  ["Introduction to Biology", "LearnSphere Editorial", "Sample biology listing. Upload an authorized PDF or EPUB to enable downloads.", "Biology", "Grade 10", Number(process.env.DEFAULT_BOOK_PRICE_KES || 400), 0],
  ["Chemistry Revision Guide", "LearnSphere Editorial", "Sample chemistry listing. Replace with content you have permission to distribute.", "Chemistry", "Form 4", Number(process.env.DEFAULT_BOOK_PRICE_KES || 400), 0],
  ["Geography Study Notes", "LearnSphere Editorial", "Sample geography listing. Upload an authorized file from the admin workflow.", "Geography", "Grade 11", Number(process.env.DEFAULT_BOOK_PRICE_KES || 400), 0]
];
for (const b of sampleBooks) {
  const exists = db.prepare("SELECT id FROM books WHERE title=?").get(b[0]);
  if (!exists) db.prepare("INSERT INTO books(title,author,description,category,level,price_kes,is_free) VALUES(?,?,?,?,?,?,?)").run(...b);
}

app.get("/api/health", (req, res) => res.json({ status: "ok", app: "Kelvins LearnSphere", mode: process.env.NODE_ENV || "development" }));

app.get("/api/books", (req, res) => {
  const q = String(req.query.q || "").slice(0, 100).trim();
  const category = String(req.query.category || "").slice(0, 60).trim();
  const rows = db.prepare(`
    SELECT id,title,author,description,category,level,price_kes,is_free
    FROM books
    WHERE (?='' OR title LIKE ? OR author LIKE ? OR description LIKE ? OR category LIKE ? OR level LIKE ?)
      AND (?='' OR category=?)
    ORDER BY is_free DESC, id DESC LIMIT 100
  `).all(q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, category, category);
  res.json(rows.map(safeBook));
});

app.post("/api/register", authLimiter, async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(254),
    password: z.string().min(12).max(128)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid name, email, and password of at least 12 characters." });
  const email = parsed.data.email.toLowerCase();
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) return res.status(409).json({ error: "An account with that email already exists." });
  const hash = await bcrypt.hash(parsed.data.password, 12);
  const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(parsed.data.name, email, hash);
  const userId = Number(result.lastInsertRowid);
  // This demo grants the three seeded free sample titles. In production, only do this
  // after email verification and make verification tokens/links part of the auth flow.
  const freeBooks = db.prepare("SELECT id FROM books WHERE is_free=1 ORDER BY id LIMIT 3").all();
  for (const book of freeBooks) grantEntitlement(userId, book.id, "welcome_free_book");
  audit(userId, "user.registered");
  const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(userId);
  const token = createSession(user);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.status(201).json({ user, message: "Account created. Three introductory books have been added to your library." });
});

app.post("/api/login", authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  const user = db.prepare("SELECT id,name,email,password_hash,role FROM users WHERE email=?").get(parsed.data.email.toLowerCase());
  if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const token = createSession(user);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/logout", (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));

app.get("/api/library", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.id,b.title,b.author,b.description,b.category,b.level,b.price_kes,b.is_free,e.source
    FROM entitlements e JOIN books b ON b.id=e.book_id
    WHERE e.user_id=? ORDER BY e.created_at DESC
  `).all(req.user.id);
  res.json(rows.map(r => ({ ...safeBook(r), source: r.source })));
});

app.post("/api/orders", auth, paymentLimiter, (req, res) => {
  const parsed = z.object({ bookId: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid bookId is required." });
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(parsed.data.bookId);
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (hasEntitlement(req.user.id, book.id)) return res.status(409).json({ error: "You already have access to this book." });
  if (book.is_free) {
    grantEntitlement(req.user.id, book.id, "free_book");
    return res.json({ free: true, message: "Free book added to your library." });
  }
  const result = db.prepare("INSERT INTO orders(user_id,book_id,amount_kes,status) VALUES(?,?,?,'PENDING')")
    .run(req.user.id, book.id, book.price_kes);
  res.status(201).json({ orderId: Number(result.lastInsertRowid), amountKes: book.price_kes, status: "PENDING" });
});

function darajaConfigured() {
  return ["MPESA_CONSUMER_KEY","MPESA_CONSUMER_SECRET","MPESA_SHORTCODE","MPESA_PASSKEY","MPESA_CALLBACK_URL"]
    .every(k => process.env[k] && !process.env[k].includes("your-domain.example"));
}
function mpesaBase() {
  return process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}
async function darajaToken() {
  const credentials = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${mpesaBase()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` }
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error("Unable to obtain Daraja access token.");
  return data.access_token;
}
function darajaTimestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}${String(d.getHours()).padStart(2,"0")}${String(d.getMinutes()).padStart(2,"0")}${String(d.getSeconds()).padStart(2,"0")}`;
}
function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (/^254\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return "254" + digits.slice(1);
  if (/^7\d{8}$/.test(digits)) return "254" + digits;
  return null;
}

app.post("/api/payments/mpesa/stk", auth, paymentLimiter, async (req, res) => {
  const parsed = z.object({ orderId: z.number().int().positive(), phone: z.string().min(9).max(16) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide a valid order ID and Kenyan phone number." });
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(parsed.data.orderId, req.user.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!["PENDING","FAILED"].includes(order.status)) return res.status(409).json({ error: "This order cannot start a new payment." });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return res.status(400).json({ error: "Use a Kenyan phone number such as 0712345678." });
  if (!darajaConfigured()) return res.status(503).json({ error: "Automatic M-Pesa is not configured yet. Use manual verification or configure Daraja credentials." });

  try {
    const token = await darajaToken();
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString("base64");
    const payment = db.prepare("INSERT INTO payments(order_id,method,status,phone,amount_kes) VALUES(?,'mpesa_stk','PROCESSING',?,?)")
      .run(order.id, phone, order.amount_kes);
    const response = await fetch(`${mpesaBase()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: process.env.MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
        Amount: order.amount_kes,
        PartyA: phone,
        PartyB: process.env.MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: `${process.env.MPESA_ACCOUNT_REFERENCE || "LEARN"}-${order.id}`.slice(0, 12),
        TransactionDesc: process.env.MPESA_TRANSACTION_DESC || "Book purchase"
      })
    });
    const data = await response.json();
    if (!response.ok || data.ResponseCode !== "0") {
      db.prepare("UPDATE payments SET status='FAILED',provider_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify({ httpStatus: response.status, response: data }).slice(0, 1000), payment.lastInsertRowid);
      db.prepare("UPDATE orders SET status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
      return res.status(502).json({ error: "M-Pesa did not accept the payment request. Please retry or use manual verification." });
    }
    db.prepare("UPDATE payments SET checkout_request_id=?,merchant_request_id=?,provider_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(data.CheckoutRequestID || null, data.MerchantRequestID || null, JSON.stringify({ responseCode: data.ResponseCode, customerMessage: data.CustomerMessage || "" }), payment.lastInsertRowid);
    db.prepare("UPDATE orders SET status='PROCESSING',payment_method='mpesa_stk',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    res.json({ status: "PROCESSING", message: "Payment prompt requested. This is not confirmation of payment; wait for verified result.", orderId: order.id });
  } catch (err) {
    console.error("STK initiation failed:", err.message);
    res.status(502).json({ error: "Could not initiate M-Pesa. Please try later or use manual verification." });
  }
});

// Callback data is not trusted on its own. Query Daraja using the CheckoutRequestID before granting access.
app.post("/api/payments/mpesa/callback", async (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (!body?.CheckoutRequestID) return res.status(400).json({ ResultCode: 1, ResultDesc: "Invalid callback" });
  const payment = db.prepare("SELECT * FROM payments WHERE checkout_request_id=? AND method='mpesa_stk'").get(body.CheckoutRequestID);
  if (!payment) return res.json({ ResultCode: 0, ResultDesc: "Callback received; no matching payment" });
  try {
    if (!darajaConfigured()) return res.json({ ResultCode: 0, ResultDesc: "Received; verification unavailable" });
    const token = await darajaToken();
    const timestamp = darajaTimestamp();
    const password = Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString("base64");
    const response = await fetch(`${mpesaBase()}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ BusinessShortCode: process.env.MPESA_SHORTCODE, Password: password, Timestamp: timestamp, CheckoutRequestID: payment.checkout_request_id })
    });
    const result = await response.json();
    // A successful query's ResultCode is "0"; query result formats can vary. Only accept
    // success if the provider response is successful and callback has successful result code.
    if (response.ok && String(result.ResultCode) === "0" && String(body.ResultCode) === "0") {
      const metadata = body.CallbackMetadata?.Item || [];
      const amount = Number(metadata.find(x => x.Name === "Amount")?.Value);
      const receipt = String(metadata.find(x => x.Name === "MpesaReceiptNumber")?.Value || "");
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(payment.order_id);
      if (order && amount === payment.amount_kes && amount === order.amount_kes && receipt) {
        const tx = db.transaction(() => {
          const duplicate = db.prepare("SELECT id FROM payments WHERE mpesa_receipt=? AND id<>?").get(receipt, payment.id);
          if (duplicate) throw new Error("Duplicate M-Pesa receipt");
          db.prepare("UPDATE payments SET status='PAID',mpesa_receipt=?,provider_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(receipt, JSON.stringify({ query: result.ResultCode, receipt }), payment.id);
          db.prepare("UPDATE orders SET status='PAID',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
          grantEntitlement(order.user_id, order.book_id, "purchase", order.id);
          audit(null, "payment.mpesa.verified", `order=${order.id}; receipt=${receipt}`);
        });
        tx();
      }
    } else if (String(body.ResultCode) !== "0") {
      db.prepare("UPDATE payments SET status='FAILED',provider_result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify({ resultCode: body.ResultCode, description: body.ResultDesc || "" }).slice(0, 1000), payment.id);
      db.prepare("UPDATE orders SET status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'PAID'").run(payment.order_id);
    }
  } catch (err) {
    console.error("Callback verification deferred:", err.message);
  }
  res.json({ ResultCode: 0, ResultDesc: "Callback received" });
});

app.post("/api/payments/manual", auth, paymentLimiter, (req, res) => {
  const parsed = z.object({
    orderId: z.number().int().positive(),
    transactionReference: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9]+$/)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid order ID and transaction reference." });
  const order = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(parsed.data.orderId, req.user.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (order.status === "PAID" || order.status === "REFUNDED") return res.status(409).json({ error: "This order is not awaiting payment." });
  const ref = parsed.data.transactionReference.toUpperCase();
  if (db.prepare("SELECT id FROM payments WHERE submitted_reference=? OR mpesa_receipt=?").get(ref, ref)) {
    return res.status(409).json({ error: "That transaction reference has already been submitted." });
  }
  const transaction = db.transaction(() => {
    const payment = db.prepare("INSERT INTO payments(order_id,method,status,submitted_reference,amount_kes) VALUES(?,'manual','PENDING_VERIFICATION',?,?)")
      .run(order.id, ref, order.amount_kes);
    db.prepare("INSERT INTO manual_submissions(payment_id,user_id,order_id,transaction_reference) VALUES(?,?,?,?)")
      .run(payment.lastInsertRowid, req.user.id, order.id, ref);
    db.prepare("UPDATE orders SET status='PENDING_VERIFICATION',payment_method='manual',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    audit(req.user.id, "payment.manual.submitted", `order=${order.id}`);
  });
  transaction();
  res.status(202).json({ status: "PENDING_VERIFICATION", message: "Submitted for verification. Your book remains locked until payment is confirmed." });
});

app.get("/api/orders/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid order ID." });
  const order = db.prepare("SELECT id,book_id,amount_kes,status,payment_method,created_at FROM orders WHERE id=? AND user_id=?").get(id, req.user.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  res.json(order);
});

app.get("/api/download/:bookId", auth, (req, res) => {
  const bookId = Number(req.params.bookId);
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(bookId);
  if (!book) return res.status(404).json({ error: "Book not found." });
  if (!hasEntitlement(req.user.id, book.id)) return res.status(403).json({ error: "You do not have access to this book." });
  if (!book.file_path || !book.file_name) return res.status(404).json({ error: "This listing has no file uploaded yet." });
  const filePath = path.resolve(book.file_path);
  if (!filePath.startsWith(BOOKS_DIR + path.sep) || !fs.existsSync(filePath)) return res.status(404).json({ error: "Book file is unavailable." });
  res.download(filePath, path.basename(book.file_name));
});

app.get("/api/admin/payments", auth, admin, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id,p.order_id,p.method,p.status,p.amount_kes,p.submitted_reference,p.mpesa_receipt,p.created_at,
           u.email, b.title
    FROM payments p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id JOIN books b ON b.id=o.book_id
    WHERE p.status='PENDING_VERIFICATION' ORDER BY p.created_at ASC
  `).all();
  res.json(rows);
});

// Admin must verify against a trusted M-Pesa statement/portal. This endpoint records the decision;
// the app cannot independently validate a manually supplied reference without a trusted transaction source.
app.post("/api/admin/payments/:paymentId/verify", auth, admin, (req, res) => {
  const id = Number(req.params.paymentId);
  const parsed = z.object({ decision: z.enum(["approve","reject"]), note: z.string().trim().min(5).max(300) }).safeParse(req.body);
  if (!Number.isInteger(id) || id < 1 || !parsed.success) return res.status(400).json({ error: "Provide a valid payment ID, decision, and verification note." });
  const payment = db.prepare("SELECT p.*,o.user_id,o.book_id,o.amount_kes AS order_amount,o.status AS order_status FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.id=? AND p.method='manual'").get(id);
  if (!payment || payment.status !== "PENDING_VERIFICATION") return res.status(404).json({ error: "Pending manual payment not found." });
  if (parsed.data.decision === "approve") {
    // Require an explicit trusted-evidence note; an admin must check the transaction outside the app.
    const tx = db.transaction(() => {
      const duplicate = db.prepare("SELECT id FROM payments WHERE mpesa_receipt=? AND id<>?").get(payment.submitted_reference, id);
      if (duplicate) throw new Error("Reference already used.");
      db.prepare("UPDATE payments SET status='PAID',mpesa_receipt=?,verified_by=?,verification_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(payment.submitted_reference, req.user.id, parsed.data.note, id);
      db.prepare("UPDATE orders SET status='PAID',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(payment.order_id);
      grantEntitlement(payment.user_id, payment.book_id, "purchase", payment.order_id);
      audit(req.user.id, "payment.manual.approved", `payment=${id}; note=${parsed.data.note}`);
    });
    try { tx(); } catch (e) { return res.status(409).json({ error: "Could not approve payment. Check whether its reference has already been used." }); }
  } else {
    db.prepare("UPDATE payments SET status='REJECTED',verified_by=?,verification_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(req.user.id, parsed.data.note, id);
    db.prepare("UPDATE orders SET status='FAILED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'PAID'").run(payment.order_id);
    audit(req.user.id, "payment.manual.rejected", `payment=${id}; note=${parsed.data.note}`);
  }
  res.json({ ok: true, message: `Payment ${parsed.data.decision}d.` });
});

app.get("/api/admin/books", auth, admin, (req, res) => {
  const rows = db.prepare("SELECT id,title,category,level,price_kes,is_free,file_name FROM books ORDER BY id DESC").all();
  res.json(rows);
});

app.post("/api/admin/books", auth, admin, (req, res) => {
  const parsed = z.object({
    title: z.string().trim().min(2).max(160),
    author: z.string().trim().max(120).default("Unknown"),
    description: z.string().trim().max(2000).default(""),
    category: z.string().trim().min(2).max(80),
    level: z.string().trim().max(80).default("General"),
    priceKes: z.number().int().min(0).max(10000000),
    isFree: z.boolean().default(false)
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Book details are invalid." });
  const b = parsed.data;
  const result = db.prepare("INSERT INTO books(title,author,description,category,level,price_kes,is_free) VALUES(?,?,?,?,?,?,?)")
    .run(b.title,b.author,b.description,b.category,b.level,b.priceKes,b.isFree ? 1 : 0);
  audit(req.user.id, "book.created", `book=${result.lastInsertRowid}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.post("/api/admin/books/:id/upload", auth, admin, (req, res) => {
  // Multipart parsing is intentionally not enabled in this minimal starter. Add a vetted upload
  // middleware with file-type inspection, size limits, malware scanning, and private object storage
  // before enabling uploads in production.
  res.status(501).json({ error: "Secure file uploads are not enabled in this starter. Configure vetted multipart handling and private storage before enabling uploads." });
});

app.get("/api/admin/audit", auth, admin, (req, res) => {
  res.json(db.prepare("SELECT id,actor_user_id,action,details,created_at FROM audit_logs ORDER BY id DESC LIMIT 200").all());
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(PORT, () => console.log(`Kelvins LearnSphere running at http://localhost:${PORT}`));
