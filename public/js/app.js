/* ════════════════════════════════════════════════════════════════
   fvck it. — front-end logic
   ----------------------------------------------------------------
   This file runs in the browser. It:
   - loads products from the server and draws the store
   - manages the cart
   - opens Yoco's popup to collect the card, then asks OUR server
     to do the actual charge (the server holds the secret key)
   - powers the admin back office through the server's API
   ════════════════════════════════════════════════════════════════ */


/* ── state ───────────────────────────────────────────────────── */
let products = [];
let cart = [];            // { id, name, price, size, qty }
let selectedSizes = {};   // productId -> chosen size
let adminPin = null;      // remembered after a correct login

/* ── tiny helpers ────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmt = n => "R" + Number(n).toLocaleString("en-ZA");

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

/* ── boot ────────────────────────────────────────────────────── */
async function init() {
  buildStrip();
  wireUpButtons();
  try {
    products = await api("/api/products");
  } catch (e) {
    toast("Could not load the store: " + e.message);
  }
  renderShop();
  handlePaymentReturn();
}
document.addEventListener("DOMContentLoaded", init);

function wireUpButtons() {
  $("logoHome").onclick = e => { e.preventDefault(); showShop(); };
  $("navShop").onclick = showShop;
  $("navAdmin").onclick = askAdmin;
  $("navCart").onclick = openCart;
  $("closeCartBtn").onclick = closeCart;
  $("overlay").onclick = closeCart;
  $("payBtn").onclick = checkout;
  $("addProductBtn").onclick = addProduct;
}

function buildStrip() {
  const bits = "fvck it. — two tones — zero noise — ".repeat(6);
  $("strip").innerHTML = bits.split("—").map(s => `<span>${s.trim()}</span>—`).join("");
}

/* ── storefront ──────────────────────────────────────────────── */
function renderShop() {
  $("itemTally").textContent = products.length + " pieces";
  const grid = $("productGrid");
  if (!products.length) {
    grid.innerHTML = `<div class="empty-shop">Nothing in the store yet. Add your first piece in the back office.</div>`;
    return;
  }
  grid.innerHTML = products.map(p => {
    const sel = selectedSizes[p.id] || p.sizes[0];
    selectedSizes[p.id] = sel;
    const imgHtml = p.img
      ? `<img src="${p.img}" alt="${p.name}" onerror="this.outerHTML='<div class=&quot;ph&quot;>fv.</div>'">`
      : `<div class="ph">fv.</div>`;
    return `
    <article class="card">
      <div class="card-img">${imgHtml}</div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <span class="price">${fmt(p.price)}</span>
        <p class="muted" style="font-size:12px;line-height:1.5">${p.desc || ""}</p>
        <div class="sizes">
          ${p.sizes.map(s => `<button class="size ${s === sel ? "sel" : ""}" onclick="pickSize('${p.id}','${s}')">${s}</button>`).join("")}
        </div>
        <button class="add-btn" onclick="addToCart('${p.id}')">Add to cart</button>
      </div>
    </article>`;
  }).join("");
}

function pickSize(id, size) { selectedSizes[id] = size; renderShop(); }

/* ── cart ────────────────────────────────────────────────────── */
function addToCart(id) {
  const p = products.find(x => x.id === id);
  const size = selectedSizes[id] || p.sizes[0];
  const line = cart.find(c => c.id === id && c.size === size);
  if (line) line.qty++;
  else cart.push({ id, name: p.name, price: p.price, size, qty: 1 });
  saveCart();
  renderCart();
  toast(`${p.name} (${size}) added`);
}
function changeQty(i, d) {
  cart[i].qty += d;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  saveCart();
  renderCart();
}
function removeLine(i) { cart.splice(i, 1); saveCart(); renderCart(); }
function cartTotal() { return cart.reduce((s, c) => s + c.price * c.qty, 0); }

function renderCart() {
  $("cartCount").textContent = cart.reduce((s, c) => s + c.qty, 0);
  $("cartTotal").textContent = fmt(cartTotal());
  $("cartItems").innerHTML = cart.length ? cart.map((c, i) => `
    <div class="cart-row">
      <div class="info"><strong>${c.name}</strong><span>Size ${c.size} · ${fmt(c.price)}</span></div>
      <div class="qty">
        <button onclick="changeQty(${i},-1)" aria-label="Decrease">−</button>
        <span>${c.qty}</span>
        <button onclick="changeQty(${i},1)" aria-label="Increase">+</button>
      </div>
      <button class="rm" onclick="removeLine(${i})">remove</button>
    </div>`).join("")
    : `<p class="muted" style="padding:40px 0;text-align:center">Your cart is empty.</p>`;
}

function openCart() { $("drawer").classList.add("open"); $("overlay").classList.add("open"); }
function closeCart() { $("drawer").classList.remove("open"); $("overlay").classList.remove("open"); }

/* ── checkout via Yoco's hosted page ─────────────────────────────
   Step 1: we ask OUR server to create a Yoco checkout
   Step 2: the server answers with Yoco's redirectUrl
   Step 3: we send the customer to Yoco's secure payment page.
   When they're done, Yoco sends them back and the server verifies
   and records the sale before this page even loads again.        */
async function checkout() {
  if (!cart.length) { toast("Your cart is empty"); return; }
  const btn = $("payBtn");
  btn.disabled = true;
  btn.textContent = "Opening secure checkout…";
  try {
    const out = await api("/api/pay", {
      method: "POST",
      body: JSON.stringify({ cart: cart.map(c => ({ id: c.id, size: c.size, qty: c.qty })) })
    });
    saveCart();                       // keep the cart in case they cancel
    window.location.href = out.redirectUrl;   // off to Yoco's payment page
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "Pay with Yoco";
  }
}

/* ── remember the cart across the redirect ── */
function saveCart() {
  try { localStorage.setItem("fvckit:cart", JSON.stringify(cart)); } catch (e) {}
}
function restoreCart() {
  try { cart = JSON.parse(localStorage.getItem("fvckit:cart")) || []; } catch (e) { cart = []; }
}
function clearSavedCart() {
  try { localStorage.removeItem("fvckit:cart"); } catch (e) {}
}

/* ── show the result when Yoco sends the customer back ── */
function handlePaymentReturn() {
  const status = new URLSearchParams(window.location.search).get("payment");
  if (!status) { restoreCart(); renderCart(); return; }
  if (status === "success") {
    cart = []; clearSavedCart();
    toast("Payment received — order placed ✓");
  } else if (status === "cancelled") {
    restoreCart();
    toast("Checkout cancelled — your cart is still here");
  } else if (status === "failed") {
    restoreCart();
    toast("Payment failed — your card was not charged");
  } else {
    restoreCart();
    toast("We're confirming your payment — check back in a minute");
  }
  renderCart();
  history.replaceState(null, "", window.location.pathname); // tidy the URL
}

/* ── admin ───────────────────────────────────────────────────── */
async function askAdmin() {
  if (!adminPin) {
    const pin = prompt("Admin PIN");
    if (pin === null) return;
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ pin }) });
      adminPin = pin;
    } catch (e) { toast("Wrong PIN"); return; }
  }
  $("storefront").style.display = "none";
  $("adminView").classList.add("show");
  $("navShop").classList.remove("active");
  $("navAdmin").classList.add("active");
  refreshAdmin();
}

function showShop() {
  $("storefront").style.display = "";
  $("adminView").classList.remove("show");
  $("navShop").classList.add("active");
  $("navAdmin").classList.remove("active");
}

async function refreshAdmin() {
  let sales = [];
  try { sales = await api("/api/sales", { headers: { "x-admin-pin": adminPin } }); }
  catch (e) { toast(e.message); }

  $("statCount").textContent = sales.length;
  $("statRev").textContent = fmt(sales.reduce((s, x) => s + x.total, 0));
  $("statItems").textContent = products.length;

  $("invBody").innerHTML = products.length ? products.map(p => `
    <tr>
      <td><strong>${p.name}</strong><br><span class="muted" style="font-size:12px">${p.desc || ""}</span></td>
      <td>${fmt(p.price)}</td>
      <td>${p.sizes.join(" / ")}</td>
      <td><button class="btn-ghost" onclick="deleteProduct('${p.id}')">Remove</button></td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="muted">Store is empty — add your first piece above.</td></tr>`;

  $("salesBody").innerHTML = sales.length ? sales.map(s => `
    <tr>
      <td>${new Date(s.date).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</td>
      <td>${s.items}</td>
      <td><strong>${fmt(s.total)}</strong></td>
      <td class="muted" style="font-size:12px">${s.ref}</td>
    </tr>`).join("")
    : `<tr><td colspan="4" class="muted">No sales yet. They'll show up here the moment a checkout completes.</td></tr>`;
}

async function addProduct() {
  const body = {
    name: $("pName").value.trim(),
    price: parseFloat($("pPrice").value),
    sizes: $("pSizes").value.split(",").map(s => s.trim()).filter(Boolean),
    img: $("pImg").value.trim(),
    desc: $("pDesc").value.trim()
  };
  if (!body.name || !body.price || body.price <= 0 || !body.sizes.length) {
    toast("Add a name, a price and at least one size"); return;
  }
  try {
    const product = await api("/api/products", {
      method: "POST",
      headers: { "x-admin-pin": adminPin },
      body: JSON.stringify(body)
    });
    products.push(product);
    ["pName", "pPrice", "pImg", "pDesc"].forEach(id => $(id).value = "");
    renderShop(); refreshAdmin();
    toast(`"${product.name}" added to the store`);
  } catch (e) { toast(e.message); }
}

async function deleteProduct(id) {
  try {
    await api("/api/products/" + id, { method: "DELETE", headers: { "x-admin-pin": adminPin } });
    products = products.filter(p => p.id !== id);
    renderShop(); refreshAdmin();
    toast("Piece removed");
  } catch (e) { toast(e.message); }
}

/* ── toast ───────────────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
