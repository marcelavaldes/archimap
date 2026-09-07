-- Relabel `internetSpeed` to describe what is actually measured.
--
-- The criterion was seeded as "Débit internet médian disponible", unit "Mbps".
-- ARCEP's commune file does not publish a median throughput — it publishes
-- nested counts of premises eligible for each speed tier. The ingestion runner
-- reported the share reaching 100 Mbit/s, which by the 2026_T1 file is 100% for
-- 34,780 of 34,870 communes: a saturated measure that scored every commune
-- identically and rendered the map one flat shade.
--
-- The runner now reports gigabit eligibility, which still separates communes.
-- This migration makes the stored label agree, so the UI stops presenting a
-- percentage under the unit "Mbps".
--
-- Written as a new migration rather than an edit to 20260226000100_seed_criteria
-- because that one has already been applied; editing it would make the set
-- non-replayable, which 20260826-1601 exists to prevent.

UPDATE criteria
SET
  name        = 'Fibre gigabit',
  name_en     = 'Gigabit Fibre',
  description = 'Part des locaux éligibles à une offre fibre à 1 Gbit/s',
  unit        = '% des locaux'
WHERE id = 'internetSpeed';
