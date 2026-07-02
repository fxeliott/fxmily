'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  Target,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';

import {
  submitTrainingDebriefAction,
  type TrainingDebriefActionState,
} from '@/app/training/debrief/actions';
import { Alert } from '@/components/alert';
import { TrainingDebriefStepProgress } from '@/components/training-debrief/training-debrief-step-progress';
import { V18_SPRING } from '@/components/v18/motion-presets';
import {
  TRAINING_DEBRIEF_TEXT_MAX_CHARS,
  TRAINING_DEBRIEF_TEXT_MIN_CHARS,
} from '@/lib/schemas/training-debrief';
import { cn } from '@/lib/utils';

/**
 * V1.3 — TrainingDebriefWizard (4-step Steenbarger reverse-journaling).
 *
 * Mechanics are a faithful clone of `<WeeklyReviewWizard>` (REFLECT canon:
 * `useActionState`, localStorage draft, Framer `m.*` + `AnimatePresence
 * mode="wait"`, reduced-motion gating, hidden-input "submit everything",
 * APG focus-on-step, sticky safe-area CTA) re-skinned to the **cyan DS-v2
 * training identity** — NEVER `.v18-theme` (§21.7). `weekStart` is NOT
 * computed client-side (REFLECT's `lastMondayUTC` is UTC-naive); it is
 * server-derived (`currentParisWeekStart`, §23.7) and passed as a prop.
 *
 * Posture §23 / §2: zero gamification (no streak/XP/celebration), process
 * language only, zero P&L, never judges the Lhedge system.
 */

interface StepDef {
  title: string;
  icon: LucideIcon;
}

const STEP_DEFS: readonly StepDef[] = [
  { title: 'Première force de process', icon: Sparkles },
  { title: 'Deuxième force de process', icon: Sparkles },
  { title: 'Un micro-ajustement', icon: Wrench },
  { title: 'La leçon transversale', icon: Target },
];

const STEP_LABELS: readonly string[] = STEP_DEFS.map((s) => s.title);

type StepIndex = 0 | 1 | 2 | 3;

interface DraftState {
  weekStart: string;
  processStrengthOne: string;
  processStrengthTwo: string;
  microAdjustment: string;
  transversalLesson: string;
}

export interface TrainingDebriefPrefill {
  processStrengthOne: string;
  processStrengthTwo: string;
  microAdjustment: string;
  transversalLesson: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:training-debrief:draft:v1';

function emptyDraft(weekStart: string, prefill?: TrainingDebriefPrefill): DraftState {
  return {
    weekStart,
    processStrengthOne: prefill?.processStrengthOne ?? '',
    processStrengthTwo: prefill?.processStrengthTwo ?? '',
    microAdjustment: prefill?.microAdjustment ?? '',
    transversalLesson: prefill?.transversalLesson ?? '',
  };
}

function loadDraft(weekStart: string, prefill?: TrainingDebriefPrefill): DraftState {
  const base = emptyDraft(weekStart, prefill);
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    // An in-progress local draft for THIS week wins over the server prefill;
    // a stale draft from another week is discarded (weekStart re-anchored —
    // server Zod refine rejects out-of-window anyway).
    if (parsed.weekStart && parsed.weekStart !== weekStart) return base;
    return { ...base, ...parsed, weekStart };
  } catch {
    return base;
  }
}

function isStepValid(step: StepIndex, draft: DraftState): boolean {
  const min = TRAINING_DEBRIEF_TEXT_MIN_CHARS;
  const max = TRAINING_DEBRIEF_TEXT_MAX_CHARS;
  const field =
    step === 0
      ? draft.processStrengthOne
      : step === 1
        ? draft.processStrengthTwo
        : step === 2
          ? draft.microAdjustment
          : draft.transversalLesson;
  return field.trim().length >= min && field.length <= max;
}

interface TrainingDebriefWizardProps {
  /** Server-derived Monday (Europe/Paris) of the current week — §23.7. */
  weekStart: string;
  /** Existing debrief for this week → editing (upsert). */
  prefill?: TrainingDebriefPrefill;
}

export function TrainingDebriefWizard({ weekStart, prefill }: TrainingDebriefWizardProps) {
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(weekStart, prefill));
  const [step, setStep] = useState<StepIndex>(0);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState(submitTrainingDebriefAction, null);

  // Hydrate from localStorage post-mount (SSR-safe — carbon J5/REFLECT).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(weekStart, prefill));
    setHydrated(true);
    // `prefill` is a stable server prop for the page's lifetime; intentionally
    // not in deps (it would re-run + clobber an in-progress edit on re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* quota / private-mode — ignore */
    }
  }, [draft, hydrated]);

  // Focus the step heading on step change (APG). Skip first mount so SR users
  // read the progress chrome first (REFLECT BUG-2 canon).
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errors = (state as TrainingDebriefActionState | null)?.fieldErrors;
  const formError = (state as TrainingDebriefActionState | null)?.error;
  const stepValid = isStepValid(step, draft);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="training-debrief-wizard"
      aria-labelledby="tdw-heading"
    >
      {/* Hidden payload — server is the authority, every field always sent. */}
      <input type="hidden" name="weekStart" value={draft.weekStart} />
      <input type="hidden" name="processStrengthOne" value={draft.processStrengthOne} />
      <input type="hidden" name="processStrengthTwo" value={draft.processStrengthTwo} />
      <input type="hidden" name="microAdjustment" value={draft.microAdjustment} />
      <input type="hidden" name="transversalLesson" value={draft.transversalLesson} />

      <TrainingDebriefStepProgress
        current={step + 1}
        total={STEP_DEFS.length}
        labels={STEP_LABELS}
      />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      {/* DS-v3 (§21.7) glass step-region — frosted panel over the cyan ambient
          mesh. NO `overflow-hidden` (it would clip the icon halo; the x:±24
          slide rides the child `m.div` in `mode="wait"`). Blur comes from the
          Tailwind backdrop utilities here, never a raw rule (Lightning CSS
          strips raw `backdrop-filter`). J3 invariant: backdrop-filter on the
          static parent, transform on the child. */}
      <div className="glass-panel border-edge-top rounded-card-lg relative min-h-[300px] p-5 backdrop-blur-[16px] backdrop-saturate-150 sm:p-6">
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
              <FreeTextStep
                id="processStrengthOne"
                label="Quelle a été ta première force de process cette semaine ?"
                hint={`Steenbarger reverse-journaling : ce qui a marché ET comment tu l'as fait. Pas un résultat, un comportement.`}
                value={draft.processStrengthOne}
                onChange={(v) => update('processStrengthOne', v)}
                error={errors?.processStrengthOne}
                placeholder="Un moment précis où ton process a tenu, et ce qui l'a rendu possible…"
              />
            ) : step === 1 ? (
              <FreeTextStep
                id="processStrengthTwo"
                label="Une deuxième force de process à ancrer."
                hint="Une autre chose que tu veux répéter, décris le geste, pas l'issue."
                value={draft.processStrengthTwo}
                onChange={(v) => update('processStrengthTwo', v)}
                error={errors?.processStrengthTwo}
                placeholder="Un second appui solide de ta semaine d'entraînement…"
              />
            ) : step === 2 ? (
              <FreeTextStep
                id="microAdjustment"
                label="Un micro-ajustement concret pour la semaine prochaine."
                hint="Petit, testable, sous ton contrôle. Pas un grand plan, un seul levier."
                value={draft.microAdjustment}
                onChange={(v) => update('microAdjustment', v)}
                error={errors?.microAdjustment}
                placeholder="La semaine prochaine, j'ajuste précisément…"
              />
            ) : (
              <FreeTextStep
                id="transversalLesson"
                label="La leçon transversale de la semaine."
                hint="Ce que tu retiens au-delà d'un backtest précis, une phrase qui te servira longtemps."
                value={draft.transversalLesson}
                onChange={(v) => update('transversalLesson', v)}
                error={errors?.transversalLesson}
                placeholder="Ce que cette semaine d'entraînement m'apprend sur ma manière de pratiquer…"
              />
            )}
          </m.div>
        </AnimatePresence>
      </div>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (anti Black-Hat):
          keyboard/SR users learn WHY "Suivant"/"Enregistrer" is disabled instead
          of meeting a silent dead control (a11y WCAG 3.3.1). */}
      <p className="sr-only" role="status" aria-live="polite">
        {step < STEP_DEFS.length - 1
          ? stepValid
            ? ''
            : `Écris au moins ${TRAINING_DEBRIEF_TEXT_MIN_CHARS} caractères pour passer à l'étape suivante.`
          : stepValid
            ? ''
            : `Écris au moins ${TRAINING_DEBRIEF_TEXT_MIN_CHARS} caractères pour enregistrer ton débrief.`}
      </p>

      {/* Sticky bottom CTA bar — DS-v2 (no `.v18-glass`), safe-area aware. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-[var(--b-default)] bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as StepIndex)}
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
            onClick={() => setStep((step + 1) as StepIndex)}
            disabled={!stepValid}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid
                ? 'bg-[var(--acc-btn)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
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
                ? 'bg-[var(--acc-btn)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Envoi…' : 'Enregistrer mon débrief'}
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
        className="rounded-pill mt-1 flex h-10 w-10 shrink-0 items-center justify-center border"
        style={{
          background: 'var(--cy-dim)',
          borderColor: 'var(--cy-edge)',
          color: 'var(--cy)',
          // DS-v3 focal glow — a calm cyan halo on the step's icon (the premium
          // focal point, anti Black-Hat: a soft halo, no pulse). Mirror of the
          // mindset wizard's --acc-glow, in the §21.7 training cyan.
          boxShadow: 'var(--cy-glow)',
        }}
      >
        <Icon size={18} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="t-eyebrow text-[var(--t-3)]">{eyebrow}</p>
        <h2 id="tdw-heading" ref={headingRef} tabIndex={-1} className="t-h1 mt-1 text-[var(--t-1)]">
          {def.title}
        </h2>
      </div>
    </header>
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
}

function FreeTextStep(props: FreeTextStepProps) {
  const { id, label, hint, value, onChange, error, placeholder } = props;
  const charCount = value.length;
  const isOverMax = charCount > TRAINING_DEBRIEF_TEXT_MAX_CHARS;
  const isUnderMin = charCount > 0 && value.trim().length < TRAINING_DEBRIEF_TEXT_MIN_CHARS;
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
        maxLength={TRAINING_DEBRIEF_TEXT_MAX_CHARS + 100} // soft cap; server hard-caps
        rows={6}
        className="rounded-input w-full resize-y border bg-[var(--bg-2)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus:border-[var(--cy)] focus:shadow-[0_0_0_3px_var(--cy-dim-strong)] focus:outline-none"
        style={{
          borderColor: error ? 'oklch(0.7 0.165 22 / 0.55)' : 'var(--b-strong)',
          minHeight: '160px',
        }}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      />
      <div className="flex items-baseline justify-between gap-3">
        <p
          id={`${id}-counter`}
          aria-live="polite"
          aria-atomic="true"
          className={cn('t-cap font-mono tabular-nums', counterTone)}
        >
          {charCount} / {TRAINING_DEBRIEF_TEXT_MAX_CHARS}
          {charCount > 0 && charCount < TRAINING_DEBRIEF_TEXT_MIN_CHARS ? (
            <span className="ml-2">
              ({TRAINING_DEBRIEF_TEXT_MIN_CHARS - charCount} caractères de plus pour valider)
            </span>
          ) : null}
        </p>
        <p className="t-cap text-[var(--t-3)]">Min. {TRAINING_DEBRIEF_TEXT_MIN_CHARS} caractères</p>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
