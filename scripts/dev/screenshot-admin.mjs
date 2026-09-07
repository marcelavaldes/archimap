/**
 * Screenshot the admin panel without credentials.
 *
 * Sibling to screenshot-map.mjs, and it exists for a sharper version of the
 * same reason. The map at least rendered a shell you could look at; the admin
 * panel needs ADMIN_PASSWORD and ADMIN_SESSION_SECRET *before* Supabase even
 * comes up, so on a fresh clone it was not a broken screen — it was no screen.
 * Nothing about it could be seen, which is how it accumulated defects nobody
 * reported.
 *
 *   bun run fixture:build                 # once — downloads real geometry
 *   echo "ARCHIMAP_FIXTURE=1" > .env.local
 *   bun run dev
 *   node scripts/dev/screenshot-admin.mjs --base http://localhost:3000
 *
 * Flags:
 *   --base <url>     default http://localhost:3000
 *   --out <dir>      default ./.screenshots (gitignored)
 *   --password <pw>  default "dev" (FIXTURE_ADMIN_PASSWORD)
 *
 * On waiting: these are client components that fetch on mount, so every screen
 * has a "Chargement..." state that photographs as an empty pane. Each shot
 * waits for a selector that only exists once the data has landed, rather than
 * sleeping — a slow machine then produces a late screenshot instead of a
 * misleading one.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Playwright is not a dependency of this repo — find an already-installed copy. */
async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    'playwright',
    `${process.env.HOME}/.bun/install/cache/playwright-core@1.57.0@@@1/index.mjs`,
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const mod = c.startsWith('/') ? await import(c) : require(c);
      if (mod?.chromium) return mod.chromium;
    } catch { /* try the next candidate */ }
  }
  throw new Error(
    'No playwright install found. Either `bun add -d playwright-core` (browsers ' +
      'must already be in ~/.cache/ms-playwright, and the package version must ' +
      'match that browser revision), or pass a path in PLAYWRIGHT_CORE.'
  );
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:3000');
const OUT = arg('out', '.screenshots');
const PASSWORD = arg('password', 'dev');

const chromium = await loadChromium();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const problems = [];
/**
 * The browser logs a console error for every non-2xx response, and this run
 * deliberately provokes two of them — the 401 that proves the gate is closed
 * before login, and the 404 that proves the error panel renders. Filtering them
 * is what lets a real console error stand out instead of drowning.
 */
const expectedNetworkNoise = /Failed to load resource.*(401|404)/;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (expectedNetworkNoise.test(m.text())) return;
  problems.push(`console.error: ${m.text()}`);
  console.log('  [console.error]', m.text());
});
page.on('pageerror', (e) => {
  problems.push(`pageerror: ${e.message}`);
  console.log('  [pageerror]', e.message);
});

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  saved ${OUT}/${name}.png`);
}

/**
 * Go to an admin screen and wait for something only the loaded state renders.
 * `Chargement...` is the shared skeleton; waiting it out is the whole point.
 */
async function open(path, readySelector) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(readySelector, { timeout: 30000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes('Chargement...'),
    undefined,
    { timeout: 30000 }
  );
}

// ── 1. the login form ────────────────────────────────────────────────────────
console.log('login form');
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('input[type="password"]', { timeout: 30000 });
await shot('admin-00-login');

// A deep link must land on the login form with its URL intact — the middleware
// rewrites rather than redirects so a reload after login serves what was asked.
await page.goto(`${BASE}/admin/criteria`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('input[type="password"]');
if (!page.url().endsWith('/admin/criteria')) {
  problems.push(`deep link lost its URL: ${page.url()}`);
}
await shot('admin-01-login-deeplink');

// ── 2. log in through the form, as a person would ────────────────────────────
console.log('logging in');
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForSelector('table', { timeout: 30000 });
console.log('  landed on', page.url());
if (!page.url().endsWith('/admin/criteria')) {
  problems.push(`login did not return to the requested page: ${page.url()}`);
}

// ── 3. every screen ──────────────────────────────────────────────────────────
const screens = [
  ['/admin', 'admin-02-dashboard', 'table tbody tr'],
  ['/admin/criteria', 'admin-03-criteria-list', 'table tbody tr'],
  ['/admin/criteria/propertyPrice', 'admin-04-criterion-edit', 'form'],
  ['/admin/criteria/new', 'admin-05-criterion-new', 'form'],
  ['/admin/data', 'admin-06-data-overview', 'a[href^="/admin/data/"]'],
  ['/admin/data/temperature', 'admin-07-data-detail', 'table tbody tr'],
  ['/admin/ingestion', 'admin-08-ingestion', 'table tbody tr'],
];

for (const [path, name, ready] of screens) {
  console.log(path);
  await open(path, ready);
  if (!(await page.locator('[data-testid="fixture-banner"]').count())) {
    problems.push(`${path}: fixture banner missing — the panel is not saying its data is synthetic`);
  }
  await shot(name);
}

// ── 4. search on the data screen (debounced, so wait for the count to move) ──
console.log('/admin/data/temperature — search');
await open('/admin/data/temperature', 'table tbody tr');
const totalBefore = await page.locator('table tbody tr').count();
await page.getByLabel('Rechercher une commune').fill('montpellier');
await page.waitForFunction(
  (before) => document.querySelectorAll('table tbody tr').length !== before,
  totalBefore,
  { timeout: 15000 }
);
await shot('admin-09-data-search');

// ── 5. a write, and the notice that it went nowhere ──────────────────────────
console.log('/admin/criteria — toggle (must report it was not persisted)');
await open('/admin/criteria', 'table tbody tr');
const firstRow = page.locator('table tbody tr').first();
const firstSwitch = page.locator('button[role="switch"]').first();
const wasEnabled = await firstSwitch.getAttribute('aria-checked');
// A row-level before/after pair: at full-page scale a 40px pill is not legible
// evidence of anything, and "the toggle moved" is precisely the claim.
await firstRow.screenshot({ path: `${OUT}/admin-10a-toggle-before.png` });
await firstSwitch.click();
// A specific test id, not text=/Mode fixture/ — the standing banner contains
// that phrase too, so matching on it would satisfy the wait instantly and
// photograph the page before the write had even answered.
await page.waitForSelector('[data-testid="write-notice"]', { timeout: 15000 });
const noticeText = await page.locator('[data-testid="write-notice"]').innerText();
console.log('  notice:', noticeText);
if (!/rien n’a été écrit|non enregistré/i.test(noticeText)) {
  problems.push(`toggle did not say the write went nowhere: ${noticeText}`);
}
const nowEnabled = await firstSwitch.getAttribute('aria-checked');
console.log(`  aria-checked: ${wasEnabled} -> ${nowEnabled}`);
if (nowEnabled === wasEnabled) problems.push('toggle did not change state');
await firstRow.screenshot({ path: `${OUT}/admin-10b-toggle-after.png` });
await shot('admin-10-toggle-not-persisted');

// ── 6. the ingestion console, over real SSE ──────────────────────────────────
console.log('/admin/ingestion — run (dry run in fixture mode)');
await open('/admin/ingestion', 'table tbody tr');
// Matched on the aria-label, not the visible "Run": four identical Run buttons
// need distinguishable accessible names, so the label is what the role query sees.
await page.getByRole('button', { name: /^Lancer l'ingestion de / }).first().click();
await page.waitForSelector('text=/Dry run/', { timeout: 30000 });
await shot('admin-11-ingestion-run');

// ── 7. the error state, which no screen used to have ─────────────────────────
console.log('/admin/criteria/doesNotExist — error state');
await page.goto(`${BASE}/admin/criteria/doesNotExist`, { waitUntil: 'domcontentloaded' });
const alert = page.locator('[role="alert"]').first();
await alert.waitFor({ state: 'visible', timeout: 30000 });
// Wait for text, not just the element: React commits the node a tick before
// its children, and reading too early reports an empty alert as if the error
// panel were blank.
await page.waitForFunction(
  () => (document.querySelector('[role="alert"]')?.textContent ?? '').length > 0,
  undefined,
  { timeout: 15000 }
);
const alertText = await alert.innerText();
console.log('  alert says:', alertText.replace(/\n/g, ' | '));
if (!alertText.trim()) problems.push('error panel rendered with no message');
await shot('admin-12-error-state');

await browser.close();

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('\ndone — no console errors, no page errors');
