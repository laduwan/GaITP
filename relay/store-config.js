/**
 * GAITP Bookstore — Product Catalog
 * --------------------------------------------------------------
 * Single source of truth for every sellable title. To add a new
 * book: drop its file(s) in private-books/<key>/, add an entry
 * below, add a matching card + button in bookstore.html with
 * data-book="<key>". Nothing else needs to change.
 *
 * `files` are served ONLY through the signed /download route —
 * they are never linked directly and never live in the public
 * static site repo, so they can't be found or shared by URL.
 *
 * Prices are in cents (Stripe convention).
 */

const path = require('path');

const PRIVATE_BOOKS_DIR = path.join(__dirname, 'private-books');

const PRODUCTS = {
  'married-to-the-mission': {
    title: 'Married to the Mission',
    subtitle: 'A Relationship Guide for the New Military Spouse',
    priceCents: 1499,
    format: 'Ebook (EPUB)',
    files: [
      { label: 'Married to the Mission — Ebook', filename: 'MarriedToTheMission.epub' },
    ],
  },
  'power-of-talk': {
    title: 'The Power of Talk',
    subtitle: 'Bridging the Gap, Book Two',
    priceCents: 1500,
    format: 'Ebook',
    files: [
      { label: 'The Power of Talk — Ebook', filename: 'ThePowerOfTalk.epub' },
    ],
  },
  'repair-work': {
    title: 'The Repair Work',
    subtitle: 'A Workbook for Accountability and Relationship Repair',
    priceCents: 1500,
    format: 'Workbook (PDF)',
    files: [
      { label: 'The Repair Work — For the Betrayed Partner', filename: 'TheRepairWork_Betrayed.pdf' },
      { label: 'The Repair Work — For the Unfaithful Partner', filename: 'TheRepairWork_Unfaithful.pdf' },
    ],
  },
  // Key and EPUB filename keep the old working title so existing
  // purchase links and the private-books/ folder stay valid.
  'bridging-two-worlds': {
    title: 'Understanding Intimacy',
    subtitle: 'Bridging the Gap, Book One',
    priceCents: 1500,
    format: 'Ebook',
    files: [
      { label: 'Understanding Intimacy — Ebook', filename: 'BridgingTwoWorlds.epub' },
    ],
  },
  'still-here': {
    title: 'Still Here',
    subtitle: 'Resilience and Presence Through Hard Seasons',
    priceCents: 1500,
    format: 'Ebook',
    files: [
      { label: 'Still Here — Ebook', filename: 'StillHere.epub' },
    ],
  },
  'couples-worksheets': {
    title: 'Couples Worksheets, Vols. I & II',
    subtitle: 'Grounded in Gottman, EFT, and ACT',
    priceCents: 1500,
    format: 'Worksheets (PDF)',
    files: [
      { label: 'Couples Worksheets — Vol. I', filename: 'CouplesWorksheets_Vol1.pdf' },
      { label: 'Couples Worksheets — Vol. II', filename: 'CouplesWorksheets_Vol2.pdf' },
    ],
  },
  'ncmhce-study-guide': {
    title: 'Complete NCMHCE Study Guide',
    subtitle: null,
    priceCents: 2999,
    format: 'Ebook (EPUB)',
    files: [
      { label: 'Complete NCMHCE Study Guide — Ebook', filename: 'NCMHCEStudyGuide.epub' },
    ],
  },
  'beyond-his-hers-and-them': {
    title: 'Beyond His, Hers, and Them',
    subtitle: 'The Blueprint for Queer Love',
    priceCents: 1500,
    format: 'Ebook (EPUB)',
    files: [
      { label: 'Beyond His, Hers, and Them — Ebook', filename: 'BeyondHisHersAndThem.epub' },
    ],
  },
};

function getProduct(key) {
  return PRODUCTS[key] || null;
}

function filePathFor(bookKey, filename) {
  return path.join(PRIVATE_BOOKS_DIR, bookKey, filename);
}

module.exports = { PRODUCTS, getProduct, filePathFor, PRIVATE_BOOKS_DIR };
