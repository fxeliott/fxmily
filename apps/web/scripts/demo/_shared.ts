/**
 * Shared scaffolding for the "Démo" account seed (`scripts/seed-demo.ts`).
 *
 * Self-contained on purpose: this module imports ONLY the generated Prisma
 * client *type* and nothing from `@/lib/*`, so every demo module runs under
 * `tsx` with just `DATABASE_URL` set — no `AUTH_SECRET` / `server-only`
 * coupling (the scoring/triggers services are `server-only` and unloadable
 * from a plain Node runtime; we therefore write the derived rows directly,
 * the same proven approach as `scripts/seed-objectives-demo.ts`).
 *
 * Determinism: every random draw flows through a single seeded `mulberry32`
 * PRNG so re-running the seed produces byte-identical data (idempotent +
 * reviewable). The `now` anchor is captured once by the orchestrator.
 */
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export type DB = PrismaClient;

/** Identity + credentials of the demo member. Surfaced in the run summary. */
export const DEMO = {
  email: 'demo@fxmily.local',
  password: 'DemoFxmily2026!',
  firstName: 'Démo',
  lastName: 'Fxmily',
  timezone: 'Europe/Paris',
} as const;

/** History window length in days (the member "joined" ~WINDOW_DAYS ago). */
export const WINDOW_DAYS = 90;

/** Master PRNG seed (kept stable so the whole dataset is reproducible). */
export const SEED = 20260628;

/** Context passed to every domain seeder. */
export interface SeedCtx {
  db: DB;
  userId: string;
  /** Deterministic PRNG shared across the run. */
  rand: () => number;
  /** "now" anchor captured once by the orchestrator. */
  now: Date;
  /** Progress logger. */
  log: (msg: string) => void;
}

// =============================================================================
// PRNG + sampling helpers
// =============================================================================

/** mulberry32 — tiny seedable PRNG, stable [0,1) stream from a 32-bit seed. */
export function makePrng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample N(mean, sd). */
export function gauss(rand: () => number, mean: number, sd: number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

/** Pick one element from a non-empty array (asserts non-empty for strict TS). */
export function pick<T>(rand: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rand() * arr.length)];
  if (item === undefined) throw new Error('pick() on empty array');
  return item;
}

/** Bernoulli draw — true with probability p. */
export function chance(rand: () => number, p: number): boolean {
  return rand() < p;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}

/** Round to `d` decimals (returns a finite number). */
export function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

// =============================================================================
// Date helpers
//
// `@db.Date` columns store the *civil date* as UTC-midnight (Europe/Paris).
// `DateTime` columns store an instant. We anchor everything on the member's
// civil "today" in Europe/Paris, then shift by whole days.
// =============================================================================

const TZ = DEMO.timezone;

/** Civil date `YYYY-MM-DD` in Europe/Paris for `now`. */
function civilTodayYmd(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

/** Shift a `YYYY-MM-DD` by `deltaDays` (UTC date math, no tz drift). */
export function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Civil date string `YYYY-MM-DD` for (today − daysAgo). */
export function ymd(now: Date, daysAgo: number): string {
  return shiftYmd(civilTodayYmd(now), -daysAgo);
}

/** `@db.Date` value (UTC-midnight) for (today − daysAgo). */
export function dbDate(now: Date, daysAgo: number): Date {
  return new Date(`${ymd(now, daysAgo)}T00:00:00.000Z`);
}

/** Convert a `YYYY-MM-DD` to its `@db.Date` (UTC-midnight) value. */
export function dbDateFromYmd(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * A real instant on (today − daysAgo) at `utcHour:minute` UTC. We pick UTC
 * hours in the 7–16 band so the rendered Europe/Paris local time lands in a
 * plausible trading/working window across DST (UTC+1/+2).
 */
export function at(now: Date, daysAgo: number, utcHour: number, minute = 0): Date {
  const hh = String(clampInt(utcHour, 0, 23)).padStart(2, '0');
  const mm = String(clampInt(minute, 0, 59)).padStart(2, '0');
  return new Date(`${ymd(now, daysAgo)}T${hh}:${mm}:00.000Z`);
}

/** Monday (UTC-midnight `@db.Date`) of the civil week `weeksAgo` weeks back. */
export function mondayOf(now: Date, weeksAgo: number): Date {
  const todayYmd = civilTodayYmd(now);
  const [y, m, d] = todayYmd.split('-').map(Number);
  const anchor = new Date(Date.UTC(y!, m! - 1, d!));
  const dow = anchor.getUTCDay(); // 0=Sun..6=Sat
  const isoOffset = dow === 0 ? -6 : 1 - dow; // back to Monday
  anchor.setUTCDate(anchor.getUTCDate() + isoOffset - weeksAgo * 7);
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
}

/** First day (UTC-midnight `@db.Date`) of the civil month `monthsAgo` back. */
export function firstOfMonth(now: Date, monthsAgo: number): Date {
  const todayYmd = civilTodayYmd(now);
  const [y, m] = todayYmd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1 - monthsAgo, 1));
}

/** Last day (UTC-midnight `@db.Date`) of the civil month `monthsAgo` back. */
export function lastOfMonth(now: Date, monthsAgo: number): Date {
  const todayYmd = civilTodayYmd(now);
  const [y, m] = todayYmd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - monthsAgo, 0));
}

/**
 * Evolution ramp in [0,1]: 0 at the oldest day (daysAgo = WINDOW_DAYS),
 * 1 at today (daysAgo = 0). Used to make every time-series trend upward so
 * the demo shows a member who became more disciplined over the window.
 */
export function progress(daysAgo: number, window = WINDOW_DAYS): number {
  return clamp((window - daysAgo) / window, 0, 1);
}

// =============================================================================
// Shared content pools (kept in one place so seeders feel coherent)
// =============================================================================

export const PAIRS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'NAS100', 'US30', 'USDJPY'] as const;
export const SESSIONS = ['asia', 'london', 'newyork', 'overlap'] as const;

/**
 * Realistic price bands per seeded instrument (2026 orders of magnitude). The
 * demo account is a SHOWCASE read by real traders — a « US30 entrée 1.27833 »
 * screams fake data instantly (runtime finding 2026-07-08; the old seed drew a
 * uniform 1.0-1.6 for EVERY instrument). Bands are deliberately wide:
 * plausibility is the goal, not market accuracy. `decimals` mirrors each
 * instrument's usual quote precision.
 */
export const INSTRUMENT_PRICE_BANDS: Record<
  (typeof PAIRS)[number],
  { min: number; max: number; decimals: number }
> = {
  EURUSD: { min: 1.05, max: 1.15, decimals: 5 },
  GBPUSD: { min: 1.25, max: 1.35, decimals: 5 },
  XAUUSD: { min: 2800, max: 3400, decimals: 2 },
  NAS100: { min: 18000, max: 22000, decimals: 1 },
  US30: { min: 38000, max: 45000, decimals: 1 },
  USDJPY: { min: 140, max: 155, decimals: 3 },
};

/** Quote precision for an instrument (fallback: forex-style 5 decimals). */
export function priceDecimals(pair: string): number {
  return INSTRUMENT_PRICE_BANDS[pair as (typeof PAIRS)[number]]?.decimals ?? 5;
}

/** A plausible price inside the instrument's band (fallback: old 1.0-1.6). */
export function priceForInstrument(rand: () => number, pair: string): number {
  const band = INSTRUMENT_PRICE_BANDS[pair as (typeof PAIRS)[number]] ?? {
    min: 1.0,
    max: 1.6,
    decimals: 5,
  };
  return round(band.min + rand() * (band.max - band.min), band.decimals);
}

export const POSITIVE_TRADE_TAGS = ['calm', 'focused', 'confident', 'disciplined'] as const;
export const NEGATIVE_TRADE_TAGS = ['fomo', 'fear-loss', 'fear-wrong', 'frustrated'] as const;

export const POSITIVE_CHECKIN_TAGS = [
  'calm',
  'focused',
  'rested',
  'energetic',
  'disciplined',
] as const;
export const NEGATIVE_CHECKIN_TAGS = ['fearful', 'fomo', 'frustrated', 'overwhelmed'] as const;
