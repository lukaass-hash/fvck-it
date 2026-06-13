# fvck it. — online store

A two-tone (Carbon Black `#252627` / Snow `#FFF9FB`) clothing store with an
admin back office and Yoco card payments, built on Yoco's official
**Checkout API** (developer.yoco.com/docs/api).

---

## 1. What's in the folder

```
fvck-it/
├── public/                 the website
│   ├── index.html          DESIGN 1 — light, clean catalogue
│   ├── noir.html           DESIGN 2 — dark noir lookbook
│   ├── css/styles.css      design 1 styling
│   ├── css/noir.css        design 2 styling
│   ├── js/app.js           design 1 logic
│   └── js/app-noir.js      design 2 logic
├── server/server.js        web server, storage, Yoco payments
├── data/
│   ├── products.json       your inventory (auto-saved)
│   ├── sales.json          every verified sale (auto-saved)
│   └── pending.json        orders waiting at the payment page
├── .env                    your keys & settings (already filled in)
├── .env.example            blank template
├── .gitignore              keeps .env + node_modules out of git
└── package.json
```

---

## 2. How to launch

1. Install **Node.js** (v18+) from nodejs.org if you don't have it.
2. Open a terminal **inside this folder** and run:
   ```
   npm install
   ```
   (only needed the first time)
3. Start the site:
   ```
   npm start
   ```
4. Open **http://localhost:3000** — that's Design 1.
   **http://localhost:3000/noir.html** is Design 2.
   Both share the same products, sales and admin.

The terminal tells you which mode you're in:
- `○ TEST keys — no real money moves.`
- `● LIVE keys — real money will move.`

**Admin:** click *Admin* in the top bar, PIN `2026` (change it in `.env`).

---

## 3. How a payment works (so you know what you're testing)

1. Customer clicks **Pay with Yoco** → your server totals the cart from
   its own price list and asks Yoco to create a checkout.
2. Customer is redirected to **Yoco's secure hosted payment page** and
   enters their card there — card details never touch your site.
3. Yoco sends them back to your site. Your server then asks Yoco's API
   directly "did this checkout really complete?" and only records the
   sale once Yoco confirms it. Refreshing the page can't duplicate a sale,
   and faking the return URL can't create one.

---

## 4. Testing (no real money) — do this first

Your `.env` currently uses your **TEST** secret key, so the whole flow
runs for real except that no money moves.

1. Start the site, add something to the cart, click **Pay with Yoco**.
2. You'll land on Yoco's payment page. Enter a **test card**:
   you'll find the numbers under **Sales → Payment Gateway → Test card
   details** in your Yoco portal (the screen you screenshotted).
   Typically there's a "successful payment" card and a "declined" card —
   any future expiry date and any CVV work with them.
3. Pay. You'll be bounced back to your site with
   "Payment received — order placed ✓".
4. Open **Admin → Sales** — the order is there with Yoco's payment
   reference. Also try the declined card and cancelling, and watch the
   cart survive.

---

## 5. Going live — testing with a real card

When test mode behaves perfectly:

1. Open `.env`:
   - put a `#` in front of the `sk_test_...` line
   - remove the `#` in front of the `sk_live_...` line
2. Restart the server (`Ctrl+C`, then `npm start`). It must print
   `● LIVE keys — real money will move.`
3. Buy something cheap from your own store with your real card
   (Yoco's minimum is **R2**, so consider adding a temporary R5 "test"
   product in Admin first).
4. Check **Admin → Sales** for the order, and your **Yoco app/portal** —
   the transaction will appear there, and Yoco pays it out to your bank
   in 1–2 business days (minus their transaction fee, which applies to
   real charges).
5. Delete the temporary test product.

**Hosting:** localhost only works on your computer. For real customers,
host the project on a Node-friendly service (Render, Railway, Fly.io, a
VPS) and set `BASE_URL` in `.env` to your real address (e.g.
`https://fvckit.co.za`) so Yoco redirects customers back to the right
place. Use **https** in production — Yoco requires it for live traffic.

---

## 6. Security checklist before real customers

- [ ] **Regenerate your live keys in the Yoco portal** and update `.env`.
      Your current live pair appeared in screenshots, so treat it as
      compromised — regenerating takes seconds.
- [ ] Change `ADMIN_PIN` in `.env` to something only you know.
- [ ] Confirm `.env` is git-ignored (it is) if you push to GitHub.
- [ ] Site is served over **https** on your host.
- [ ] Optional next step: add a Yoco **webhook** so sales are recorded
      even if a customer closes the browser before being redirected
      back. The redirect+verify flow already in place covers normal
      cases; webhooks are the production-grade upgrade.
