import { describe, expect, it } from 'vitest';

import type { AlertView } from '@/lib/verification/alerts';
import type { DominantSignal, SignalReason } from '@/lib/verification/dominant-signals';
import type { ConstancyBreakdown } from '@/lib/verification/constancy';
import {
  buildMentalMap,
  MAX_MENTAL_MAP_ENTRIES,
  type MentalAxis,
  type MentalMapEntry,
} from './mental-map';

let seq = 0;
function alert(triggerType: string, opts: Partial<AlertView> = {}): AlertView {
  return {
    id: opts.id ?? `a${seq++}`,
    triggerType,
    label: triggerType,
    repeatCount: opts.repeatCount ?? 3,
    threshold: opts.threshold ?? 3,
    status: opts.status ?? 'delivered',
    createdAt: opts.createdAt ?? new Date('2026-06-01T00:00:00Z'),
  };
}

function signal(
  reason: SignalReason,
  direction: DominantSignal['direction'],
  count = 1,
): DominantSignal {
  return { reason, direction, count };
}

function map(
  input: Partial<{
    alerts: readonly AlertView[];
    dominantSignals: readonly DominantSignal[];
    constancy: ConstancyBreakdown | null;
    priorityAxes: readonly MentalAxis[];
  }> = {},
): MentalMapEntry[] {
  return buildMentalMap({
    alerts: input.alerts ?? [],
    dominantSignals: input.dominantSignals ?? [],
    constancy: input.constancy ?? null,
    ...(input.priorityAxes ? { priorityAxes: input.priorityAxes } : {}),
  });
}

describe('buildMentalMap', () => {
  it('returns nothing when the member has no signal (no fabricated advice)', () => {
    expect(map()).toEqual([]);
  });

  it('turns a repetition alert into an observed→meaning→action entry', () => {
    const [entry, ...rest] = map({
      alerts: [alert('false_declaration_repeat', { repeatCount: 4 })],
    });
    expect(rest).toHaveLength(0);
    expect(entry).toBeDefined();
    expect(entry?.axis).toBe('honesty');
    expect(entry?.tone).toBe('alert');
    expect(entry?.observation).toContain('×4');
    expect(entry?.meaning.length).toBeGreaterThan(0);
    expect(entry?.action.length).toBeGreaterThan(0);
    expect(entry?.source).toMatchObject({ kind: 'alert', triggerType: 'false_declaration_repeat' });
  });

  it('maps each known alert trigger to its psychological axis', () => {
    const cases: Array<[string, MentalMapEntry['axis']]> = [
      ['forgot_no_reason_repeat', 'discipline'],
      ['reality_gap_repeat', 'ego'],
      ['false_declaration_repeat', 'honesty'],
      ['meeting_missed_repeat', 'discipline'],
      ['tracking_skipped_repeat', 'consistency'],
    ];
    for (const [trigger, axis] of cases) {
      const [entry] = map({ alerts: [alert(trigger)] });
      expect(entry?.axis, trigger).toBe(axis);
    }
  });

  it('ignores a dismissed alert (no longer an active message)', () => {
    expect(map({ alerts: [alert('forgot_no_reason_repeat', { status: 'dismissed' })] })).toEqual(
      [],
    );
  });

  it('ignores an alert whose trigger has no curated copy', () => {
    expect(map({ alerts: [alert('some_unknown_trigger')] })).toEqual([]);
  });

  it('surfaces a down dominant signal below the alert threshold as a watch entry', () => {
    const [entry] = map({ dominantSignals: [signal('reality_gap', 'down', 2)] });
    expect(entry?.tone).toBe('watch');
    expect(entry?.axis).toBe('ego');
    expect(entry?.source).toMatchObject({ kind: 'signal', reason: 'reality_gap' });
  });

  it('does not surface an up signal as a watch entry', () => {
    const watch = map({ dominantSignals: [signal('filled', 'up', 5)] }).filter(
      (e) => e.tone === 'watch',
    );
    expect(watch).toEqual([]);
  });

  it('suppresses the watch entry when an alert already covers the same reason', () => {
    const entries = map({
      alerts: [alert('false_declaration_repeat')],
      dominantSignals: [signal('false_declaration', 'down', 2)],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tone).toBe('alert');
  });

  it('adds a single positive entry when the member shows up and nothing negative dominates', () => {
    const [entry, ...rest] = map({ dominantSignals: [signal('filled', 'up', 4)] });
    expect(rest).toHaveLength(0);
    expect(entry?.tone).toBe('positive');
    expect(entry?.axis).toBe('consistency');
    expect(entry?.source).toMatchObject({ kind: 'positive', reason: 'filled' });
  });

  it('never adds the positive entry while a negative signal or alert is present', () => {
    const withWatch = map({
      dominantSignals: [signal('filled', 'up', 4), signal('reality_gap', 'down', 1)],
    });
    expect(withWatch.some((e) => e.tone === 'positive')).toBe(false);

    const withAlert = map({
      alerts: [alert('forgot_no_reason_repeat')],
      dominantSignals: [signal('filled', 'up', 4)],
    });
    expect(withAlert.some((e) => e.tone === 'positive')).toBe(false);
  });

  it('ranks alerts before watch signals and caps the list', () => {
    const entries = map({
      alerts: [
        alert('false_declaration_repeat'),
        alert('reality_gap_repeat'),
        alert('forgot_no_reason_repeat'),
        alert('meeting_missed_repeat'),
        alert('tracking_skipped_repeat'),
      ],
      dominantSignals: [signal('forgot_no_reason', 'down', 1)],
    });
    expect(entries).toHaveLength(MAX_MENTAL_MAP_ENTRIES);
    expect(entries.every((e) => e.tone === 'alert')).toBe(true);
    // Honesty/ego outrank discipline in the ordering.
    expect(entries[0]?.axis).toBe('honesty');
    expect(entries[1]?.axis).toBe('ego');
  });

  it('produces stable ids usable as React keys / E2 trace references', () => {
    const entries = map({
      alerts: [alert('reality_gap_repeat', { id: 'alert-42' })],
      dominantSignals: [signal('forgot_no_reason', 'down', 1)],
    });
    expect(entries.map((e) => e.id)).toEqual(['alert:alert-42', 'signal:forgot_no_reason']);
  });

  // 🛡️ GARDE-FOU §2/§33.2 — la carte mentale ne doit JAMAIS produire de contenu
  // de marché (setup/direction/instrument/P&L). Couvre toutes les branches.
  it('never emits market/trading-analysis content (guardrail §2)', () => {
    const FORBIDDEN = [
      'achat',
      'vente',
      'acheter',
      'vendre',
      'long',
      'short',
      'haussier',
      'baissier',
      'résistance',
      'support',
      'stop loss',
      'take profit',
      'entrée',
      'sortie',
      'lhedge',
      'eur/usd',
      'pip',
      'profit',
      'perte sèche',
    ];
    const everything = map({
      alerts: [
        alert('false_declaration_repeat'),
        alert('reality_gap_repeat'),
        alert('forgot_no_reason_repeat'),
        alert('meeting_missed_repeat'),
        alert('tracking_skipped_repeat'),
      ],
      dominantSignals: [
        signal('reality_gap', 'down', 1),
        signal('false_declaration', 'down', 1),
        signal('forgot_no_reason', 'down', 1),
        signal('filled', 'up', 3),
      ],
    });
    // Also exercise the watch + positive branches in isolation.
    const watch = map({ dominantSignals: [signal('false_declaration', 'down', 1)] });
    const positive = map({ dominantSignals: [signal('filled', 'up', 3)] });
    const corpus = [...everything, ...watch, ...positive]
      .flatMap((e) => [e.observation, e.meaning, e.action])
      .join(' ')
      .toLowerCase();
    for (const term of FORBIDDEN) {
      expect(corpus, term).not.toContain(term);
    }
  });
});

// S5 §32-C — le profil S2 (axes prioritaires) départage la priorisation, SANS jamais
// renverser la gravité curée. INVARIANT borné (PRIORITY_BOOST < 1).
describe('buildMentalMap — tie-break par axe prioritaire (§32-C)', () => {
  it('rétro-compatible : sans priorityAxes, l’ordre reste celui de la gravité curée', () => {
    const a = map({ alerts: [alert('forgot_no_reason_repeat'), alert('meeting_missed_repeat')] });
    // Deux alertes discipline de même poids → ordre d'insertion (tri stable).
    expect(a.map((e) => e.source.kind === 'alert' && e.source.triggerType)).toEqual([
      'forgot_no_reason_repeat',
      'meeting_missed_repeat',
    ]);
  });

  it('départage des alertes de MÊME poids en faveur de l’axe prioritaire du membre', () => {
    const base = map({
      alerts: [alert('forgot_no_reason_repeat'), alert('tracking_skipped_repeat')],
    });
    expect(base[0]?.axis).toBe('discipline'); // forgot (discipline) en tête par défaut

    const prioritised = map({
      alerts: [alert('forgot_no_reason_repeat'), alert('tracking_skipped_repeat')],
      priorityAxes: ['consistency'],
    });
    // tracking (consistency, prioritaire) passe devant forgot (discipline) — même poids.
    expect(prioritised[0]?.axis).toBe('consistency');
  });

  it('NE renverse JAMAIS la gravité entre poids distincts (honnêteté > discipline)', () => {
    const prioritised = map({
      alerts: [alert('false_declaration_repeat'), alert('forgot_no_reason_repeat')],
      priorityAxes: ['discipline'],
    });
    // Même avec discipline prioritaire, l'alerte honnêteté (plus grave) reste en tête.
    expect(prioritised[0]?.axis).toBe('honesty');
  });

  it('une vigilance prioritaire ne passe JAMAIS devant une alerte (frontière de tonalité)', () => {
    const entries = map({
      alerts: [alert('forgot_no_reason_repeat')], // alerte discipline
      dominantSignals: [signal('reality_gap', 'down', 1)], // vigilance ego
      priorityAxes: ['ego'],
    });
    expect(entries[0]?.tone).toBe('alert');
    expect(entries[1]?.tone).toBe('watch');
  });
});
