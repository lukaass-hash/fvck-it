/* ════════════════════════════════════════════════════════════════
   fvck it. — server
   ----------------------------------------------------------------
   Payments follow Yoco's official Checkout API flow
   (developer.yoco.com/docs/api):

   1. CREATE   Browser asks us to start a payment. We total the cart
               ourselves, then POST to Yoco's /api/checkouts with the
               SECRET key. Yoco answers with a redirectUrl.
   2. REDIRECT The customer goes to Yoco's hosted payment page and
               types their card there (never on our site).
   3. VERIFY   Yoco sends the customer back to us. We do NOT trust
               that redirect — we ask Yoco's API directly whether the
               checkout really succeeded, and only then record the sale.
   ════════════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const DATA = path.join(__dirname, "..", "data");
const PRODUCTS_FILE = path.join(DATA, "products.json");
const SALES_FILE = path.join(DATA, "sales.json");
const PENDING_FILE = path.join(DATA, "pending.json");

const YOCO_API = "https://payments.yoco.com/api/checkouts";
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/* ── tiny JSON file helpers ─────────────────────────────────────── */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ── admin check ────────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (req.headers["x-admin-pin"] === (process.env.ADMIN_PIN || "2026")) return next();
  res.status(401).json({ error: "Wrong admin PIN" });
}

/* ════════ PRODUCTS ════════ */

app.get("/api/products", (req, res) => {
  res.json(readJSON(PRODUCTS_FILE, []));
});

app.post("/api/products", requireAdmin, (req, res) => {
  const { name, price, sizes, img, desc } = req.body;
  if (!name || !price || price <= 0 || !Array.isArray(sizes) || !sizes.length) {
    return res.status(400).json({ error: "Need a name, a price above 0 and at least one size" });
  }
  const products = readJSON(PRODUCTS_FILE, []);
  const product = {
    id: "p" + Date.now(),
    name: String(name).trim(),
    price: Number(price),
    sizes: sizes.map(s => String(s).trim()).filter(Boolean),
    img: (img || "").trim(),
    desc: (desc || "").trim()
  };
  products.push(product);
  writeJSON(PRODUCTS_FILE, products);
  res.json(product);
});

app.delete("/api/products/:id", requireAdmin, (req, res) => {
  let products = readJSON(PRODUCTS_FILE, []);
  products = products.filter(p => p.id !== req.params.id);
  writeJSON(PRODUCTS_FILE, products);
  res.json({ ok: true });
});

/* ════════ ADMIN LOGIN + SALES ════════ */

app.post("/api/admin/login", (req, res) => {
  if (req.body.pin === (process.env.ADMIN_PIN || "2026")) return res.json({ ok: true });
  res.status(401).json({ error: "Wrong PIN" });
});

app.get("/api/sales", requireAdmin, (req, res) => {
  res.json(readJSON(SALES_FILE, []));
});

/* ════════ STEP 1 — CREATE THE CHECKOUT ════════
   Browser sends: { cart: [{ id, size, qty }] }
   We price the cart from OUR product list (so nobody can pay R1
   for a hoodie by editing their browser), then ask Yoco to open
   a checkout. We answer with Yoco's redirectUrl.                  */
app.post("/api/pay", async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart) || !cart.length) {
    return res.status(400).json({ error: "Your cart is empty" });
  }

  const products = readJSON(PRODUCTS_FILE, []);
  let totalCents = 0;
  const lines = [];
  const lineItems = [];
  for (const item of cart) {
    const p = products.find(x => x.id === item.id);
    if (!p) return res.status(400).json({ error: "Unknown product in cart" });
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const priceCents = Math.round(p.price * 100);
    totalCents += priceCents * qty;
    lines.push(`${p.name} (${item.size}) ×${qty}`);
    lineItems.push({
      displayName: `${p.name} (${item.size})`,
      quantity: qty,
      pricingDetails: { price: priceCents }
    });
  }

  // Yoco does not accept payments under R2
  if (totalCents < 200) {
    return res.status(400).json({ error: "Yoco requires a minimum payment of R2" });
  }

  // Our own order number — it travels through the redirect URLs
  const orderId = crypto.randomUUID();

  try {
    const yocoRes = await fetch(YOCO_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.YOCO_SECRET_KEY || "")
      },
      body: JSON.stringify({
        amount: totalCents,
        currency: "ZAR",
        successUrl: `${BASE_URL}/payment/success?order=${orderId}`,
        cancelUrl: `${BASE_URL}/payment/cancelled?order=${orderId}`,
        failureUrl: `${BASE_URL}/payment/failed?order=${orderId}`,
        lineItems: lineItems,
        metadata: { orderId: orderId, store: "fvck it." }
      })
    });
    const checkout = await yocoRes.json();

    if (!yocoRes.ok || !checkout.redirectUrl) {
      console.error("Yoco error:", checkout);
      return res.status(502).json({
        error: checkout.description || checkout.message || "Yoco could not create the checkout"
      });
    }

    // Remember this order until the customer comes back
    const pending = readJSON(PENDING_FILE, {});
    pending[orderId] = {
      checkoutId: checkout.id,
      items: lines.join(", "),
      total: totalCents / 100,
      created: new Date().toISOString()
    };
    writeJSON(PENDING_FILE, pending);

    res.json({ redirectUrl: checkout.redirectUrl });
  } catch (err) {
    console.error("Could not reach Yoco:", err);
    res.status(500).json({ error: "Could not reach the payment provider. Try again." });
  }
});

/* ════════ STEP 3 — VERIFY, THEN RECORD THE SALE ════════
   Yoco redirects the customer here after the hosted payment page.
   The redirect alone proves nothing (anyone can type this URL),
   so we ask Yoco's API for the checkout's real status first.     */
app.get("/payment/success", async (req, res) => {
  const orderId = req.query.order;
  const pending = readJSON(PENDING_FILE, {});
  const order = pending[orderId];
  if (!order) return res.redirect("/?payment=unknown");

  try {
    const yocoRes = await fetch(`${YOCO_API}/${order.checkoutId}`, {
      headers: { "Authorization": "Bearer " + (process.env.YOCO_SECRET_KEY || "") }
    });
    const checkout = await yocoRes.json();

    // A completed checkout carries a paymentId — that's our proof
    if (yocoRes.ok && (checkout.status === "completed" || checkout.paymentId)) {
      const sales = readJSON(SALES_FILE, []);
      // Don't record the same order twice if the page is refreshed
      if (!sales.some(s => s.orderId === orderId)) {
        sales.unshift({
          orderId: orderId,
          date: new Date().toISOString(),
          items: order.items,
          total: order.total,
          ref: checkout.paymentId || order.checkoutId
        });
        writeJSON(SALES_FILE, sales);
      }
      delete pending[orderId];
      writeJSON(PENDING_FILE, pending);
      return res.redirect("/?payment=success");
    }
    return res.redirect("/?payment=pending");
  } catch (err) {
    console.error("Could not verify payment:", err);
    return res.redirect("/?payment=pending");
  }
});

app.get("/payment/cancelled", (req, res) => res.redirect("/?payment=cancelled"));
app.get("/payment/failed", (req, res) => res.redirect("/?payment=failed"));

/* ── go ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`fvck it. is live → http://localhost:${PORT}`);
  const key = process.env.YOCO_SECRET_KEY || "";
  if (!key) console.log("⚠ No YOCO_SECRET_KEY in .env — payments will fail until you add one.");
  else console.log(key.startsWith("sk_live_")
    ? "● LIVE keys — real money will move."
    : "○ TEST keys — no real money moves.");
});
