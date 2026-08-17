/**
 * GAITP Relay Endpoint
 * --------------------------------------------------------------
 * Receives an anonymous message from reach.html and relays the
 * FULL text to the practice by email (Resend) and text (Twilio).
 *
 * Design guarantees (keep these intact):
 *  - It DECIDES NOTHING clinical. It relays every message to Ke.
 *  - The crisis-word flag only marks the PRACTICE's copy so Ke can
 *    triage the loud ones first. It never changes what the sender sees.
 *  - The sender's confirmation is handled entirely on the front end
 *    and is identical for everyone (flagged or not).
 *  - No database. Nothing is stored here. It receives -> relays -> forgets.
 *    (Your email/SMS providers will retain the message in their logs;
 *     choose providers/settings accordingly.)
 *
 * Deploy: as a small Web Service on Render (Node).
 * Env vars required:
 *   RESEND_API_KEY        - from resend.com
 *   FROM_EMAIL            - a verified sender, e.g. relay@gaintegratedperspectives.com
 *   TO_EMAIL              - where messages should land (your practice inbox)
 *   TWILIO_ACCOUNT_SID    - from twilio.com
 *   TWILIO_AUTH_TOKEN     - from twilio.com
 *   TWILIO_FROM           - your Twilio number, e.g. +1XXXXXXXXXX
 *   TO_SMS                - your cell, e.g. +16786644003
 *   ALLOWED_ORIGIN        - your site origin, e.g. https://gaintegratedperspectives.com
 *
 * Install: npm i express cors resend twilio
 */

const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const twilio = require('twilio');
const crypto = require('crypto');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getProduct, filePathFor } = require('./store-config');

const app = express();

// NOTE: the Stripe webhook route needs the RAW body for signature
// verification, so it's registered further down with its own raw parser
// BEFORE the global express.json() middleware would otherwise consume it.
// Express matches routes in registration order, so this ordering matters.
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '32kb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));

const resend = new Resend(process.env.RESEND_API_KEY);
const sms = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ---- SMS on/off toggle -------------------------------------------------
// Email ALWAYS sends (reliable record). SMS is the interruptible alert.
// Default comes from env SMS_ENABLED ("true"/"false"); you can flip it at
// runtime from the toggle page without a redeploy. NOTE: on a restart/redeploy
// the value resets to the SMS_ENABLED default, so set that to your safe baseline.
let smsEnabled = String(process.env.SMS_ENABLED || 'true').toLowerCase() === 'true';
const TOGGLE_SECRET = process.env.TOGGLE_SECRET || '';

// ---- Daily Do Not Disturb (quiet hours) --------------------------------
// A recurring window each day during which texts are suppressed automatically.
// Email still sends. Set once via env; adjustable at runtime from the toggle page.
//   DND_ENABLED  "true"/"false"   (default false)
//   DND_START    "HH:MM" 24h      (e.g. "21:00")
//   DND_END      "HH:MM" 24h      (e.g. "08:00")  — overnight windows are fine
//   DND_TZ       IANA tz          (default "America/New_York")
let dndEnabled = String(process.env.DND_ENABLED || 'false').toLowerCase() === 'true';
let dndStart = process.env.DND_START || '21:00';
let dndEnd = process.env.DND_END || '08:00';
let dndTz = process.env.DND_TZ || 'America/New_York';

function nowMinutesInTz(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10) % 24;
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  return h * 60 + m;
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(x => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}
function inQuietHours() {
  if (!dndEnabled) return false;
  const cur = nowMinutesInTz(dndTz);
  const s = toMinutes(dndStart), e = toMinutes(dndEnd);
  if (s === e) return false;                 // zero-length window
  return (s < e) ? (cur >= s && cur < e)     // same-day window
                 : (cur >= s || cur < e);    // overnight window
}
// ------------------------------------------------------------------------

function checkSecret(req) {
  const provided = (req.query.key || req.body.key || '').toString();
  return TOGGLE_SECRET && provided === TOGGLE_SECRET;
}

// Read current state (no secret needed — reveals nothing sensitive).
app.get('/sms-status', (_req, res) => res.json({
  smsEnabled,
  dnd: { enabled: dndEnabled, start: dndStart, end: dndEnd, tz: dndTz, activeNow: inQuietHours() }
}));

// Flip texts: /sms-toggle?key=SECRET&state=on|off  (GET or POST)
app.all('/sms-toggle', (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const state = (req.query.state || req.body.state || '').toString().toLowerCase();
  if (state === 'on') smsEnabled = true;
  else if (state === 'off') smsEnabled = false;
  else return res.status(400).json({ ok: false, error: 'state must be on or off' });
  return res.json({ ok: true, smsEnabled });
});

// Turn DND on/off: /dnd-toggle?key=SECRET&state=on|off
app.all('/dnd-toggle', (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const state = (req.query.state || req.body.state || '').toString().toLowerCase();
  if (state === 'on') dndEnabled = true;
  else if (state === 'off') dndEnabled = false;
  else return res.status(400).json({ ok: false, error: 'state must be on or off' });
  return res.json({ ok: true, dnd: { enabled: dndEnabled, start: dndStart, end: dndEnd, tz: dndTz, activeNow: inQuietHours() } });
});

// Set the quiet-hours window: /dnd-window?key=SECRET&start=21:00&end=08:00
app.all('/dnd-window', (req, res) => {
  if (!checkSecret(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const start = (req.query.start || req.body.start || '').toString();
  const end = (req.query.end || req.body.end || '').toString();
  const valid = s => /^\d{1,2}:\d{2}$/.test(s);
  if (!valid(start) || !valid(end)) return res.status(400).json({ ok: false, error: 'use HH:MM' });
  dndStart = start; dndEnd = end;
  return res.json({ ok: true, dnd: { enabled: dndEnabled, start: dndStart, end: dndEnd, tz: dndTz, activeNow: inQuietHours() } });
});
// ------------------------------------------------------------------------

// Authoritative crisis-word list (server-side is the source of truth).
const CRISIS_WORDS = [
  'suicide','suicidal','kill myself','end my life','end it all',
  'hurt myself','harm myself','self harm','self-harm','cut myself',
  'no reason to live',"don't want to be here",'dont want to be here',
  'want to die','better off dead','kill him','kill her','kill them','hurt someone'
];

function computeFlag(text) {
  const t = (text || '').toLowerCase();
  return CRISIS_WORDS.some(w => t.includes(w));
}

app.post('/relay', async (req, res) => {
  try {
    const message = (req.body.message || '').toString().slice(0, 5000).trim();
    const contact = (req.body.contact || '').toString().slice(0, 300).trim();
    if (!message) return res.status(400).json({ ok: false, error: 'empty' });

    // Server recomputes the flag — do not trust the client value.
    const flagged = computeFlag(message + ' ' + contact);
    const banner = flagged ? '⚠ FLAGGED: crisis language present — review first\n\n' : '';
    const subject = (flagged ? '⚠ FLAGGED — ' : '') + 'New website message';

    const bodyText =
      banner +
      'A message was submitted through the website.\n\n' +
      '----- MESSAGE -----\n' + message + '\n\n' +
      '----- HOW TO FOLLOW UP -----\n' + (contact || '(none provided)') + '\n\n' +
      'Submitted: ' + new Date().toLocaleString() + '\n' +
      '(Anonymous. This relay stores nothing. You make all clinical decisions.)';

    // Fire email + SMS in parallel; don't fail the user if one provider hiccups.
    const tasks = [];

    tasks.push(
      resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: process.env.TO_EMAIL,
        subject,
        text: bodyText
      }).catch(e => console.error('email error', e))
    );

    // SMS has tight length limits — send a short alert + start of message.
    // Sends only when texts are ON *and* not inside the daily Do Not Disturb
    // window. Email already sent above regardless.
    if (smsEnabled && !inQuietHours()) {
      const smsText =
        (flagged ? '⚠ FLAGGED website msg. ' : 'New website msg. ') +
        'Preview: ' + message.slice(0, 240) +
        (contact ? ' | Follow up: ' + contact.slice(0, 60) : '');
      tasks.push(
        sms.messages.create({
          body: smsText.slice(0, 320),
          from: process.env.TWILIO_FROM,
          to: process.env.TO_SMS
        }).catch(e => console.error('sms error', e))
      );
    }

    await Promise.all(tasks);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    // Still return ok:true so the sender always sees the same confirmation.
    return res.json({ ok: true });
  }
});

// ---- Suggestion box -----------------------------------------------------
// Separate, low-stakes feedback channel ("I found a bug" / "you should add
// X") from any page on the site. Reuses the same Resend setup as /relay.
// Does NOT touch /relay's crisis-flagging logic or the anonymous message form.

// In-memory rate limiter — 10 submissions / IP / day (resets on deploy,
// which is fine for this volume; swap to Redis if it ever needs to scale)
const suggestionRateLimit = new Map();
function checkSuggestionRateLimit(ip) {
  const key = `${ip}:${new Date().toISOString().split('T')[0]}`;
  if (suggestionRateLimit.size > 10000) suggestionRateLimit.clear();
  const count = suggestionRateLimit.get(key) || 0;
  if (count >= 10) return false;
  suggestionRateLimit.set(key, count + 1);
  return true;
}

app.post('/suggestion', async (req, res) => {
  try {
    if (!checkSuggestionRateLimit(req.ip)) {
      return res.status(429).json({ error: 'Too many submissions today. Please try again tomorrow.' });
    }

    const { message, category, email, pageUrl } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    const cleanMessage = String(message).trim().slice(0, 4000);
    const cleanCategory = ['bug', 'feature-request', 'content', 'billing', 'other'].includes(category)
      ? category
      : 'other';

    const text =
      `New suggestion submitted — GA Integrated Therapeutic Perspectives\n\n` +
      `Category: ${cleanCategory}\n` +
      (email ? `Email: ${String(email).trim().slice(0, 200)}\n` : '') +
      `Page: ${pageUrl || req.headers.referer || 'n/a'}\n\n` +
      `Message:\n${cleanMessage}\n`;

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: process.env.TO_EMAIL,
      subject: `[Suggestion] Website — ${cleanCategory}`,
      text,
    });

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[relay] suggestion send failed:', err.message);
    // Still tell the visitor it went through — never block on best-effort email delivery
    res.status(201).json({ success: true });
  }
});
// ------------------------------------------------------------------------

// ---- Worksheet delivery --------------------------------------------------
// Stateless like everything else here: receives an email, sends download
// links back to that address via Resend, forgets it. No list is built,
// no database is touched. Add new entries to WORKSHEET_BOOKS to support
// additional titles without changing the route logic.

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://gaintegratedperspectives.com';

const WORKSHEET_BOOKS = {
  'married-to-the-mission': {
    title: 'Married to the Mission',
    files: [
      { label: 'The Printable Worksheets (all 9, ready to print)', path: '/downloads/married-to-the-mission/MarriedToTheMission_PrintableWorksheets.pdf' },
      { label: 'The Eight Conversations Checklist', path: '/downloads/married-to-the-mission/MarriedToTheMission_EightConversationsChecklist.pdf' },
    ],
  },
  'repair-work-unfaithful-claim': {
    title: 'The Repair Work: For the Unfaithful Partner',
    // Printed in the book's back matter — proves the claimant actually owns
    // a copy, since this claim path exists for buyers who purchased through
    // Amazon/Gumroad and have no Stripe record on this site.
    accessCode: 'UNFAITHFUL2026',
    files: [
      { label: 'The Complete Worksheet Set (printable)', path: '/downloads/repair-work-unfaithful/TheRepairWork_Unfaithful_Worksheets.pdf' },
    ],
  },
};

// Same lightweight in-memory rate limiter pattern as /suggestion.
const worksheetsRateLimit = new Map();
function checkWorksheetsRateLimit(ip) {
  const key = `${ip}:${new Date().toISOString().split('T')[0]}`;
  if (worksheetsRateLimit.size > 10000) worksheetsRateLimit.clear();
  const count = worksheetsRateLimit.get(key) || 0;
  if (count >= 10) return false;
  worksheetsRateLimit.set(key, count + 1);
  return true;
}

app.post('/worksheets-signup', async (req, res) => {
  try {
    if (!checkWorksheetsRateLimit(req.ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests today. Please try again tomorrow.' });
    }

    const email = (req.body.email || '').toString().trim().slice(0, 200);
    const bookKey = (req.body.book || '').toString().trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({ ok: false, error: 'A valid email is required.' });
    }

    const book = WORKSHEET_BOOKS[bookKey];
    if (!book) {
      return res.status(400).json({ ok: false, error: 'Unknown book.' });
    }

    if (book.accessCode) {
      const submittedCode = (req.body.code || '').toString().trim().toUpperCase();
      if (submittedCode !== book.accessCode) {
        return res.status(400).json({ ok: false, error: 'That code doesn\'t match. Check the back matter of your book and try again.' });
      }
    }

    const linksHtml = book.files
      .map(f => `<li><a href="${SITE_ORIGIN}${f.path}">${f.label}</a></li>`)
      .join('');
    const linksText = book.files
      .map(f => `- ${f.label}: ${SITE_ORIGIN}${f.path}`)
      .join('\n');

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: `Your free worksheets — ${book.title}`,
      html: `<p>Thank you for picking up <strong>${book.title}</strong>. Here are your free printable worksheets:</p><ul>${linksHtml}</ul><p>Print as many blank copies as you need. If you have any trouble with the links, just reply to this email.</p>`,
      text: `Thank you for picking up ${book.title}. Here are your free printable worksheets:\n\n${linksText}\n\nPrint as many blank copies as you need. If you have any trouble with the links, just reply to this email.`,
    });

    // Best-effort notice to the practice inbox so Ke can see signups happening.
    // Failure here never blocks the visitor's email from having already sent.
    resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: process.env.TO_EMAIL,
      subject: `Worksheet request — ${book.title}`,
      text: `${email} requested worksheets for ${book.title}.`,
    }).catch(e => console.error('worksheets notice email error', e));

    return res.json({ ok: true });
  } catch (err) {
    console.error('worksheets-signup error', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' });
  }
});
// ------------------------------------------------------------------------



// ---- Bookstore / ecommerce ----------------------------------------------
// Stripe Checkout for payment, signed time-limited links for delivery.
// No order database — Stripe itself is the system of record for payments
// (dashboard has full history/receipts/refunds). We only mint a signed
// download token at the moment of a *verified* successful payment.
//
// Env vars required:
//   STRIPE_SECRET_KEY       - sk_live_... or sk_test_... (separate Stripe
//                              account from CounselorReady, per Ke's call)
//   STRIPE_WEBHOOK_SECRET   - whsec_... from the Stripe webhook config
//   DOWNLOAD_SIGNING_SECRET - any long random string, used to sign links
//   SITE_ORIGIN             - already defined above for worksheets

const DOWNLOAD_SIGNING_SECRET = process.env.DOWNLOAD_SIGNING_SECRET || '';
const DOWNLOAD_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, multi-use within window

// Relay itself serves /download (it's a different host than the static
// site), so build links against the relay's own public URL, not SITE_ORIGIN
// (which is the static site, used below for Checkout's success/cancel URLs).
// SITE_ORIGIN itself is already declared above, in the worksheet-delivery section.
const RELAY_ORIGIN = process.env.RELAY_ORIGIN || 'https://gaitp.onrender.com';

function signDownload(bookKey, filename, expiresAt) {
  const payload = `${bookKey}:${filename}:${expiresAt}`;
  return crypto.createHmac('sha256', DOWNLOAD_SIGNING_SECRET).update(payload).digest('hex');
}

function buildDownloadLink(bookKey, filename) {
  const expiresAt = Date.now() + DOWNLOAD_LINK_TTL_MS;
  const sig = signDownload(bookKey, filename, expiresAt);
  const params = new URLSearchParams({ book: bookKey, file: filename, exp: String(expiresAt), sig });
  return `${RELAY_ORIGIN}/download?${params.toString()}`;
}

// Create a Checkout Session for one book. Front end POSTs { book } and
// redirects the browser to the returned url.
app.post('/create-checkout-session', async (req, res) => {
  try {
    const bookKey = (req.body.book || '').toString().trim();
    const product = getProduct(bookKey);
    if (!product) return res.status(400).json({ ok: false, error: 'Unknown book.' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: product.title + (product.subtitle ? ' — ' + product.subtitle : ''),
            description: product.format,
          },
          unit_amount: product.priceCents,
        },
        quantity: 1,
      }],
      metadata: { book: bookKey },
      success_url: `${SITE_ORIGIN}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_ORIGIN}/bookstore.html`,
    });

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return res.status(500).json({ ok: false, error: 'Could not start checkout. Please try again.' });
  }
});

// Stripe calls this after a successful payment (registered above, before
// express.json(), so it gets the raw body needed for signature checks).
async function handleStripeWebhook(req, res) {
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookKey = session.metadata && session.metadata.book;
    const customerEmail = session.customer_details && session.customer_details.email;
    const product = getProduct(bookKey);

    if (product && customerEmail) {
      try {
        const links = product.files.map(f => ({
          label: f.label,
          url: buildDownloadLink(bookKey, f.filename),
        }));

        const linksHtml = links.map(l => `<li><a href="${l.url}">${l.label}</a></li>`).join('');
        const linksText = links.map(l => `- ${l.label}: ${l.url}`).join('\n');

        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: customerEmail,
          subject: `Your purchase — ${product.title}`,
          html: `<p>Thank you for purchasing <strong>${product.title}</strong>. Your download link${links.length > 1 ? 's are' : ' is'} below (active for 7 days):</p><ul>${linksHtml}</ul><p>If you have any trouble, just reply to this email.</p>`,
          text: `Thank you for purchasing ${product.title}. Your download link(s) (active for 7 days):\n\n${linksText}\n\nIf you have any trouble, just reply to this email.`,
        });

        resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: process.env.TO_EMAIL,
          subject: `Sale — ${product.title}`,
          text: `${customerEmail} purchased ${product.title} for $${(session.amount_total / 100).toFixed(2)}.`,
        }).catch(e => console.error('sale notice email error', e));
      } catch (err) {
        console.error('post-payment email error', err);
        // Payment already succeeded regardless — Stripe dashboard has the
        // record. The thank-you page's live download button is the backstop
        // if this email fails.
      }
    }
  }

  res.json({ received: true });
}

// Thank-you page polls this with the Stripe session_id from the redirect
// to confirm payment status and get the book title/download links WITHOUT
// needing any local order storage — Stripe is asked directly, live.
app.get('/session-status', async (req, res) => {
  try {
    const sessionId = (req.query.session_id || '').toString();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'Missing session_id.' });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return res.json({ ok: true, paid: false });
    }

    const bookKey = session.metadata && session.metadata.book;
    const product = getProduct(bookKey);
    if (!product) return res.status(400).json({ ok: false, error: 'Unknown book on this session.' });

    const links = product.files.map(f => ({
      label: f.label,
      url: buildDownloadLink(bookKey, f.filename),
    }));

    return res.json({
      ok: true,
      paid: true,
      title: product.title,
      email: session.customer_details && session.customer_details.email,
      links,
    });
  } catch (err) {
    console.error('session-status error', err);
    return res.status(500).json({ ok: false, error: 'Could not verify payment.' });
  }
});

// The actual file transfer. Only reachable with a valid, unexpired
// signature — never linked publicly, never listed, never in the static repo.
app.get('/download', (req, res) => {
  try {
    const bookKey = (req.query.book || '').toString();
    const filename = (req.query.file || '').toString();
    const exp = parseInt(req.query.exp, 10);
    const sig = (req.query.sig || '').toString();

    if (!bookKey || !filename || !exp || !sig) {
      return res.status(400).send('Bad request.');
    }
    if (Date.now() > exp) {
      return res.status(410).send('This download link has expired. Reply to your purchase email and we\'ll send a fresh one.');
    }

    const expected = signDownload(bookKey, filename, exp);
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const validSig = sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
    if (!validSig) return res.status(403).send('Invalid download link.');

    const product = getProduct(bookKey);
    if (!product || !product.files.some(f => f.filename === filename)) {
      return res.status(404).send('File not found.');
    }

    const filePath = filePathFor(bookKey, filename);
    if (!fs.existsSync(filePath)) {
      console.error('Paid file missing on disk:', filePath);
      return res.status(404).send('This file isn\'t available yet. Reply to your purchase email and we\'ll sort it out.');
    }

    return res.download(filePath, filename);
  } catch (err) {
    console.error('download route error', err);
    return res.status(500).send('Something went wrong.');
  }
});
// ------------------------------------------------------------------------


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Relay listening on ' + PORT));
