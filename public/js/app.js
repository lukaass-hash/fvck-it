/* ════════════════════════════════════════════════════════════════
   fvck it. — front-end (v4)
   - Home / Catalogue tabs
   - Cart with customer details form (email, phone, address)
   - Yoco Checkout API redirect flow
   ════════════════════════════════════════════════════════════════ */

let state = {
  products: [],
  cart: [],
  selectedSizes: {}
};

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

/* ── ROUTING ─────────────────────────────────────────────────── */
function showPage(name) {
  document.querySelectorAll("[data-page]").forEach(p => {
    p.classList.toggle("active", p.dataset.page === name);
  });
  document.querySelectorAll(".nav-link[data-route]").forEach(b => {
    b.classList.toggle("active", b.dataset.route === name);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function route() {
  const hash = (location.hash || "#home").replace("#", "");
  if (hash === "catalogue") {
    showPage("catalogue");
    renderCatalogue();
  } else {
    showPage("home");
    renderHome();
  }
}

/* ── BOOT ────────────────────────────────────────────────────── */
async function init() {
  wireUp();
  restoreCart();
  restoreCustomer();
  try {
    state.products = await api("/api/products");
  } catch (e) {
    toast("Could not load products: " + e.message);
  }
  handlePaymentReturn();
  route();
  renderCart();
}
document.addEventListener("DOMContentLoaded", init);
window.addEventListener("hashchange", route);

function wireUp() {
  document.body.addEventListener("click", e => {
    const target = e.target.closest("[data-route]");
    if (!target) return;
    e.preventDefault();
    location.hash = "#" + target.dataset.route;
  });
  $("cartBtn").onclick = openCart;
  $("closeCartBtn").onclick = closeCart;
  $("overlay").onclick = closeCart;
  $("payBtn").onclick = checkout;
}

/* ── PRODUCT CARD ────────────────────────────────────────────── */
function isRecent(product) {
  if (!product.addedAt) return false;
  const days = (Date.now() - new Date(product.addedAt).getTime()) / 86400000;
  return days < 14;
}

function productCard(p) {
  const sel = state.selectedSizes[p.id] || p.sizes[0];
  state.selectedSizes[p.id] = sel;
  const initials = p.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toLowerCase() || "fv";
  const imgHtml = p.img
    ? `<img src="${p.img}" alt="${p.name}" onerror="this.outerHTML='<div class=&quot;ph&quot;>${initials}.</div>'">`
    : `<div class="ph">${initials}.</div>`;
  const newBadge = isRecent(p) ? `<span class="badge-new">New</span>` : "";

  return `
    <article class="card">
      <div class="card-img">
        ${newBadge}
        ${imgHtml}
      </div>
      <div class="card-body">
        <h3>${p.name}</h3>
        <span class="price">${fmt(p.price)}</span>
        ${p.desc ? `<p class="desc">${p.desc}</p>` : ""}
        <div class="sizes">
          ${p.sizes.map(s => `<button class="size ${s === sel ? "sel" : ""}" data-pid="${p.id}" data-size="${s}">${s}</button>`).join("")}
        </div>
        <button class="add-btn" data-add="${p.id}">Add to cart</button>
      </div>
    </article>`;
}

function attachCardHandlers(container) {
  container.querySelectorAll(".size").forEach(b => {
    b.onclick = () => { state.selectedSizes[b.dataset.pid] = b.dataset.size; rerenderActive(); };
  });
  container.querySelectorAll("[data-add]").forEach(b => {
    b.onclick = () => addToCart(b.dataset.add);
  });
}

function rerenderActive() {
  const active = document.querySelector("[data-page].active");
  if (!active) return;
  if (active.dataset.page === "home") renderHome();
  if (active.dataset.page === "catalogue") renderCatalogue();
}

/* ── RENDER: HOME ────────────────────────────────────────────── */
function renderHome() {
  const sorted = state.products.slice().sort((a, b) => {
    const ta = a.addedAt ? new Date(a.addedAt).getTime() : 0;
    const tb = b.addedAt ? new Date(b.addedAt).getTime() : 0;
    return tb - ta;
  });
  const latest = sorted.slice(0, 4);

  $("latestCount").textContent = state.products.length
    ? `Showing ${latest.length} of ${state.products.length}`
    : "";

  const grid = $("latestGrid");
  if (!latest.length) {
    grid.innerHTML = `<div class="empty-grid">Nothing in the store yet.</div>`;
    return;
  }
  grid.innerHTML = latest.map(productCard).join("");
  attachCardHandlers(grid);
}

/* ── RENDER: CATALOGUE ───────────────────────────────────────── */
function renderCatalogue() {
  $("catalogueCount").textContent = state.products.length + " pieces";
  const grid = $("catalogueGrid");
  if (!state.products.length) {
    grid.innerHTML = `<div class="empty-grid">Nothing in the store yet.</div>`;
    return;
  }
  grid.innerHTML = state.products.map(productCard).join("");
  attachCardHandlers(grid);
}

/* ── CART ────────────────────────────────────────────────────── */
function addToCart(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const size = state.selectedSizes[id] || p.sizes[0];
  const line = state.cart.find(c => c.id === id && c.size === size);
  if (line) line.qty++;
  else state.cart.push({ id, name: p.name, price: p.price, size, qty: 1 });
  saveCart();
  renderCart();
  toast(`${p.name} (${size}) added`);
}
function changeQty(i, d) {
  state.cart[i].qty += d;
  if (state.cart[i].qty <= 0) state.cart.splice(i, 1);
  saveCart();
  renderCart();
}
function removeLine(i) { state.cart.splice(i, 1); saveCart(); renderCart(); }
function cartTotal() { return state.cart.reduce((s, c) => s + c.price * c.qty, 0); }

function renderCart() {
  const n = state.cart.reduce((s, c) => s + c.qty, 0);
  $("cartCount").textContent = `(${n})`;
  $("cartTotal").textContent = fmt(cartTotal());

  // Show/hide checkout form based on cart contents
  $("checkoutForm").style.display = n > 0 ? "" : "none";

  $("cartItems").innerHTML = state.cart.length ? state.cart.map((c, i) => `
    <div class="cart-row">
      <div class="info"><strong>${c.name}</strong><span>Size ${c.size} · ${fmt(c.price)}</span></div>
      <div class="qty">
        <button onclick="changeQty(${i}, -1)" aria-label="Decrease">−</button>
        <span>${c.qty}</span>
        <button onclick="changeQty(${i}, 1)" aria-label="Increase">+</button>
      </div>
      <button class="rm" onclick="removeLine(${i})">remove</button>
    </div>`).join("")
    : `<p class="muted" style="padding: 50px 0; text-align: center;">Your cart is empty.</p>`;
}
window.changeQty = changeQty;
window.removeLine = removeLine;

function openCart() { $("drawer").classList.add("open"); $("overlay").classList.add("open"); }
function closeCart() { $("drawer").classList.remove("open"); $("overlay").classList.remove("open"); }

function saveCart() {
  try { localStorage.setItem("fvckit:cart", JSON.stringify(state.cart)); } catch (e) {}
}
function restoreCart() {
  try { state.cart = JSON.parse(localStorage.getItem("fvckit:cart")) || []; } catch (e) { state.cart = []; }
}
function clearSavedCart() {
  try { localStorage.removeItem("fvckit:cart"); } catch (e) {}
}

/* ── CUSTOMER DETAILS: remember across sessions ─────────────── */
function saveCustomer() {
  try {
    localStorage.setItem("fvckit:customer", JSON.stringify({
      email: $("cfEmail").value.trim(),
      phone: $("cfPhone").value.trim(),
      address: $("cfAddress").value.trim()
    }));
  } catch (e) {}
}
function restoreCustomer() {
  try {
    const c = JSON.parse(localStorage.getItem("fvckit:customer"));
    if (!c) return;
    if (c.email)   $("cfEmail").value   = c.email;
    if (c.phone)   $("cfPhone").value   = c.phone;
    if (c.address) $("cfAddress").value = c.address;
  } catch (e) {}
}

/* ── CHECKOUT VALIDATION + YOCO REDIRECT ────────────────────── */
function validateCheckoutForm() {
  const email   = $("cfEmail").value.trim();
  const phone   = $("cfPhone").value.trim();
  const address = $("cfAddress").value.trim();

  [$("cfEmail"), $("cfPhone"), $("cfAddress")].forEach(el => el.classList.remove("field-error"));

  const errors = [];
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("cfEmail").classList.add("field-error");
    errors.push("email");
  }
  if (!phone || phone.replace(/\D/g, "").length < 9) {
    $("cfPhone").classList.add("field-error");
    errors.push("phone number");
  }
  if (!address || address.length < 10) {
    $("cfAddress").classList.add("field-error");
    errors.push("delivery address");
  }

  if (errors.length) {
    toast("Please fill in your " + errors.join(", "));
    return null;
  }
  return { email, phone, address };
}

async function checkout() {
  if (!state.cart.length) { toast("Your cart is empty"); return; }

  const customer = validateCheckoutForm();
  if (!customer) return;

  saveCustomer();

  const btn = $("payBtn");
  btn.disabled = true;
  btn.textContent = "Opening secure checkout…";
  try {
    const out = await api("/api/pay", {
      method: "POST",
      body: JSON.stringify({
        cart: state.cart.map(c => ({ id: c.id, size: c.size, qty: c.qty })),
        customer
      })
    });
    saveCart();
    window.location.href = out.redirectUrl;
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = "Pay with Yoco";
  }
}

function handlePaymentReturn() {
  const status = new URLSearchParams(location.search).get("payment");
  if (!status) return;
  if (status === "success") {
    state.cart = [];
    clearSavedCart();
    toast("Payment received — order placed ✓");
  } else if (status === "cancelled") {
    toast("Checkout cancelled — your cart is still here");
  } else if (status === "failed") {
    toast("Payment failed — your card was not charged");
  } else {
    toast("We're confirming your payment — check back in a minute");
  }
  history.replaceState(null, "", location.pathname + location.hash);
}

/* ── TOAST ───────────────────────────────────────────────────── */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
