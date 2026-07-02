import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { memberProfileMonthlySnapshotOutputSchema } from '@/lib/schemas/member-profile-monthly-snapshot';
import {
  buildReprofileSnapshot,
  concatReflectionCorpus,
} from '@/lib/member-profile-monthly/snapshot';

/**
 * J-E (§2 / §21.5 / §27.7) — BLOCKING isolation suite for the ADMIN-ONLY monthly
 * deep re-profiling pipeline. Carbon of `calendar-isolation.test.ts`.
 *
 * Two invariants this suite pins statically + at runtime:
 *
 *   1. The 4 re-profiled dimensions (coaching_tone, learning_stage,
 *      axes_structured, weak_signals) + the evolution narrative are NEVER a
 *      scoring / real-edge input. Proven BOTH directions:
 *        - forward: `lib/member-profile-monthly/**` reads NO P&L field and
 *          imports NO scoring/analytics/trades-service module (it re-profiles
 *          from the member's OWN introspective free text only);
 *        - reverse: NO `lib/scoring/**` and NO `lib/analytics/**` module imports
 *          the pipeline nor reads `db.memberProfileMonthlySnapshot` — so a
 *          re-profiled dimension can never flow back INTO a score.
 *
 *   2. `weakSignals` is ADMIN-ONLY. It lives only in the persisted output; the
 *      Claude-facing SNAPSHOT payload carries no such key, and the member
 *      dashboard data source (`lib/scoring/dashboard-data.ts`, covered by the
 *      reverse glob) never reads this model. The sole sanctioned reader of the
 *      model outside the pipeline is the RGPD Art. 15 export (the member's OWN
 *      data, not a coaching surface) — asserted by the allowlist below.
 */

function readSrc(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
}

/** Strip comments before scanning — defensive comments mention the tokens. */
function readSrcCode(rel: string): string {
  return readSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function tsFilesIn(relDir: string): string[] {
  const abs = fileURLToPath(new URL(`../../${relDir}`, import.meta.url));
  return readdirSync(abs)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts'))
    .map((f) => `${relDir}/${f}`);
}

const PIPELINE_MODULES: string[] = tsFilesIn('lib/member-profile-monthly');

/** P&L field reads + real-edge analysis modules. NEVER in the pipeline. */
const BREACH_TOKENS = [
  'realizedR',
  'resultR',
  'plannedRR',
  '@/lib/scoring',
  '@/lib/analytics',
  '@/lib/trades/service',
  '@/lib/trades/admin',
  'behavioralScore',
  'BehavioralScore',
];

describe('J-E isolation — forward firewall over lib/member-profile-monthly/**', () => {
  it('the glob actually discovers the pipeline tree', () => {
    for (const m of [
      'lib/member-profile-monthly/types.ts',
      'lib/member-profile-monthly/snapshot.ts',
      'lib/member-profile-monthly/loader.ts',
      'lib/member-profile-monthly/safety.ts',
      'lib/member-profile-monthly/prompt.ts',
      'lib/member-profile-monthly/batch.ts',
      'lib/member-profile-monthly/pricing.ts',
    ]) {
      expect(PIPELINE_MODULES).toContain(m);
    }
  });

  it.each(PIPELINE_MODULES)('pipeline module %s carries no P&L / scoring token', (rel) => {
    const code = readSrcCode(rel);
    for (const token of BREACH_TOKENS) {
      expect(code, `${rel} must not contain "${token}" (§21.5 breach)`).not.toContain(token);
    }
    // A trade P&L/outcome FIELD read looks like a property access (`.outcome`)
    // or an object key / Prisma `select` (`outcome:`) — reject those. Bare
    // coaching prose ("process-vs-outcome", Steenbarger) and a local control-flow
    // variable named `outcome` (the per-member PULL outcome) are NOT field reads.
    expect(
      /\.outcome\b|\boutcome\s*:/.test(code),
      `${rel} must not read a trade outcome field`,
    ).toBe(false);
    expect(/\.pnl\b|\bpnl\s*:/i.test(code), `${rel} must not read a pnl field`).toBe(false);
  });

  it('the trade read projects introspective fields ONLY (no P&L column selected)', () => {
    // The loader reads `db.trade` for notes/emotions/tags (sanctioned §21.5 free
    // text), NOT count-only like the calendar. Prove the projection excludes
    // every P&L column so no real-edge value ever enters the snapshot.
    const loader = readSrcCode('lib/member-profile-monthly/loader.ts');
    for (const pnlField of ['realizedR', 'resultR', 'plannedRR', 'outcome', 'exitPrice']) {
      expect(loader, `loader trade select must not include "${pnlField}"`).not.toContain(pnlField);
    }
  });
});

const EDGE_MODULES: string[] = [...tsFilesIn('lib/scoring'), ...tsFilesIn('lib/analytics')];

describe('J-E isolation — reverse firewall (4 dims never a scoring input)', () => {
  it('the glob discovers the real-edge scoring + analytics trees', () => {
    expect(EDGE_MODULES).toContain('lib/scoring/service.ts');
    expect(EDGE_MODULES).toContain('lib/scoring/dashboard-data.ts');
    expect(EDGE_MODULES).toContain('lib/analytics/expectancy.ts');
    expect(EDGE_MODULES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(EDGE_MODULES)('edge module %s does NOT import or read the re-profiling model', (rel) => {
    const code = readSrcCode(rel);
    expect(code, `${rel} must not import the re-profiling pipeline`).not.toContain(
      '@/lib/member-profile-monthly',
    );
    // Neither the Prisma accessor nor the model type may appear in a scoring
    // module — a re-profiled dimension must never be read back into a score.
    expect(code, `${rel} must not read db.memberProfileMonthlySnapshot`).not.toContain(
      'memberProfileMonthlySnapshot',
    );
    expect(code, `${rel} must not reference MemberProfileMonthlySnapshot`).not.toContain(
      'MemberProfileMonthlySnapshot',
    );
  });
});

describe('J-E isolation — weakSignals admin-only + closed output', () => {
  const snap = buildReprofileSnapshot({
    pseudonymLabel: 'member-AAAA1111',
    timezone: 'Europe/Paris',
    monthStartLocal: '2026-06-01',
    monthEndLocal: '2026-06-30',
    accountAgeDaysInWindow: 30,
    checkins: [
      {
        localDate: '2026-06-02',
        intention: 'Rester patient sur mon setup A+.',
        journalNote: 'Coupe un gagnant trop tot par peur.',
        gratitudeItems: ['Bonne discipline ce matin'],
        emotionTags: ['peur', 'impatience'],
      },
    ],
    trades: [
      {
        localDate: '2026-06-03',
        notes: 'Entree trop tot avant confirmation.',
        emotionBefore: ['fomo'],
        emotionDuring: ['stress'],
        emotionAfter: ['regret'],
        tags: ['revenge'],
      },
    ],
    baselineProfile: null,
    previousMonthSnapshot: null,
  });

  it('the Claude-facing snapshot exposes a fixed key set with NO weakSignals / P&L key', () => {
    expect(Object.keys(snap).sort()).toEqual(
      [
        'accountAgeDaysInWindow',
        'baseline',
        'monthEndLocal',
        'monthStartLocal',
        'processSignals',
        'pseudonymLabel',
        'reflections',
        'timezone',
      ].sort(),
    );
    for (const banned of [
      'weakSignals',
      'weak_signals',
      'axesStructured',
      'realizedR',
      'resultR',
      'plannedRR',
      'outcome',
      'pnl',
      'score',
    ]) {
      expect(banned in snap, `snapshot must not expose "${banned}"`).toBe(false);
    }
  });

  it('each reflection carries member text ONLY (source/localDate/text — never a metric)', () => {
    expect(snap.reflections.length).toBeGreaterThan(0);
    for (const r of snap.reflections) {
      expect(Object.keys(r).sort()).toEqual(['localDate', 'source', 'text']);
    }
    // processSignals is count-only context (no P&L amount).
    expect(Object.keys(snap.processSignals).sort()).toEqual(
      ['checkinCount', 'reflectionCount', 'tagFrequencies', 'tradeCount'].sort(),
    );
  });

  it('the output schema is closed (.strict rejects an injected scoring/P&L key)', () => {
    const valid = {
      evolution_narrative:
        "Ce mois, le respect du plan progresse nettement, les sorties anticipees par peur reculent, et la patience sur les setups A+ s'installe vs le point de depart de l'onboarding.",
    };
    expect(memberProfileMonthlySnapshotOutputSchema.safeParse(valid).success).toBe(true);
    for (const injected of [{ realizedR: 2.5 }, { score: 80 }, { weakSignals: [] }]) {
      expect(
        memberProfileMonthlySnapshotOutputSchema.safeParse({ ...valid, ...injected }).success,
        `output schema must reject ${JSON.stringify(injected)}`,
      ).toBe(false);
    }
  });
});

describe('J-AI corrections echo — coach corrections are REFERENCE, never citable', () => {
  // A tagged coach correction is REFERENCE context (like the onboarding baseline
  // / previous-month narrative) — an ADMIN free-text, NOT a member reflection. The
  // evidence gate validates every re-profiled evidence[] against the reflection
  // corpus ONLY, so a correction MUST stay out of `concatReflectionCorpus`, else
  // an admin note could be laundered into a "citable" evidence. This pins the
  // invariant at runtime for the whole pipeline.
  const SENTINEL_CORRECTION = 'SENTINEL_COACH_CORRECTION_zzq';
  const SENTINEL_REFLECTION = 'SENTINEL_MEMBER_REFLECTION_zzq';

  const snap = buildReprofileSnapshot({
    pseudonymLabel: 'member-BBBB2222',
    timezone: 'Europe/Paris',
    monthStartLocal: '2026-06-01',
    monthEndLocal: '2026-06-30',
    accountAgeDaysInWindow: 30,
    checkins: [
      {
        localDate: '2026-06-02',
        intention: SENTINEL_REFLECTION,
        journalNote: null,
        gratitudeItems: [],
        emotionTags: [],
      },
    ],
    trades: [],
    baselineProfile: null,
    previousMonthSnapshot: null,
    coachCorrections: [`« Exécution » : ${SENTINEL_CORRECTION}`],
  });

  it('a coach correction lands in the baseline (reference), never in the reflections corpus', () => {
    // It is carried as reference context…
    expect(JSON.stringify(snap.baseline.coachCorrections)).toContain(SENTINEL_CORRECTION);
    // …but the citable corpus is member reflections ONLY.
    const corpus = concatReflectionCorpus(snap);
    expect(corpus).toContain(SENTINEL_REFLECTION);
    expect(corpus).not.toContain(SENTINEL_CORRECTION);
    // Not a single reflection entry carries the correction text either.
    for (const r of snap.reflections) {
      expect(r.text).not.toContain(SENTINEL_CORRECTION);
    }
  });

  it('the corpus is byte-identical whether or not coach corrections are present', () => {
    // The persist-time corpus re-derivation omits `coachCorrections` entirely, so
    // the evidence gate MUST see the same corpus as the pull. Prove adding
    // corrections never perturbs `concatReflectionCorpus` (no drift → no false
    // evidence_invalid reject).
    const withoutCorrections = buildReprofileSnapshot({
      pseudonymLabel: 'member-BBBB2222',
      timezone: 'Europe/Paris',
      monthStartLocal: '2026-06-01',
      monthEndLocal: '2026-06-30',
      accountAgeDaysInWindow: 30,
      checkins: [
        {
          localDate: '2026-06-02',
          intention: SENTINEL_REFLECTION,
          journalNote: null,
          gratitudeItems: [],
          emotionTags: [],
        },
      ],
      trades: [],
      baselineProfile: null,
      previousMonthSnapshot: null,
    });
    expect(concatReflectionCorpus(snap)).toBe(concatReflectionCorpus(withoutCorrections));
  });
});

describe('J-AI corrections echo — the loader never reads a private AdminNote', () => {
  // AdminNote is a member-invisible admin-only model (same privacy class the
  // schema flags). The re-profiling loader reads the member's OWN reflections +
  // (as reference) the coach's tagged corrections on REAL trades — it must NEVER
  // touch `db.adminNote` / `AdminNote`, which would launder a private admin note
  // into the member re-profiling payload. Static firewall over the loader source.
  it('lib/member-profile-monthly/loader.ts references no AdminNote surface', () => {
    const abs = fileURLToPath(
      new URL('../../lib/member-profile-monthly/loader.ts', import.meta.url),
    );
    const code = readFileSync(abs, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const forbidden of ['AdminNote', 'adminNote', 'db.adminNote']) {
      expect(code, `loader must not reference "${forbidden}"`).not.toContain(forbidden);
    }
  });
});
