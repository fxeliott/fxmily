/**
 * V2 S2 — Tracking instrument registry.
 *
 * PURE lookup over the code-defined instruments. No DB, no `server-only` — the
 * client wizard resolves the current instrument from here too. Append new
 * instruments (and new versions of existing ones) to `TRACKING_INSTRUMENTS`;
 * NEVER mutate a shipped `(key, version)` body (longitudinal invariant).
 *
 * Invariants asserted by `registry.test.ts`:
 *   - `(key, version)` pairs are unique.
 *   - exactly one CURRENT version per key (the last shipped wins).
 *   - every instrument's question ids are unique within the instrument.
 */

import { PROCESS_FIDELITY_V1 } from './instruments/process-fidelity-v1';
import type { TrackingInstrument } from './types';

/**
 * Every shipped instrument version, in ship order. The CURRENT version of a key
 * is the LAST entry with that key (append v2 AFTER v1).
 */
export const TRACKING_INSTRUMENTS: readonly TrackingInstrument[] = [PROCESS_FIDELITY_V1] as const;

/** All distinct instrument keys, in first-ship order. */
export const TRACKING_INSTRUMENT_KEYS: readonly string[] = TRACKING_INSTRUMENTS.reduce<string[]>(
  (keys, inst) => (keys.includes(inst.key) ? keys : [...keys, inst.key]),
  [],
);

/** Resolve a specific `(key, version)`. Returns `undefined` if absent. */
export function getInstrument(key: string, version: string): TrackingInstrument | undefined {
  return TRACKING_INSTRUMENTS.find((i) => i.key === key && i.version === version);
}

/**
 * Resolve the CURRENT instrument for a key (the last shipped version). This is
 * what a fresh capture uses; stored entries resolve their pinned version via
 * `getInstrument`.
 */
export function getCurrentInstrument(key: string): TrackingInstrument | undefined {
  let current: TrackingInstrument | undefined;
  for (const inst of TRACKING_INSTRUMENTS) {
    if (inst.key === key) current = inst;
  }
  return current;
}

/** Every CURRENT instrument (one per key), in key ship-order. */
export function getCurrentInstruments(): readonly TrackingInstrument[] {
  return TRACKING_INSTRUMENT_KEYS.map((key) => getCurrentInstrument(key)).filter(
    (i): i is TrackingInstrument => i !== undefined,
  );
}
