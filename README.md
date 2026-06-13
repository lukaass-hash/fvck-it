# fvck it. — Cape Town clothing store (v3)

A Node.js + Express store. Two tabs: **Home** and **Catalogue**.
Payments via Yoco's Checkout API. **Orders are posted to Discord.**
No admin panel — products live in `products.json` in this repo.

---

## Folder

```
fvck-it/
├── products.json           ★ edit this to add / change products
├── server/server.js
├── public/
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
├── data/                   pending orders (kept on Railway volume)
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Day-to-day: adding or editing products

1. On GitHub, open `products.json`, click the pencil icon.
2. Add a new object to the list, e.g.

   ```json
   {
     "id": "p_cap_001",
     "name": "lowkey cap",
     "price": 349,
     "sizes": ["OS"],
     "img": "https://your-image-host.com/cap.jpg",
     "desc": "6-panel washed cotton. Adjustable strap.",
     "addedAt": "2026-07-01T12:00:00Z"
   }
   ```

3. **Important fields:**
   - `id` — anything unique, no spaces (e.g. `p_cap_001`)
   - `addedAt` — ISO date string. Pieces with a recent `addedAt`
     sort to the top of the **Latest in** section and wear a "New"
     badge for 14 days.

4. Commit the change. Railway redeploys in ~30 seconds. The new
   product is live.

To remove a product, just delete its block from the list and commit.

---

## How an order is processed

1. Customer clicks **Pay with Yoco** → server creates a Yoco checkout.
2. Customer pays on Yoco's hosted page (your site never sees their card).
3. Yoco sends them back. Server **verifies with Yoco's API** that the
   payment really completed.
4. Server posts the order details to your **Discord webhook**:
   - Total
   - Order ID
   - Items + sizes + quantities
   - Yoco payment reference
5. Customer sees "Payment received — order placed ✓".

Refreshing the success URL **does not** post a duplicate to Discord —
the order is removed from the pending list before notifying.

---

## Railway setup

In your service's **Variables** tab:

| Variable              | Value                                                       |
|-----------------------|-------------------------------------------------------------|
| `YOCO_SECRET_KEY`     | `sk_test_…` while testing, `sk_live_…` when live           |
| `DISCORD_WEBHOOK_URL` | The webhook URL from your Discord channel                  |
| `BASE_URL`            | Your domain (e.g. `www.seriouslybro.wtf`, no https needed) |

Don't set `PORT` — Railway provides it.

**Volume:** keep your existing volume mounted at `/app/data`. It now
only holds `pending.json` (a few short-lived records during checkout),
but keeping it on a volume means deploys don't break in-flight payments.

Startup log will print:
```
fvck it. is live on port 8080
  BASE_URL = https://www.seriouslybro.wtf
  YOCO_KEY = ○ TEST — no real money moves
  DISCORD  = ✓ configured
```

---

## Setting up the Discord webhook

1. In Discord, open the channel you want orders posted to.
2. Channel name → **Edit Channel → Integrations → Webhooks → New Webhook**.
3. Name it (e.g. "fvck it. orders"), pick an icon, click **Copy Webhook URL**.
4. Paste into Railway as `DISCORD_WEBHOOK_URL`.

The URL is a secret — anyone who has it can post in that channel.
If it ever leaks, delete the webhook in Discord and create a new one;
your code doesn't change, only the env var.

---

## Local development

```
npm install
cp .env.example .env       # fill in your values
npm start
```
Open http://localhost:8080.

---

## Going live with real money

1. Set `YOCO_SECRET_KEY` in Railway to your `sk_live_…` value.
2. Buy something cheap with your own card to confirm.
3. The startup log will show `● LIVE — real money moves`.

---

## Security checklist before real customers

- [ ] **Regenerate the Discord webhook** in Discord (the old one was
      shared in chat — anyone who saw it can post to your channel).
- [ ] **Regenerate the Yoco live keys** in the Yoco portal too.
- [ ] Site is served over `https`.
- [ ] Test a real payment end-to-end before announcing the store.
