# fvck it. — Cape Town clothing store (v2)

A Node.js + Express store with two designs (Home / Catalogue), an admin
back office, and Yoco card payments via the official **Checkout API**.

## What changed in v2

- **Auto-seed.** On boot, if the data folder is empty (e.g. a freshly
  mounted Railway volume), the server writes a starter `products.json`
  so the store never appears empty.
- **BASE_URL normalisation.** The server now accepts `BASE_URL` with
  or without `https://`. This was the bug breaking Yoco — a value like
  `www.yourdomain.co.za` got passed to Yoco as-is, producing invalid
  redirect URLs.
- **Port 8080** is the default.
- **Redesign.** Snow-on-carbon editorial layout, Home page with a
  "Latest in" section, separate Catalogue tab, story section, Cape
  Town tone throughout. No more "two tones / B&W" messaging.
- **Sort & "New" badges.** Newly added pieces sort to the top of Home
  and wear a small "New" badge for 14 days.

## Folder

```
fvck-it/
├── public/
│   ├── index.html          single-page UI with tab routing
│   ├── css/styles.css
│   └── js/app.js
├── server/server.js
├── data/                   auto-seeded on first boot
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Local development

```
npm install
cp .env.example .env        # then put your real values in .env
npm start
```
Open http://localhost:8080.

## Railway (production)

Push this repo to GitHub, then in Railway:

- **Variables tab** — set:
  - `YOCO_SECRET_KEY` — your `sk_test_…` or `sk_live_…` key
  - `ADMIN_PIN` — your admin PIN
  - `BASE_URL` — your public address. With or without `https://`
    (the server adds it). e.g. `www.seriouslybro.wtf`
    Don't set `PORT` — Railway provides it.
- **Volume** — mount it at `/app/data` so products and sales survive
  redeploys. (The server auto-creates the files inside it.)

Going live: change `YOCO_SECRET_KEY` from your `sk_test_…` value to
your `sk_live_…` value and redeploy. The startup log prints either
`○ TEST — no real money moves` or `● LIVE — real money moves` so
you always know which mode you're in.

## Yoco test cards

While `YOCO_SECRET_KEY` starts with `sk_test_`, payments run end-to-end
but no real money moves. Use the test card numbers from your Yoco
portal under **Sales → Payment Gateway → Test card details**. Any
future expiry date and any CVV work.

## Security checklist before real customers

- [ ] Regenerate your live Yoco keys in the portal and update Railway.
- [ ] Change `ADMIN_PIN` from the default.
- [ ] Site is served over `https`.
- [ ] Buy something cheap with a real card to confirm the live flow.
