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

const app = express();
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



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Relay listening on ' + PORT));
