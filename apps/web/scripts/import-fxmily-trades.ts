/**
 * Seed `public_trades` from the historical ODS spreadsheet
 * (C:/Users/eliot/Downloads/fxmily results.ods, parsed → JSON).
 *
 * Pre-req :
 *   1. The ODS has been extracted + parsed via `C:/temp/gen_historical_trades.py`
 *      → outputs `apps/track-record/src/lib/historical-trades.ts`.
 *   2. Migration `20260521172000_track_record_public_trades` has been
 *      applied locally (and Prisma client regenerated).
 *
 * Run :
 *   pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts
 *     [--year 2025]   (defaults : 2025 — confirm with Eliot)
 *     [--dry-run]
 *     DELETE_FIRST=1 ⇒ wipes existing public_trades before insert
 *
 * Code-review fix B4 (2026-05-21) : ce script utilise un PrismaClient
 * instancié localement (pattern carbone `seed-mark-douglas-cards.ts`) au
 * lieu d'importer `@/lib/db` qui est `server-only` — tsx ne peut pas
 * charger `server-only` (RSC runtime barrier).
 */

import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

interface RawJsonTrade {
  n: number;
  pair: string;
  action: '' | 'BUY' | 'SELL';
  result: 'PROFIT' | 'STOP' | 'BREAK EVEN';
  risk_text: string;
  risk_val: string | null;
  rr_text: string;
  pl_text: string;
  pl_val: string | null;
  week_label: string | null;
  month_num: number | null;
  month_label: string | null;
}

const MONTH_FR_TO_NUM: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

const WEEK_LABEL_RE = /(\d{1,2})\s+(\S+)/u;

/** Normalize risk_val (may be fraction "0.01", percent literal "1", or
 * stringy typo "1%%") to a clean number of percentage points (1.0 = 1%). */
function normalizeRiskPercent(raw: string | null, fallbackText: string): number {
  const cleaned = (raw ?? fallbackText ?? '1').toString().replace(/%/g, '').trim();
  const n = Number(cleaned.replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return 1.0;
  if (n > 0 && n <= 0.1) return Math.round(n * 1000) / 10;
  return Math.round(n * 100) / 100;
}

function parseRR(raw: string): number | null {
  const cleaned = (raw ?? '').toString().replace(',', '.').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function mondayOfWeek(weekLabel: string | null, year: number, fallbackMonth: number | null): Date {
  const m = weekLabel?.match(WEEK_LABEL_RE);
  if (m) {
    const day = Number(m[1]);
    const monthName = m[2]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const monthNum = MONTH_FR_TO_NUM[monthName] ?? fallbackMonth ?? 1;
    return new Date(Date.UTC(year, monthNum - 1, day));
  }
  const fallback = new Date(Date.UTC(year, (fallbackMonth ?? 1) - 1, 1));
  const dow = fallback.getUTCDay();
  const offset = (8 - dow) % 7;
  fallback.setUTCDate(fallback.getUTCDate() + offset);
  return fallback;
}

function tradeStatus(result: RawJsonTrade['result'], rr: number | null): 'closed' | 'break_even' {
  if (result === 'BREAK EVEN') return 'break_even';
  if (rr !== null && rr === 0) return 'break_even';
  return 'closed';
}

function direction(action: RawJsonTrade['action']): 'long' | 'short' | null {
  if (action === 'BUY') return 'long';
  if (action === 'SELL') return 'short';
  return null;
}

function bootDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[import] DATABASE_URL env var not set');
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

async function main() {
  const args = process.argv.slice(2);
  const yearArg = args.find((a) => a.startsWith('--year='))?.split('=')[1];
  const year = yearArg ? Number(yearArg) : 2025;
  const dryRun = args.includes('--dry-run');

  const sourcePath = process.env.FXMILY_TRADES_JSON ?? 'C:/temp/fxmily_trades_v2.json';
  console.log(`[import] reading ${sourcePath} — year=${year} dryRun=${dryRun}`);

  const raw = JSON.parse(readFileSync(sourcePath, 'utf-8')) as RawJsonTrade[];
  console.log(`[import] parsed ${raw.length} rows from JSON`);

  const seen = new Map<number, number>(); // dayOfYear → count
  const dataset: Prisma.PublicTradeCreateManyInput[] = raw.map((row, idx) => {
    const riskPct = normalizeRiskPercent(row.risk_val, row.risk_text);
    const rr = parseRR(row.rr_text);
    const enteredAt = mondayOfWeek(row.week_label, year, row.month_num);
    const doy = Math.floor(enteredAt.getTime() / 86_400_000);
    const inWeek = seen.get(doy) ?? 0;
    seen.set(doy, inWeek + 1);
    enteredAt.setUTCDate(enteredAt.getUTCDate() + Math.min(inWeek, 4));

    // pl_val (typed cell) is authoritative for resultPercent — author logged
    // rr=0 on some STOP trades while pl was -1% (code-review H1 alignment).
    let plPct: number | null = null;
    if (row.pl_val !== null && row.pl_val !== undefined) {
      const fraction = Number(row.pl_val);
      if (Number.isFinite(fraction)) plPct = fraction * 100;
    }
    if (plPct === null && row.pl_text) {
      const cleaned = row.pl_text.replace('%', '').replace(',', '.').trim();
      const v = Number(cleaned);
      if (Number.isFinite(v)) plPct = v;
    }
    if (plPct === null && rr !== null) {
      plPct = riskPct * rr;
    }
    const resultPercent = plPct !== null ? Math.round(plPct * 1000) / 1000 : null;
    const resultR =
      resultPercent !== null && riskPct > 0
        ? Math.round((resultPercent / riskPct) * 1000) / 1000
        : rr;

    return {
      // Sequential ordinal (1..N) — ODS `n` had 6 dups (124-129), use import position.
      ordinal: idx + 1,
      segment: 'historical',
      instrument: row.pair.trim(),
      direction: direction(row.action),
      enteredAt,
      exitedAt: enteredAt,
      riskPercent: new Prisma.Decimal(riskPct),
      resultR: resultR !== null ? new Prisma.Decimal(resultR) : null,
      resultPercent: resultPercent !== null ? new Prisma.Decimal(resultPercent) : null,
      status: tradeStatus(row.result, resultR),
      tags: [],
      source: 'import:fxmily-results-ods-2026-05-21',
      isPublished: true,
    };
  });

  // Defensive : verify ordinal uniqueness BEFORE DB write
  const uniqueOrdinals = new Set(dataset.map((d) => d.ordinal));
  if (uniqueOrdinals.size !== dataset.length) {
    console.error(
      `[import] FATAL : ${dataset.length - uniqueOrdinals.size} duplicate ordinal(s). Aborting.`,
    );
    process.exit(1);
  }

  console.log(`[import] prepared ${dataset.length} PublicTrade inserts`);
  console.log(`[import] first record :`, dataset[0]);
  console.log(`[import] last record :`, dataset[dataset.length - 1]);

  if (dryRun) {
    console.log(`[import] dry-run — no DB writes.`);
    return;
  }

  const db = bootDb();
  try {
    const existingCount = await db.publicTrade.count();
    if (existingCount > 0) {
      console.warn(
        `[import] aborting — ${existingCount} PublicTrade rows already exist. Set DELETE_FIRST=1 to wipe.`,
      );
      if (!process.env.DELETE_FIRST) return;
      await db.publicTrade.deleteMany({});
      console.log('[import] wiped existing PublicTrade rows.');
    }

    const result = await db.publicTrade.createMany({ data: dataset });
    console.log(`[import] inserted ${result.count} rows.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[import] failed', err);
  process.exit(1);
});
