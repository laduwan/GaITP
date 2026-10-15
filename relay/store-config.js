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
  'repair-work-betrayed': {
    title: 'The Repair Work — For the Betrayed',
    subtitle: 'A Rupture Repair Protocol',
    priceCents: 900,
    format: 'Workbook (PDF)',
    files: [
      { label: 'The Repair Work — For the Betrayed Partner', filename: 'TheRepairWork_Betrayed.pdf' },
      { label: 'For the Betrayed — Complete Worksheet Set (included free)', filename: 'TheRepairWork_Betrayed_Worksheets.pdf' },
    ],
  },
  'repair-work-unfaithful': {
    title: 'The Repair Work — For the Unfaithful Partner',
    subtitle: 'A Rupture Repair Protocol',
    priceCents: 900,
    format: 'Workbook (PDF)',
    files: [
      { label: 'The Repair Work — For the Unfaithful Partner', filename: 'TheRepairWork_Unfaithful.pdf' },
      { label: 'For the Unfaithful Partner — Complete Worksheet Set (included free)', filename: 'TheRepairWork_Unfaithful_Worksheets.pdf' },
    ],
  },
  'repair-work-bundle': {
    title: 'The Repair Work — Complete Set',
    subtitle: 'For the Betrayed + For the Unfaithful Partner',
    priceCents: 1500,
    format: 'Workbooks (PDF)',
    files: [
      { label: 'The Repair Work — For the Betrayed Partner', filename: 'TheRepairWork_Betrayed.pdf', dir: 'repair-work-betrayed' },
      { label: 'For the Betrayed — Complete Worksheet Set (included free)', filename: 'TheRepairWork_Betrayed_Worksheets.pdf', dir: 'repair-work-betrayed' },
      { label: 'The Repair Work — For the Unfaithful Partner', filename: 'TheRepairWork_Unfaithful.pdf', dir: 'repair-work-unfaithful' },
      { label: 'For the Unfaithful Partner — Complete Worksheet Set (included free)', filename: 'TheRepairWork_Unfaithful_Worksheets.pdf', dir: 'repair-work-unfaithful' },
    ],
  },
  'understanding-intimacy': {
    title: 'Understanding Intimacy',
    subtitle: 'Bridging the Gap, Book One',
    priceCents: 1500,
    format: 'Ebook',
    files: [
      { label: 'Understanding Intimacy — Ebook', filename: 'UnderstandingIntimacy.epub' },
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
  'ncmhce-study-guide-2e': {
    title: 'The Complete NCMHCE Study Guide — 2nd Edition',
    subtitle: 'The Next-Move Method · For exams on or after July 1, 2027',
    priceCents: 3499,
    format: 'Ebook (PDF + EPUB)',
    files: [
      { label: 'NCMHCE Study Guide, 2nd Edition — PDF (1056 pp)', filename: 'NCMHCEStudyGuide_2E.pdf' },
      { label: 'NCMHCE Study Guide, 2nd Edition — EPUB', filename: 'NCMHCEStudyGuide_2E.epub' },
    ],
  },
  'nce-ownership-method-2e': {
    title: 'The NCE Ownership Method — 2nd Edition',
    subtitle: 'A Complete Study Guide for the National Counselor Examination · For exams on or after July 1, 2027',
    priceCents: 3499,
    format: 'Ebook (PDF + EPUB)',
    files: [
      { label: 'NCE Ownership Method, 2nd Edition — PDF (1078 pp)', filename: 'NCEOwnershipMethod_2E.pdf' },
      { label: 'NCE Ownership Method, 2nd Edition — EPUB', filename: 'NCEOwnershipMethod_2E.epub' },
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

// Resolve a product file on disk. A file may carry an optional `dir` (used by
// bundles whose files live in another product's folder); otherwise the
// product key is the folder name.
function filePathFor(bookKey, file) {
  return path.join(PRIVATE_BOOKS_DIR, file.dir || bookKey, file.filename);
}

module.exports = { PRODUCTS, getProduct, filePathFor, PRIVATE_BOOKS_DIR };
