import 'server-only';

import { formatLocalDate, parseLocalDate } from '@/lib/checkin/timezone';
import { db } from '@/lib/db';

import {
  assetAnchorId,
  buildVimeoEmbedUrl,
  deriveSeanceTime,
  deriveSeanceTitle,
  formatDuration,
  slotMeta,
  type SeanceBias,
  type SeanceSlot,
} from './derive';

/**
 * Réunion hub (séances) read service — the ONLY DB-aware surface of the member
 * `/seances` feature. READ-ONLY by design: the WRITER is the local pipeline
 * (Zoom→Vimeo→Fathom→IA) via the J4 cron API; here we only list + get + derive
 * for the member/admin readers (mirror `lib/meeting/service.ts` header).
 *
 * Posture §2 / Règle n°1: every row holds the REPLAY + a faithful summary of
 * what Eliott SAID in his own formation session — never a live recommendation.
 * 0 FK to User/Trade (platform-wide content) → no member PII is ever read here.
 *
 * Serialisation invariant (RSC): NEVER return a raw Prisma object (Date / Json /
 * enum) to a client component. Each view interface below is 100% flat &
 * serialisable (Date→ISO `YYYY-MM-DD`, enum→string union, Json→a concrete type).
 */

// ── Flat, serialisable view types ────────────────────────────────────────────

export interface SeanceLevel {
  label: string;
  value: string;
}

/** One followed asset in a séance detail (deep-dive). */
export interface SeanceAssetView {
  id: string;
  symbol: string;
  name: string | null;
  bias: SeanceBias | null;
  macro: boolean;
  levels: SeanceLevel[];
  reading: string[];
  /** Stable in-page anchor (`actif-XAUUSD`). */
  anchorId: string;
}

/** One séance as the hub listing consumes it. */
export interface SeanceListItem {
  id: string;
  /** Civil day `YYYY-MM-DD` (Europe/Paris, stored UTC-midnight). */
  date: string;
  slot: SeanceSlot;
  status: 'done' | 'cancelled';
  title: string;
  /** FR display time ("12h00"); derived from slot when not stored. */
  time: string;
  summary: string | null;
  /** "X min" / "X h MM", or null. */
  durationLabel: string | null;
  /** Replay actually playable (embed present AND not transcoding). */
  hasVideo: boolean;
  assetCount: number;
  cancelReason: string | null;
  /** `/seances/{date}/{slot}`. */
  href: string;
}

/** A day group in the archive listing. */
export interface SeanceDay {
  date: string;
  /** "lundi 29 juin 2026". */
  label: string;
  items: SeanceListItem[];
}

export interface SeanceStats {
  /** Published (done) sessions. */
  sessions: number;
  /** Distinct civil days with ≥1 done session. */
  days: number;
  /** Distinct followed symbols across done sessions. */
  assets: number;
}

export interface SeancesHub {
  stats: SeanceStats;
  /** Most recent day with ≥1 done session (also present in `days`). */
  featuredDay: SeanceDay | null;
  /** All published (done + cancelled) days, newest-first. */
  days: SeanceDay[];
  /** Id of the most recent done session (the "Dernière séance" badge). */
  latestDoneId: string | null;
  /** Any done|cancelled session exists. */
  hasPublished: boolean;
}

/** One séance detail page payload (full content). */
export interface SeanceDetail {
  id: string;
  date: string;
  slot: SeanceSlot;
  status: 'done' | 'cancelled';
  title: string;
  time: string;
  summary: string | null;
  durationLabel: string | null;
  cancelReason: string | null;
  keyTakeaways: string[];
  /** Vimeo privacy embed URL, or null (→ "replay indisponible"). */
  vimeoEmbedUrl: string | null;
  vimeoProcessing: boolean;
  transcriptPending: boolean;
  /** True when the IA content went off-schema → render replay-only, never a fake analysis. */
  contentNeedsReview: boolean;
  /** Macro-context assets (DXY), rendered apart. */
  macroAssets: SeanceAssetView[];
  /** Normal followed assets. */
  assets: SeanceAssetView[];
  /** "lundi 29 juin 2026". */
  dateLabel: string;
  /** "Analyse" / "Débrief". */
  slotLabel: string;
  slotLong: string;
  href: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map a `@db.Date` (UTC-midnight) to a civil `YYYY-MM-DD` (no tz drift). */
function toLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Safely narrow the `levels Json?` column to a flat `{label,value}[]`, dropping
 * anything malformed (anti-leak of `Prisma.JsonValue` + defensive against a
 * pipeline that ever writes garbage). Both fields are coerced to strings.
 */
function mapLevels(json: unknown): SeanceLevel[] {
  if (!Array.isArray(json)) return [];
  const out: SeanceLevel[] = [];
  for (const entry of json) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const rec = entry as Record<string, unknown>;
      const label = rec.label;
      const value = rec.value;
      if (typeof label === 'string' && (typeof value === 'string' || typeof value === 'number')) {
        out.push({ label, value: String(value) });
      }
    }
  }
  return out;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * List published séances (done + cancelled), newest-first. Hits the
 * `@@index([status, date desc])`. `scheduled` is NEVER returned (not published).
 */
export async function listSeances(): Promise<SeanceListItem[]> {
  const rows = await db.replaySession.findMany({
    where: { status: { in: ['done', 'cancelled'] } },
    orderBy: [{ date: 'desc' }, { slot: 'asc' }],
    select: {
      id: true,
      date: true,
      slot: true,
      status: true,
      title: true,
      time: true,
      summary: true,
      duration: true,
      cancelReason: true,
      vimeoId: true,
      vimeoEmbedUrl: true,
      vimeoProcessing: true,
      _count: { select: { assets: true } },
    },
  });

  return rows.map((r) => {
    const date = toLocalDate(r.date);
    const slot = r.slot as SeanceSlot;
    return {
      id: r.id,
      date,
      slot,
      status: r.status as 'done' | 'cancelled',
      title: r.title || deriveSeanceTitle(date, slot),
      time: r.time ?? deriveSeanceTime(slot),
      summary: r.summary,
      durationLabel: formatDuration(r.duration),
      hasVideo: Boolean(r.vimeoId || r.vimeoEmbedUrl) && !r.vimeoProcessing,
      assetCount: r._count.assets,
      cancelReason: r.cancelReason,
      href: `/seances/${date}/${slot}`,
    };
  });
}

/** Group an already-sorted list into day groups (pure, no re-sort). */
export function groupSeancesByDay(items: SeanceListItem[]): SeanceDay[] {
  const days: SeanceDay[] = [];
  let current: SeanceDay | null = null;
  for (const item of items) {
    if (!current || current.date !== item.date) {
      current = { date: item.date, label: formatLocalDate(item.date), items: [] };
      days.push(current);
    }
    current.items.push(item);
  }
  return days;
}

/**
 * Assemble the full hub model (stats + featured day + archive days). One list
 * query + one distinct-symbol query (the "actifs suivis" stat).
 */
export async function getSeancesHub(): Promise<SeancesHub> {
  const items = await listSeances();
  const done = items.filter((i) => i.status === 'done');

  const distinctSymbols = await db.replayAsset.findMany({
    where: { session: { status: 'done' } },
    select: { symbol: true },
    distinct: ['symbol'],
  });

  const stats: SeanceStats = {
    sessions: done.length,
    days: new Set(done.map((i) => i.date)).size,
    assets: distinctSymbols.length,
  };

  const days = groupSeancesByDay(items);
  const featuredDate = done[0]?.date ?? null;
  const featuredDay = featuredDate ? (days.find((d) => d.date === featuredDate) ?? null) : null;

  return {
    stats,
    featuredDay,
    days,
    latestDoneId: done[0]?.id ?? null,
    hasPublished: items.length > 0,
  };
}

/** Map one asset row to its flat view. */
function mapAsset(a: {
  id: string;
  symbol: string;
  name: string | null;
  bias: string | null;
  macro: boolean;
  levels: unknown;
  reading: string[];
}): SeanceAssetView {
  return {
    id: a.id,
    symbol: a.symbol,
    name: a.name,
    bias: (a.bias as SeanceBias | null) ?? null,
    macro: a.macro,
    levels: mapLevels(a.levels),
    reading: a.reading,
    anchorId: assetAnchorId(a.symbol),
  };
}

/**
 * Get one séance by its `(date, slot)` key, with its assets (ordered). Returns
 * null for an unknown OR a `scheduled` (non-published) session — a direct URL to
 * a not-yet-published séance must 404, never leak. `localDate` must be a valid
 * `YYYY-MM-DD` (parsed via `parseLocalDate`, throws on garbage → caller 404s).
 */
export async function getSeanceByDateSlot(
  localDate: string,
  slot: SeanceSlot,
): Promise<SeanceDetail | null> {
  let date: Date;
  try {
    date = parseLocalDate(localDate);
  } catch {
    return null;
  }

  const row = await db.replaySession.findUnique({
    where: { date_slot: { date, slot } },
    select: {
      id: true,
      date: true,
      slot: true,
      status: true,
      title: true,
      time: true,
      summary: true,
      duration: true,
      cancelReason: true,
      keyTakeaways: true,
      vimeoId: true,
      vimeoHash: true,
      vimeoEmbedUrl: true,
      vimeoProcessing: true,
      transcriptPending: true,
      contentNeedsReview: true,
      assets: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          symbol: true,
          name: true,
          bias: true,
          macro: true,
          levels: true,
          reading: true,
        },
      },
    },
  });

  // Never serve an unknown or a non-published (scheduled) session.
  if (!row || row.status === 'scheduled') return null;

  const date2 = toLocalDate(row.date);
  const meta = slotMeta(slot);
  const allAssets = row.assets.map(mapAsset);

  return {
    id: row.id,
    date: date2,
    slot,
    status: row.status as 'done' | 'cancelled',
    title: row.title || deriveSeanceTitle(date2, slot),
    time: row.time ?? deriveSeanceTime(slot),
    summary: row.summary,
    durationLabel: formatDuration(row.duration),
    cancelReason: row.cancelReason,
    keyTakeaways: row.keyTakeaways,
    vimeoEmbedUrl: buildVimeoEmbedUrl(row.vimeoId, row.vimeoHash, row.vimeoEmbedUrl),
    vimeoProcessing: row.vimeoProcessing,
    transcriptPending: row.transcriptPending,
    contentNeedsReview: row.contentNeedsReview,
    macroAssets: allAssets.filter((a) => a.macro),
    assets: allAssets.filter((a) => !a.macro),
    dateLabel: formatLocalDate(date2),
    slotLabel: meta.label,
    slotLong: meta.long,
    href: `/seances/${date2}/${slot}`,
  };
}
