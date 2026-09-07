/**
 * The demo's geographic scope — ONE source of truth.
 *
 * This used to be a hardcoded array in src/app/map/page.tsx, duplicated again
 * in the fixture builder and the fixture server module. Three copies of the
 * same list is a silent-failure waiting to happen: the map asks for a
 * département the fixture never built, gets an empty FeatureCollection, and
 * renders a blank map with no error anywhere. Everything now imports from here.
 *
 * WHY IT IS ONE DÉPARTEMENT. The PRD's MVP scope is all of France (~35,000
 * communes), which the current architecture cannot serve — /api/geo assembles
 * GeoJSON in Postgres per request and the payload for France is ~50 MB. Until
 * geometry is split out and served as tiles (tasket 20260826-1610), the demo
 * covers one département properly rather than all of France badly.
 */

export interface DemoRegion {
  /** Département codes to load, as INSEE 2-char codes. */
  departements: string[];
  /** Human label for the UI. */
  label: string;
  /** Initial map centre, [lng, lat]. */
  center: [number, number];
  /** Initial zoom once commune data is showing. */
  zoom: number;
}

/**
 * Loire (42) — Saint-Étienne, Roanne, Montbrison. 323 communes.
 *
 * Small enough that the fixture is a few MB and every commune's real
 * open-data value can be captured and checked, large enough to read as a real
 * territory rather than a toy.
 */
export const DEMO_REGION: DemoRegion = {
  departements: ['42'],
  label: 'Loire (42)',
  center: [4.15, 45.72],
  zoom: 8.6,
};
