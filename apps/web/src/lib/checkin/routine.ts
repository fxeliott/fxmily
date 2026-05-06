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
 * The suggestion list is **trader-anchored** (J5 audit content review): a
 * member's morning routine for a high-stakes session day matters more than
 * a generic wellness checklist. We keep two body items (movement + light)
 * so the routine doesn't feel purely cerebral, but the four trader-anchored
 * items lead.
 */

export const MORNING_ROUTINE_SUGGESTIONS = [
  'Lire ton plan du jour (setups, paires, sessions)',
  'Vérifier le calendrier macro (news à risque)',
  'Définir ton plafond de risque (trades max, % max)',
  'Méditation ou respiration courte',
  'Bouger 10 minutes + lumière naturelle',
] as const;
