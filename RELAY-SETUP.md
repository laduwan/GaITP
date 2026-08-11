# Relay — setup

The website pages are static and deploy as-is. Four things need one small backend so they can
actually work: the **Send a Message** form (`reach.html`), the site-wide suggestion box, the
**worksheets delivery** form (`worksheets.html`), and the **bookstore checkout** (`bookstore.html`).
Here's the whole setup.

## What it does
- A visitor submits an anonymous message on `reach.html`.
- The relay sends you the FULL message by **email (Resend)** and **text (Twilio)**.
- If the message contains crisis words, YOUR copy is marked "⚠ FLAGGED" so you read it first.
- The visitor always sees the same confirmation, flagged or not. The tool decides nothing —
  you make every clinical and scheduling call.
- A visitor requesting free worksheets on `worksheets.html` gets an email with their download
  links; you get a one-line notice so you can see signups happening.
- A visitor buying a book on `bookstore.html` pays through **Stripe Checkout**; once Stripe
  confirms payment, they land on `thank-you.html` with live download links and get the same
  links by email. See "Bookstore checkout" below.
- Nothing is stored by the relay. (Your email/SMS/Stripe providers keep their own logs.)

## Deploy the relay (Render — Web Service, Node)
The relay code lives in `/relay` in this same repo, with its own `package.json` so it can be
deployed as a **separate Render service** from the static site — the static site never runs
`npm install`, only the relay does.

1. Create a new **Web Service** on Render, pointing at this repo (`laduwan/GaITP`).
   - **Root Directory:** `relay`
   - **Build command:** `npm install`
   - **Start command:** `npm start`
2. Add these environment variables in Render:
   - `RESEND_API_KEY` — from resend.com
   - `FROM_EMAIL` — a verified sender (e.g. relay@gaintegratedperspectives.com)
   - `TO_EMAIL` — where you want messages (your practice inbox)
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from twilio.com
   - `TWILIO_FROM` — your Twilio number (e.g. +1XXXXXXXXXX)
   - `TO_SMS` — your cell (e.g. +16786644003)
   - `ALLOWED_ORIGIN` — https://gaintegratedperspectives.com
   - `SITE_ORIGIN` — https://gaintegratedperspectives.com (used to build worksheet download links)
   - `SMS_ENABLED` — `true` or `false` — the DEFAULT for text alerts (see toggle below)
   - `TOGGLE_SECRET` — a passcode you choose, used to flip texts on/off
   - `DND_ENABLED` — `true`/`false` — daily Do Not Disturb default (default `false`)
   - `DND_START` — quiet-hours start, `HH:MM` 24h (e.g. `21:00`)
   - `DND_END` — quiet-hours end, `HH:MM` 24h (e.g. `08:00`) — overnight is fine
   - `DND_TZ` — your timezone (default `America/New_York`)
   - `STRIPE_SECRET_KEY` — `sk_live_...` (or `sk_test_...` while testing), from a **Stripe account
     of its own** — keep it separate from any other Stripe account you use
   - `STRIPE_WEBHOOK_SECRET` — `whsec_...`, from the Stripe webhook you configure below
   - `DOWNLOAD_SIGNING_SECRET` — any long random string you choose; signs the download links
   - `RELAY_ORIGIN` — the relay's own public URL (e.g. `https://gaitp.onrender.com`) — used to
     build download links, since the relay is a different host from the static site
3. Render gives you a URL like `https://gaitp-relay.onrender.com`.

## Point the site pages at the relay
Three files reference `RELAY_BASE` and currently have it set to the placeholder
`"REPLACE_WITH_YOUR_RELAY_ENDPOINT"`: **every page** (for the suggestion box), plus
`reach.html` and `worksheets.html` specifically. In each file, find:
```js
var RELAY_BASE = "REPLACE_WITH_YOUR_RELAY_ENDPOINT";
```
Change it to your actual relay URL, e.g.:
```js
var RELAY_BASE = "https://gaitp-relay.onrender.com";
```
Re-upload the changed files. Done — the suggestion box, message form, and worksheets form all
use the same `RELAY_BASE` value, just different endpoints (`/suggestion`, `/relay`,
`/worksheets-signup`).

## Worksheet delivery for new titles
`relay-server.js` has a `WORKSHEET_BOOKS` object mapping a book key (like
`married-to-the-mission`) to its title and PDF file paths. To add a new title:
1. Drop its PDFs in `/downloads/<book-key>/` in this repo.
2. Add an entry to `WORKSHEET_BOOKS` in `relay/relay-server.js` with the matching paths.
3. Point a new page's form at `/worksheets-signup` with `book: '<book-key>'` in the request body
   (copy `worksheets.html` as a starting point).
No database, no admin panel — just a lookup table in the relay code.

## Bookstore checkout
`bookstore.html` buy buttons call the relay, which uses Stripe Checkout for payment and a
signed, time-limited link for delivery. There's no order database — Stripe's dashboard is the
system of record for payments (receipts, refunds, history); the relay only mints a download link
at the moment it verifies a payment actually succeeded.

1. **Create a Stripe account** (or use the dedicated one set up for this store) and grab its API
   keys from the Stripe dashboard.
2. **Add a webhook** in Stripe pointing at `https://YOUR-RELAY/webhook/stripe`, listening for the
   `checkout.session.completed` event. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Upload the actual book files** to `relay/private-books/<book-key>/` in this repo (or however
   you deploy the relay's filesystem) — filenames must match what's listed in
   `relay/store-config.js`. These files are served only through the signed `/download` route;
   they're never linked directly and never referenced from the public static site.
4. **To add a new title:** add an entry to `PRODUCTS` in `relay/store-config.js` (price, format,
   file names), drop the file(s) in `relay/private-books/<book-key>/`, and add a matching card +
   button in `bookstore.html` with `data-book="<book-key>"`. Nothing else needs to change.
5. When a purchase completes, the buyer is redirected to `thank-you.html`, which polls the relay
   for live download links, and also gets those same links by email (Resend) — you get a
   one-line sale notice too.
6. Download links expire after 7 days. If one expires, the buyer can reply to their purchase
   email for a fresh one — no self-serve "resend" flow exists yet.

## Text alerts on/off toggle
Email always sends. Texts (SMS) are the interruptible alert you can silence anytime
(off-hours, in session, vacation) without touching email.

- **Set the default:** env var `SMS_ENABLED=true` (or `false`). This is what texts revert
  to whenever the relay restarts or redeploys — set it to your safe baseline.
- **Flip it anytime from your phone:** open `sms-toggle.html` (a private page — deploy it
  but DON'T link it in the site nav; just bookmark it). Enter your relay URL and your
  `TOGGLE_SECRET`, then tap **Texts ON** / **Texts OFF**. It shows the current status.
- **Or flip by URL** (bookmark these):
  - On:  `https://YOUR-RELAY/sms-toggle?key=YOUR_SECRET&state=on`
  - Off: `https://YOUR-RELAY/sms-toggle?key=YOUR_SECRET&state=off`
  - Check: `https://YOUR-RELAY/sms-status`

Note: because the relay stores nothing, a restart resets texts to the `SMS_ENABLED` default.
If you want the toggle to survive restarts permanently, that needs a tiny persistent store
(e.g. your MongoDB) — say the word and I'll wire it in.

## Daily Do Not Disturb (quiet hours)
Set a recurring nightly window when texts pause automatically and resume in the morning.
Email keeps sending through the quiet window.

- **Set it once (recommended):** env vars `DND_ENABLED=true`, `DND_START=21:00`,
  `DND_END=08:00`, `DND_TZ=America/New_York`. That's it — every night 9pm–8am, texts pause.
- **Adjust anytime from your phone:** on `sms-toggle.html`, use the Do Not Disturb section to
  set the "quiet from / until" times, tap **Save quiet hours**, and flip **DND ON / OFF**. The
  status shows "Quiet now (until 08:00)" when you're inside the window.
- **Overnight windows work** (start later than end). End time is exclusive (08:00 = texts resume
  at 8:00 sharp).

Precedence: a text sends only if **texts are ON** *and* **not currently in the DND window**.
Email always sends.

## Notes on safety (please keep intact)
- The crisis banner and 988/911 info appear to EVERY visitor, flagged or not. That's the real
  safety net; the keyword flag is only a "read this first" highlight for you and WILL miss things
  (e.g. "I've lost all interest" contains no keyword). You read all messages anyway.
- Before going live, have your malpractice carrier glance at the flow — anything adjacent to crisis
  on a licensed practice's site is worth a written OK.
