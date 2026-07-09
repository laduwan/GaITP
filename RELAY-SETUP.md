# "Send a Message" relay — setup

The website pages are static and deploy as-is. The **Send a Message** form (`reach.html`)
needs one small backend so it can email + text you. Here's the whole setup.

## What it does
- A visitor submits an anonymous message on `reach.html`.
- The relay sends you the FULL message by **email (Resend)** and **text (Twilio)**.
- If the message contains crisis words, YOUR copy is marked "⚠ FLAGGED" so you read it first.
- The visitor always sees the same confirmation, flagged or not. The tool decides nothing —
  you make every clinical and scheduling call.
- Nothing is stored by the relay. (Your email/SMS providers keep their own logs.)

## Deploy the relay (Render — Web Service, Node)
1. Put `relay-server.js` in a small repo (or a `/relay` folder) with a `package.json`:
   ```json
   {
     "name": "gaitp-relay",
     "version": "1.0.0",
     "main": "relay-server.js",
     "scripts": { "start": "node relay-server.js" },
     "dependencies": {
       "express": "^4.19.2",
       "cors": "^2.8.5",
       "resend": "^3.2.0",
       "twilio": "^5.0.0"
     }
   }
   ```
2. Create a new **Web Service** on Render pointing at that repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add these environment variables in Render:
   - `RESEND_API_KEY` — from resend.com
   - `FROM_EMAIL` — a verified sender (e.g. relay@gaintegratedperspectives.com)
   - `TO_EMAIL` — where you want messages (your practice inbox)
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from twilio.com
   - `TWILIO_FROM` — your Twilio number (e.g. +1XXXXXXXXXX)
   - `TO_SMS` — your cell (e.g. +16786644003)
   - `ALLOWED_ORIGIN` — https://gaintegratedperspectives.com
   - `SMS_ENABLED` — `true` or `false` — the DEFAULT for text alerts (see toggle below)
   - `TOGGLE_SECRET` — a passcode you choose, used to flip texts on/off
   - `DND_ENABLED` — `true`/`false` — daily Do Not Disturb default (default `false`)
   - `DND_START` — quiet-hours start, `HH:MM` 24h (e.g. `21:00`)
   - `DND_END` — quiet-hours end, `HH:MM` 24h (e.g. `08:00`) — overnight is fine
   - `DND_TZ` — your timezone (default `America/New_York`)
4. Render gives you a URL like `https://gaitp-relay.onrender.com`.
   Your endpoint is that URL + `/relay`.

## Point the form at the relay
In `reach.html`, find:
```js
var RELAY_ENDPOINT = "REPLACE_WITH_YOUR_RELAY_ENDPOINT";
```
Change it to your endpoint, e.g.:
```js
var RELAY_ENDPOINT = "https://gaitp-relay.onrender.com/relay";
```
Re-upload `reach.html`. Done.

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
