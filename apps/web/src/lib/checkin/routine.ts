/**
 * Morning routine (J5, SPEC §7.4).
 *
 * V1 ships a single fixed routine boolean in the DB (`morningRoutineCompleted`).
 * SPEC §7.4 mentions "items que le membre a configurés lui-même" — a
 * per-member checklist that maps to multiple booleans. That deeper config is
 * deferred to V2 (it requires a `MorningRoutineItem` table + admin UI to seed
 * defaults + member-level overrides). For J5 the wizard surfaces a curated
 * suggestion list as informational anchor and lets the member tick a single
 * "yes I did them" master toggle — captured as `morningRoutineCompleted`.
 *
 * The suggestion list lives here so the UI and weekly-report builder share
 * the same anchor when J6/J8 land.
 */

export const MORNING_ROUTINE_SUGGESTIONS = [
  'Boire un grand verre d’eau',
  'Bouger 10 minutes (étirements, marche)',
  'Lumière naturelle 5 minutes',
  'Lire le plan du jour',
  'Méditation / respiration courte',
] as const;
