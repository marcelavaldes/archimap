/**
 * Screenshot /map without credentials.
 *
 * Why this exists: the repo ships no .env, so every data route 500s and the map
 * renders an empty shell. That made the map effectively unobservable, and its
 * behaviour got reasoned about from source instead of looked at. Combined with
 * ARCHIMAP_FIXTURE=1 (see src/lib/fixture/), this gives a repeatable way to put
 * a real picture of the running app in front of a human or an agent.
 *
 *   bun run fixture:build                 # once — downloads real geometry
 *   ARCHIMAP_FIXTURE=1 bun run dev        # or put it in .env.local
 *   node scripts/dev/screenshot-map.mjs --out /tmp/shots
 *
 * Flags:
 *   --base <url>     default http://localhost:3000
 *   --out <dir>      default ./.screenshots (gitignored)
 *   --scenario <id>  single | composite | all   (default all)
 *
 * IMPORTANT — waiting. MapLibre tiles ~25 MB of commune GeoJSON in a worker,
 * which under software WebGL takes ~15 s on a modest box. A fixed sleep will
 * photograph an empty map and invite the conclusion that the choropleth is
 * broken; it is not. waitForChoropleth() below polls the live map object for
 * actually-rendered features instead of guessing, so a slow machine produces a
 * late screenshot rather than a wrong one.
 */
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Playwright is not a dependency of this repo — find an already-installed copy. */
async function loadChromium() {
  const candidates = [
    'playwright-core',
    'playwright',
    `${process.env.HOME}/.bun/install/cache/playwright-core@1.57.0@@@1/index.mjs`,
  ];
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
const SCENARIO = arg('scenario', 'all');

/**
 * Reach the page's MapLibre instance through the React fiber tree. The map
 * lives in a useRef and is deliberately not exposed on window; walking the
 * fiber keeps this harness read-only rather than requiring a debug global in
 * shipped code.
 */
const FIND_MAP = `(() => {
  const el = document.querySelector('.maplibregl-map');
  if (!el) return null;
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (!key) return null;
  let fiber = el[key];
  for (let i = 0; i < 40 && fiber; i++) {
    let hook = fiber.memoizedState;
    for (let j = 0; j < 40 && hook; j++) {
      const s = hook.memoizedState;
      if (s && typeof s === 'object' && 'current' in s && s.current && typeof s.current.getLayer === 'function') return s.current;
      hook = hook.next;
    }
    fiber = fiber.return;
  }
  return null;
})()`;

/** Poll until `layerId` actually has rendered features, or give up loudly. */
async function waitForChoropleth(page, layerId, timeoutMs = 90000) {
  const start = Date.now();
  for (;;) {
    const state = await page.evaluate(
      ([FIND, id]) => {
        const map = eval(FIND);
        if (!map || !map.getLayer(id)) return { ready: false, reason: 'no layer' };
        const rendered = map.queryRenderedFeatures({ layers: [id] }).length;
        return { ready: map.loaded() && rendered > 0, rendered, loaded: map.loaded() };
      },
      [FIND_MAP, layerId]
    );
    if (state.ready) return { ...state, waitedMs: Date.now() - start };
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${layerId}: no rendered features after ${timeoutMs}ms (${JSON.stringify(state)})`);
    }
    await page.waitForTimeout(1000);
  }
}

const chromium = await loadChromium();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const noise = /WebGL|GroupMarker|DevTools|HMR|Fast Refresh|SwiftShader/;
page.on('console', (m) => {
  if (m.type() === 'error' && !noise.test(m.text())) console.log('  [console.error]', m.text());
});
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  saved ${OUT}/${name}.png`);
}

if (SCENARIO === 'single' || SCENARIO === 'all') {
  console.log('single-criterion mode');
  await page.goto(`${BASE}/map`, { waitUntil: 'networkidle', timeout: 120000 });
  await waitForChoropleth(page, 'regions-fill');
  await shot('single-00-regions');

  await page.getByRole('button', { name: 'Température moyenne' }).click();
  const t = await waitForChoropleth(page, 'communes-fill');
  console.log(`  temperature: ${t.rendered} features in ${t.waitedMs}ms`);
  await shot('single-01-temperature');
}

if (SCENARIO === 'composite' || SCENARIO === 'all') {
  console.log('weighted composite mode');
  // Deep-link straight into a weighting to prove URL round-tripping works.
  await page.goto(`${BASE}/map?mode=composite&w=temperature:5,propertyPrice:1`, {
    waitUntil: 'networkidle',
    timeout: 120000,
  });
  const c = await waitForChoropleth(page, 'composite-fill');
  console.log(`  climate-heavy: ${c.rendered} features in ${c.waitedMs}ms`);
  await shot('composite-01-climate-heavy');

  // Invert the weighting via the sliders and confirm the map recolours.
  // Categories render expanded, so the sliders are already reachable — do not
  // click the category headers, which would collapse them.
  await page.getByLabel('Poids de Température moyenne').fill('1');
  await page.getByLabel('Poids de Prix immobilier').fill('5');
  await page.waitForTimeout(3000);
  await shot('composite-02-cost-heavy');
  console.log('  url after slider drag:', page.url());

  // Weight every criterion equally — the "balanced" view, and the one that
  // exercises the missing-data renormalisation hardest.
  for (const name of ['Heures d\'ensoleillement', 'Précipitations', 'Taxe foncière',
                      'Accès hôpital', 'Transport en commun', 'Débit internet']) {
    await page.getByLabel(`Poids de ${name}`).fill('3');
  }
  await page.getByLabel('Poids de Température moyenne').fill('3');
  await page.getByLabel('Poids de Prix immobilier').fill('3');
  await page.waitForTimeout(3000);
  await shot('composite-03-balanced');
}

await browser.close();
console.log('done');
