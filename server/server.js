/* ════════════════════════════════════════════════════════════════
   fvck it. — server (v3)
   ----------------------------------------------------------------
   No admin panel. Orders are posted to a Discord webhook.

   Products live in /products.json at the repo root — edit that file
   on GitHub to change the store. Railway redeploys automatically
   in about 30 seconds.

   The /data folder (on the Railway volume) is now used only for
   pending.json — a short list of orders waiting to come back from
   Yoco's payment page. Keeping it on the volume means deploys
   don't break in-flight checkouts.
   ════════════════════════════════════════════════════════════════ */

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PRODUCTS_FILE = path.join(__dirname, "..", "products.json");
const PENDING_DIR   = path.join(__dirname, "..", "data");
const PENDING_FILE  = path.join(PENDING_DIR, "pending.json");

const YOCO_API = "https://payments.yoco.com/api/checkouts";
const PORT = Number(process.env.PORT) || 8080;
const DISCORD_WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || "").trim();

/* ── BASE_URL normalisation ─────────────────────────────────── */
function normaliseBaseUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}
const BASE_URL = normaliseBaseUrl(process.env.BASE_URL) || `http://localhost:${PORT}`;

/* ── ensure /data exists for the volume ─────────────────────── */
if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, "{}");

/* ── JSON helpers ───────────────────────────────────────────── */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ════════ PRODUCTS ════════ */
app.get("/api/products", (req, res) => {
  res.json(readJSON(PRODUCTS_FILE, []));
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
        cancelUrl:  `${BASE_URL}/payment/cancelled?order=${orderId}`,
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

/* ════════ STEP 3 — VERIFY THEN POST TO DISCORD ════════ */
app.get("/payment/success", async (req, res) => {
  const orderId = req.query.order;
  const pending = readJSON(PENDING_FILE, {});
  const order = pending[orderId];

  /* If the order is gone from pending, we already processed it —
     the customer is just refreshing. Don't notify again. */
  if (!order) return res.redirect("/?payment=success");

  try {
    const yocoRes = await fetch(`${YOCO_API}/${order.checkoutId}`, {
      headers: { "Authorization": "Bearer " + (process.env.YOCO_SECRET_KEY || "") }
    });
    const checkout = await yocoRes.json();

    if (yocoRes.ok && (checkout.status === "completed" || checkout.paymentId)) {
      const paymentRef = checkout.paymentId || order.checkoutId;
      /* Remove from pending FIRST so a refresh can't double-notify */
      delete pending[orderId];
      writeJSON(PENDING_FILE, pending);

      /* Fire-and-await Discord, but don't block the customer for long */
      await postToDiscord({ orderId, ...order, paymentRef })
        .catch(err => console.error("Discord post failed:", err));

      return res.redirect("/?payment=success");
    }
    return res.redirect("/?payment=pending");
  } catch (err) {
    console.error("Could not verify payment:", err);
    return res.redirect("/?payment=pending");
  }
});

app.get("/payment/cancelled", (req, res) => res.redirect("/?payment=cancelled"));
app.get("/payment/failed",    (req, res) => res.redirect("/?payment=failed"));

/* ════════ DISCORD WEBHOOK ════════ */
async function postToDiscord(order) {
  if (!DISCORD_WEBHOOK) {
    console.log("⚠ DISCORD_WEBHOOK_URL not set — order will not be notified");
    console.log("  order recorded internally:", order);
    return;
  }
  const fmt = n => "R" + Number(n).toLocaleString("en-ZA");
  const payload = {
    username: "fvck it. — sales",
    embeds: [{
      title: "💸 New order",
      color: 0x252627,
      fields: [
        { name: "Total",       value: fmt(order.total),      inline: true  },
        { name: "Order ID",    value: order.orderId,         inline: true  },
        { name: "Items",       value: order.items,           inline: false },
        { name: "Payment ref", value: order.paymentRef,      inline: false }
      ],
      footer: { text: "fvck it. · Cape Town" },
      timestamp: new Date().toISOString()
    }]
  };
  const res = await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text.slice(0, 200)}`);
  }
}

/* ── start ── */
app.listen(PORT, () => {
  const key = process.env.YOCO_SECRET_KEY || "";
  console.log(`fvck it. is live on port ${PORT}`);
  console.log(`  BASE_URL = ${BASE_URL}`);
  console.log(`  YOCO_KEY = ${
    !key ? "⚠  MISSING — payments will fail" :
    key.startsWith("sk_live_") ? "● LIVE — real money moves" :
    "○ TEST — no real money moves"
  }`);
  console.log(`  DISCORD  = ${DISCORD_WEBHOOK ? "✓ configured" : "⚠  not set — orders will only log to console"}`);
});
