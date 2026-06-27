/**
 * S7 §33-#2 — PURE triage helpers for the admin "à traiter" signals.
 *
 * DB-free + `server-only`-free on purpose (mirror of `lib/scoring/momentum.ts`)
 * so Vitest can pin the threshold semantics without spinning Postgres. The
 * server loader (`attention-service.ts`) composes these with the DB reads.
 */

/** Minimum point-drop (0-100 scale) between the last two constancy snapshots to
 *  flag a dip — keeps a 0.x float wobble from raising the signal. */
export const CONSTANCY_DECLINE_MIN_DROP = 1;

/**
 * Did the constancy score dip between the previous and the latest snapshot?
 * `true` only when the drop is at least `CONSTANCY_DECLINE_MIN_DROP` — a calm
 * "worth a glance" hint, never an alarm (SPEC §2).
 */
export function isConstancyDip(latest: number, previous: number): boolean {
  return previous - latest >= CONSTANCY_DECLINE_MIN_DROP;
}
