'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Lightbulb,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { submitWeeklyReviewAction, type WeeklyReviewActionState } from '@/app/review/actions';
import { Alert } from '@/components/alert';
import { V18_SPRING } from '@/components/v18/motion-presets';
import { V18StepProgress } from '@/components/v18/step-progress';
import { REVIEW_TEXT_MAX_CHARS, REVIEW_TEXT_MIN_CHARS } from '@/lib/schemas/weekly-review';
import { cn } from '@/lib/utils';

/**
 * V1.8 REFLECT — WeeklyReviewWizard (5-step member-facing Sunday recap).
 *
 * Architecture mirrors `<MorningCheckinWizard>` (J5 carbone) but adapted
 * to the REFLECT module visual language (blue+black, mirror metaphor).
 *
 * Steps :
 *   1. "Cette semaine"               — informational, no input
 *   2. "Ta plus grande victoire"     — biggestWin (required, 10-4000)
 *   3. "Ton plus grand piège"        — biggestMistake (required)
 *   4. "Ce qui a marché"             — bestPractice (optional, Steenbarger)
 *   5. "Leçon + focus de la semaine" — lessonLearned + nextWeekFocus (both required)
 *
 * State : `useState` + localStorage `fxmily:weekly-review:draft:v1`.
 * Submit via `useActionState(submitWeeklyReviewAction)` ; on success the
 * action redirects (NEXT_REDIRECT re-thrown — wizard unmounts cleanly).
 *
 * Posture : zero gamification (no streak, no XP, no celebration). Process
 * language ("plus grande victoire" = quel comportement, pas quel P&L).
 */

interface StepDef {
  title: string;
  icon: LucideIcon;
}

const STEP_DEFS: readonly StepDef[] = [
  { title: 'Cette semaine', icon: Eye },
  { title: 'Ta plus grande victoire', icon: Sparkles },
  { title: 'Ton plus grand piège', icon: Lightbulb },
  { title: 'Ce qui a marché', icon: Check },
  { title: 'Leçon + focus', icon: Target },
];

const STEP_LABELS: readonly string[] = STEP_DEFS.map((s) => s.title);

type StepIndex = 0 | 1 | 2 | 3 | 4;

interface DraftState {
  weekStart: string;
  biggestWin: string;
  biggestMistake: string;
  bestPractice: string;
  lessonLearned: string;
  nextWeekFocus: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:weekly-review:draft:v1';

function lastMondayUTC(): string {
  // Use UTC consistently — the server-side Zod refine in `weeklyReviewSchema`
  // validates via `d.getUTCDay() === 1`. Computing with local `getDay()` +
  // `setDate()` would desync for users east of UTC (Tokyo Mon 06:00 JST =
  // Sun 21:00 UTC, etc.) and for FR users at Sun 23:30 around DST shifts.
  // Code-review #1 BUG-1 fix 2026-05-14.
  const d = new Date();
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function formatFrenchPeriod(weekStart: string): string {
  const weekEnd = addDaysIso(weekStart, 6);
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(dt);
  };
  return `${fmt(weekStart)} → ${fmt(weekEnd)}`;
}

function emptyDraft(weekStart: string): DraftState {
  return {
    weekStart,
    biggestWin: '',
    biggestMistake: '',
    bestPractice: '',
    lessonLearned: '',
    nextWeekFocus: '',
  };
}

function loadDraft(weekStart: string): DraftState {
  if (typeof window === 'undefined') return emptyDraft(weekStart);
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft(weekStart);
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      ...emptyDraft(weekStart),
      ...parsed,
      // Always anchor weekStart to current Monday on rehydrate — stale drafts
      // from previous weeks are out of the window anyway (Zod refine -35d).
      weekStart,
    };
  } catch {
    return emptyDraft(weekStart);
  }
}

function isStepValid(step: StepIndex, draft: DraftState): boolean {
  const min = REVIEW_TEXT_MIN_CHARS;
  const max = REVIEW_TEXT_MAX_CHARS;
  switch (step) {
    case 0:
      return true; // informational
    case 1:
      return draft.biggestWin.trim().length >= min && draft.biggestWin.length <= max;
    case 2:
      return draft.biggestMistake.trim().length >= min && draft.biggestMistake.length <= max;
    case 3:
      // bestPractice is OPTIONAL. If filled, must respect bounds. Empty = OK.
      if (draft.bestPractice.trim().length === 0) return true;
      return draft.bestPractice.trim().length >= min && draft.bestPractice.length <= max;
    case 4:
      return (
        draft.lessonLearned.trim().length >= min &&
        draft.lessonLearned.length <= max &&
        draft.nextWeekFocus.trim().length >= min &&
        draft.nextWeekFocus.length <= max
      );
  }
}

export function WeeklyReviewWizard() {
  const reduceMotion = useReducedMotion();
  const initialWeekStart = useMemo(() => lastMondayUTC(), []);
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(initialWeekStart));
  const [step, setStep] = useState<StepIndex>(0);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // BUG-2 fix (code-review 2026-05-14) — `firstMount` skips the focus jump
  // at initial render so the SR-flow reads the step-progress + eyebrow
  // before the heading (WCAG 2.4.3 focus order). Subsequent step changes
  // (user-initiated) DO move focus to the new heading.
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState(submitWeeklyReviewAction, null);

  // Hydrate draft from localStorage post-mount (SSR-safe). Pattern carbone
  // J5 `morning-checkin-wizard.tsx:151` — `setState` inside `useEffect` is
  // intentional here (we need the client-only `window.localStorage` post-
  // hydration to avoid SSR/CSR HTML mismatch). The lint rule normally
  // discourages this but the hydration-from-storage pattern is the
  // canonical React 19 SSR-safe approach.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(initialWeekStart));
    setHydrated(true);
  }, [initialWeekStart]);

  // Persist draft on every change after hydration.
  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* quota or private-mode — ignore */
    }
  }, [draft, hydrated]);

  // Move focus to the step heading on every step change (a11y APG). Skip
  // the initial mount so SR users read the progress chrome first (BUG-2).
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errors = (state as WeeklyReviewActionState | null)?.fieldErrors;
  const formError = (state as WeeklyReviewActionState | null)?.error;
  const stepValid = isStepValid(step, draft);

  function goToStep(next: StepIndex) {
    setStep(next);
  }

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="weekly-review-wizard"
      aria-labelledby="wrw-heading"
    >
      {/* Hidden form payload — server is the authority, every field always submitted */}
      <input type="hidden" name="weekStart" value={draft.weekStart} />
      <input type="hidden" name="biggestWin" value={draft.biggestWin} />
      <input type="hidden" name="biggestMistake" value={draft.biggestMistake} />
      <input type="hidden" name="bestPractice" value={draft.bestPractice} />
      <input type="hidden" name="lessonLearned" value={draft.lessonLearned} />
      <input type="hidden" name="nextWeekFocus" value={draft.nextWeekFocus} />

      <V18StepProgress current={step + 1} total={STEP_DEFS.length} labels={STEP_LABELS} />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      <div className="relative min-h-[320px]">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={step}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={V18_SPRING}
            className="flex flex-col gap-5"
          >
            <StepHeader
              step={step}
              eyebrow={`Étape ${step + 1} sur ${STEP_DEFS.length}`}
              headingRef={headingRef}
            />

            {step === 0 ? (
              <StepWeekIntro weekStart={draft.weekStart} />
            ) : step === 1 ? (
              <FreeTextStep
                id="biggestWin"
                label="Quelle a été ta plus grande victoire de process cette semaine ?"
                hint={`Pas un P&L — un comportement. "J'ai respecté ma checklist sur EURUSD malgré la tentation."`}
                value={draft.biggestWin}
                onChange={(v) => update('biggestWin', v)}
                error={errors?.biggestWin}
                placeholder="Décris un moment précis où tu as exécuté ton process…"
              />
            ) : step === 2 ? (
              <FreeTextStep
                id="biggestMistake"
                label={`Ton plus grand piège — quel a été l'écart au plan ?`}
                hint="Pas une perte. Un dérapage de process. Sois précis, sans jugement."
                value={draft.biggestMistake}
                onChange={(v) => update('biggestMistake', v)}
                error={errors?.biggestMistake}
                placeholder="Le moment où tu as dévié — quand, pourquoi, comment tu l'as vu après…"
              />
            ) : step === 3 ? (
              <FreeTextStep
                id="bestPractice"
                label={`Ce qui a marché — et comment tu l'as fait. (Optionnel)`}
                hint="Steenbarger 2025 reverse-journaling. Identifie ta force avant tes failles."
                value={draft.bestPractice}
                onChange={(v) => update('bestPractice', v)}
                error={errors?.bestPractice}
                optional
                placeholder="Ce passage où tu as été aligné·e — qu'est-ce qui a fait la différence ?"
              />
            ) : (
              <DoubleTextStep
                a={{
                  id: 'lessonLearned',
                  label: 'Ta leçon abstraite de la semaine',
                  hint: 'Une phrase qui résume ce que tu retiens.',
                  value: draft.lessonLearned,
                  onChange: (v) => update('lessonLearned', v),
                  error: errors?.lessonLearned,
                  placeholder: 'Ce que je retiens pour les semaines à venir…',
                }}
                b={{
                  id: 'nextWeekFocus',
                  label: 'Ton focus pour la semaine qui vient',
                  hint: 'Un seul objectif de process — concret, mesurable, sans P&L.',
                  value: draft.nextWeekFocus,
                  onChange: (v) => update('nextWeekFocus', v),
                  error: errors?.nextWeekFocus,
                  placeholder: 'Cette semaine, je vais…',
                }}
              />
            )}
          </m.div>
        </AnimatePresence>
      </div>

      {/* Sticky bottom CTA bar — safe-area aware */}
      <div
        className="v18-glass sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-[var(--b-default)] px-4 py-3 sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        {step > 0 ? (
          <button
            type="button"
            onClick={() => goToStep((step - 1) as StepIndex)}
            className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-3 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
            aria-label="Étape précédente"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Précédent
          </button>
        ) : (
          <span className="w-px" aria-hidden="true" />
        )}

        <div className="flex-1" aria-hidden="true" />

        {step < STEP_DEFS.length - 1 ? (
          <button
            type="button"
            onClick={() => goToStep((step + 1) as StepIndex)}
            disabled={!stepValid}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : // a11y B1 fix (WCAG 1.4.3) — `--t-2` instead of `--t-3`
                  // lifts contrast above 4.5:1 on the `--bg-2` disabled CTA.
                  // The label remains operationally informative ("Enregistrer
                  // ma revue") and 1.4.3 still applies to disabled controls
                  // when their label conveys progress.
                  'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
          >
            Suivant
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!stepValid || isPending}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-5 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid && !isPending
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : // a11y B1 fix (WCAG 1.4.3) — `--t-2` instead of `--t-3`
                  // lifts contrast above 4.5:1 on the `--bg-2` disabled CTA.
                  // The label remains operationally informative ("Enregistrer
                  // ma revue") and 1.4.3 still applies to disabled controls
                  // when their label conveys progress.
                  'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Envoi…' : 'Enregistrer ma revue'}
            <Check size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StepHeaderProps {
  step: StepIndex;
  eyebrow: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

function StepHeader({ step, eyebrow, headingRef }: StepHeaderProps) {
  const def = STEP_DEFS[step];
  if (!def) return null;
  const Icon = def.icon;
  return (
    <header className="flex items-start gap-3">
      <div
        aria-hidden="true"
        className="rounded-pill mt-1 flex h-10 w-10 shrink-0 items-center justify-center border border-[var(--b-acc)]"
        style={{
          background: 'oklch(0.62 0.19 254 / 0.14)',
          color: 'oklch(0.82 0.115 247)',
        }}
      >
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="t-eyebrow text-[var(--t-3)]">{eyebrow}</p>
        {/* V1.9 TIER A H3 : `outline-none` retiré (WCAG 2.4.7 focus visible —
            l'heading reçoit le focus programmatique au changement d'étape pour
            l'annonce SR ; flash bref de l'outline navigateur acceptable). */}
        <h2 id="wrw-heading" ref={headingRef} tabIndex={-1} className="t-h1 mt-1 text-[var(--t-1)]">
          {def.title}
        </h2>
      </div>
    </header>
  );
}

function StepWeekIntro({ weekStart }: { weekStart: string }) {
  const period = formatFrenchPeriod(weekStart);
  const tips = [
    '5 questions, ~5 minutes. Une seule par écran.',
    'Si une question ne te parle pas, passe à la suivante.',
    `Aucune note, aucun score. C'est une revue process.`,
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="t-lead text-[var(--t-2)]">
        Pose le miroir sur les sept derniers jours.{' '}
        <span className="text-[var(--t-1)]">Pas de P&amp;L</span>, pas d&apos;analyse de marché —
        juste ton exécution.
      </p>
      <div className="rounded-card-lg border border-[var(--b-acc)] bg-[oklch(0.62_0.19_254_/_0.08)] p-4">
        <p className="t-eyebrow text-[var(--t-3)]">Semaine couverte</p>
        <p className="t-h2 mt-1 font-mono text-[var(--t-1)]">{period}</p>
      </div>
      <ul className="space-y-2">
        {tips.map((tip) => (
          <li key={tip} className="flex items-start gap-2 text-[13px] text-[var(--t-2)]">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--acc-hi)]"
            />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FreeTextStepProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  placeholder?: string;
  optional?: boolean;
}

function FreeTextStep(props: FreeTextStepProps) {
  const { id, label, hint, value, onChange, error, placeholder, optional } = props;
  const charCount = value.length;
  const isOverMax = charCount > REVIEW_TEXT_MAX_CHARS;
  const isUnderMin = !optional && charCount > 0 && value.trim().length < REVIEW_TEXT_MIN_CHARS;
  // V1.9 TIER A H1 : counter default tone `--t-2` (WCAG 1.4.3 contrast ≥
  // 4.5:1) au lieu de `--t-3` qui frôle le ratio sur fond DS-v2.
  const counterTone = isOverMax
    ? 'text-[var(--bad)]'
    : isUnderMin
      ? 'text-[var(--warn)]'
      : 'text-[var(--t-2)]';
  const describedBy = `${id}-counter${error ? ` ${id}-error` : ''}`;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="flex flex-col gap-1.5">
        <span className="t-h3 text-[var(--t-1)]">{label}</span>
        <span className="t-cap text-[var(--t-3)]">{hint}</span>
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={REVIEW_TEXT_MAX_CHARS + 100} // soft cap; hard cap enforced server-side
        rows={6}
        className="rounded-input w-full resize-y border bg-[var(--bg-2)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus:border-[var(--b-acc-strong)] focus:shadow-[0_0_0_3px_oklch(0.62_0.19_254_/_0.16)] focus:outline-none"
        style={{
          borderColor: error ? 'oklch(0.7 0.165 22 / 0.55)' : 'var(--b-strong)',
          minHeight: '160px',
        }}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      />
      <div className="flex items-baseline justify-between gap-3">
        {/* V1.9 TIER A H5 : `aria-live="polite"` + `aria-atomic="true"` pour
            que les SR annoncent le compteur quand il franchit min/max
            (browser-throttled — pas de spam à chaque touche). */}
        <p
          id={`${id}-counter`}
          aria-live="polite"
          aria-atomic="true"
          className={cn('t-cap font-mono tabular-nums', counterTone)}
        >
          {charCount} / {REVIEW_TEXT_MAX_CHARS}
          {!optional && charCount > 0 && charCount < REVIEW_TEXT_MIN_CHARS ? (
            <span className="ml-2">
              ({REVIEW_TEXT_MIN_CHARS - charCount} caractères de plus pour valider)
            </span>
          ) : null}
        </p>
        {optional ? (
          <p className="t-cap text-[var(--t-3)]">Optionnel</p>
        ) : (
          <p className="t-cap text-[var(--t-3)]">Min. {REVIEW_TEXT_MIN_CHARS} caractères</p>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DoubleTextStep({ a, b }: { a: FreeTextStepProps; b: FreeTextStepProps }) {
  return (
    <div className="flex flex-col gap-6">
      <FreeTextStep {...a} />
      <div
        aria-hidden="true"
        className="h-px w-full bg-gradient-to-r from-transparent via-[var(--b-default)] to-transparent"
      />
      <FreeTextStep {...b} />
    </div>
  );
}
