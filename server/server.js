/* ════════════════════════════════════════════════════════════════
   fvck it. — server (v2)
   ----------------------------------------------------------------
   Three production fixes baked in:

   1. AUTO-SEED   On boot, if data/products.json is missing (e.g. a
                  freshly-mounted Railway volume) we write a starter
                  set so the store never appears empty.
   2. BASE_URL    We normalise whatever you put in the env var:
                  "www.example.co.za"      → "https://www.example.co.za"
                  "https://x.com/"         → "https://x.com"
                  This is what was breaking Yoco — it received URLs
                  without https:// and rejected the checkout.
   3. PORT 8080   Default port is now 8080. Railway's PORT env var
                  still wins when set, so this works both ways.
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
const PORT = Number(process.env.PORT) || 8080;

/* ── BASE_URL normalisation ─────────────────────────────────────── */
function normaliseBaseUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim().replace(/\/+$/, "");      // strip trailing slashes
  if (!/^https?:\/\//i.test(url)) url = "https://" + url; // add https:// if missing
  return url;
}
const BASE_URL = normaliseBaseUrl(process.env.BASE_URL) || `http://localhost:${PORT}`;

/* ── auto-seed data files (fresh Railway volume = empty folder) ── */
function ensureDataFiles() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

  if (!fs.existsSync(PRODUCTS_FILE)) {
    const seed = [
      {
        id: "p_seed_tee",
        name: "essential tee",
        price: 449,
        sizes: ["S", "M", "L", "XL"],
        img: "",
        desc: "260gsm heavyweight cotton. Boxy cut, tight collar."
      },
      {
        id: "p_seed_hoodie",
        name: "oversized hoodie",
        price: 899,
        sizes: ["S", "M", "L", "XL", "XXL"],
        img: "",
        desc: "450gsm brushed fleece. Dropped shoulders, double-lined hood."
      }
    ];
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(seed, null, 2));
    console.log("✓ Seeded products.json with starter items");
  }
  if (!fs.existsSync(SALES_FILE)) fs.writeFileSync(SALES_FILE, "[]");
  if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, "{}");
}
ensureDataFiles();

/* ── JSON file helpers ─────────────────────────────────────────── */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ── admin gate ────────────────────────────────────────────────── */
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
    desc: (desc || "").trim(),
    addedAt: new Date().toISOString()
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

/* ════════ ADMIN ════════ */
app.post("/api/admin/login", (req, res) => {
  if (req.body.pin === (process.env.ADMIN_PIN || "2026")) return res.json({ ok: true });
  res.status(401).json({ error: "Wrong PIN" });
});

app.get("/api/sales", requireAdmin, (req, res) => {
  res.json(readJSON(SALES_FILE, []));
});

/* ════════ STEP 1 — CREATE A YOCO CHECKOUT ════════ */
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

  if (totalCents < 200) {
    return res.status(400).json({ error: "Yoco requires a minimum payment of R2" });
  }

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

/* ════════ STEP 3 — VERIFY THEN RECORD ════════ */
app.get("/payment/success", async (req, res) => {
  const orderId = req.query.order;
  const pending = readJSON(PENDING_FILE, {});
  const order = pending[orderId];

  if (!order) {
    // Already recorded? Then the customer is just refreshing — still success.
    const sales = readJSON(SALES_FILE, []);
    if (sales.some(s => s.orderId === orderId)) return res.redirect("/?payment=success");
    return res.redirect("/?payment=unknown");
  }

  try {
    const yocoRes = await fetch(`${YOCO_API}/${order.checkoutId}`, {
      headers: { "Authorization": "Bearer " + (process.env.YOCO_SECRET_KEY || "") }
    });
    const checkout = await yocoRes.json();

    if (yocoRes.ok && (checkout.status === "completed" || checkout.paymentId)) {
      const sales = readJSON(SALES_FILE, []);
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

/* ── start ── */
app.listen(PORT, () => {
  const key = process.env.YOCO_SECRET_KEY || "";
  console.log(`fvck it. is live on port ${PORT}`);
  console.log(`  BASE_URL  = ${BASE_URL}`);
  console.log(`  YOCO_KEY  = ${
    !key ? "⚠  MISSING — payments will fail" :
    key.startsWith("sk_live_") ? "● LIVE — real money moves" :
    "○ TEST — no real money moves"
  }`);
});
