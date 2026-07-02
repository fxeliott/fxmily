/**
 * J-E — PURE builder for the ADMIN-ONLY monthly re-profiling snapshot.
 *
 * Turns the raw civil-month rows loaded by `loader.ts` into the
 * {@link MonthlyReprofileSnapshot} fed to Claude (as the user prompt) and
 * re-derived server-side at persist for the evidence gate. No DB, no clock,
 * no I/O — deterministic, Vitest-replayable against a frozen fixture (mirror
 * `weekly-report`/`monthly-debrief` builder split).
 *
 * The single source of truth for the evidence corpus is
 * {@link concatReflectionCorpus}: every re-profiled `evidence[i]` is validated
 * (NFC substring) against exactly the text this builder emits, so the rendered
 * prompt, the corpus and the gate agree byte-for-byte (`safeFreeText` is
 * applied HERE, once).
 */

import { safeFreeText } from '@/lib/text/safe';

import type { MonthlyReflectionEntry, MonthlyReprofileSnapshot, RawReprofileSlice } from './types';

/**
 * Caps (defensive — a single member-month stays far below these). Keep the
 * reflection corpus bounded so the prompt payload is predictable, and cap each
 * entry so one pathological journal note cannot dominate the corpus.
 */
export const MAX_REFLECTIONS = 160;
export const REFLECTION_MAX_CHARS = 600;
export const MAX_TAG_FREQUENCIES = 16;

/**
 * Append `raw` as a reflection IFF it survives `safeFreeText` (drops a
 * whitespace / zero-width / bidi-only string to `""`, exactly what the schema
 * would reject downstream) — sanitising HERE keeps prompt/corpus/gate aligned.
 */
function pushReflection(
  out: MonthlyReflectionEntry[],
  source: MonthlyReflectionEntry['source'],
  localDate: string,
  raw: string | null | undefined,
): void {
  if (typeof raw !== 'string') return;
  const clean = safeFreeText(raw).slice(0, REFLECTION_MAX_CHARS);
  if (clean.length === 0) return;
  out.push({ source, localDate, text: clean });
}

/** Tally an enum tag list into the frequency accumulator (skips empties). */
function tallyTags(acc: Map<string, number>, tags: readonly string[]): void {
  for (const tag of tags) {
    const clean = safeFreeText(tag);
    if (clean.length === 0) continue;
    acc.set(clean, (acc.get(clean) ?? 0) + 1);
  }
}

export function buildReprofileSnapshot(raw: RawReprofileSlice): MonthlyReprofileSnapshot {
  const reflections: MonthlyReflectionEntry[] = [];
  const tagAcc = new Map<string, number>();

  // Check-ins → intention + journal note + each gratitude item (the member's
  // own words). Emotion tags feed the frequency accumulator (structured
  // context), never the citable corpus.
  for (const c of raw.checkins) {
    pushReflection(reflections, 'intention', c.localDate, c.intention);
    pushReflection(reflections, 'journal', c.localDate, c.journalNote);
    for (const item of c.gratitudeItems) {
      pushReflection(reflections, 'gratitude', c.localDate, item);
    }
    tallyTags(tagAcc, c.emotionTags);
  }

  // Trades → the free-text note only. The pre/during/post emotion enums + the
  // behavioural bias tags (LESSOR/Steenbarger) feed the frequency accumulator.
  for (const t of raw.trades) {
    pushReflection(reflections, 'trade_note', t.localDate, t.notes);
    tallyTags(tagAcc, t.emotionBefore);
    tallyTags(tagAcc, t.emotionDuring);
    tallyTags(tagAcc, t.emotionAfter);
    tallyTags(tagAcc, t.tags);
  }

  // Bound the corpus deterministically. Reflections arrive in chronological
  // order (loader orders by date asc); if a member somehow exceeds the cap we
  // keep the EARLIEST entries so the slice stays a stable prefix (a re-run of
  // the same month yields the identical corpus — idempotency).
  const boundedReflections = reflections.slice(0, MAX_REFLECTIONS);

  // Deterministic tag ranking: count desc, then tag asc (tie-break) so the
  // structured-signal ordering never depends on Map insertion timing.
  const tagFrequencies = [...tagAcc.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : a.tag.localeCompare(b.tag)))
    .slice(0, MAX_TAG_FREQUENCIES);

  return {
    pseudonymLabel: raw.pseudonymLabel,
    timezone: raw.timezone,
    monthStartLocal: raw.monthStartLocal,
    monthEndLocal: raw.monthEndLocal,
    accountAgeDaysInWindow: raw.accountAgeDaysInWindow,
    reflections: boundedReflections,
    baseline: {
      coachingRegister: raw.baselineProfile?.coachingRegister ?? null,
      learningStage: raw.baselineProfile?.learningStage ?? null,
      onboardingSummary: raw.baselineProfile?.onboardingSummary ?? null,
      previousMonth: raw.previousMonthSnapshot
        ? {
            monthStartLocal: raw.previousMonthSnapshot.monthStartLocal,
            evolutionNarrative: raw.previousMonthSnapshot.evolutionNarrative,
            coachingRegister: raw.previousMonthSnapshot.coachingRegister,
            learningStage: raw.previousMonthSnapshot.learningStage,
          }
        : null,
    },
    processSignals: {
      reflectionCount: boundedReflections.length,
      tradeCount: raw.trades.length,
      checkinCount: raw.checkins.length,
      tagFrequencies,
    },
  };
}

/**
 * The evidence corpus — the single source of truth against which every
 * re-profiled `evidence[i]` is NFC-substring-validated at persist (mirror
 * onboarding `concatAnswerTextsForValidation`). ONLY the member's free-text
 * reflections; the baseline / previous-month narrative are reference context,
 * never citable. Joined by newline (a citation never spans two reflections).
 */
export function concatReflectionCorpus(snapshot: MonthlyReprofileSnapshot): string {
  return snapshot.reflections
    .map((r) => r.text)
    .join('\n')
    .normalize('NFC');
}
