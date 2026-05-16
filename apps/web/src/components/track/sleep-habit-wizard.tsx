'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Moon, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from 'react';

import { submitHabitLogAction, type TrackActionState } from '@/app/track/actions';
import { Alert } from '@/components/alert';
import { ScoreSlider } from '@/components/checkin/score-slider';
import { SleepZonesBar } from '@/components/checkin/sleep-zones-bar';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics';
import { HABIT_NOTES_MAX_CHARS } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

/**
 * V2.1 TRACK — Sleep wizard (clone J5 morning-checkin-wizard pattern).
 *
 * Posture : 2 steps max — habit log doit être &lt;30s mobile (subagent
 * V2.1 research verdict). Le luxe Fxmily = respect du temps trader,
 * pas du chrome ostentatoire.
 *
 * Steps :
 *   1. **Durée + qualité** : input hours (FR comma support) → SleepZonesBar
 *      live update (canon pédagogique J5) + ScoreSlider quality 1-10
 *      (optional — anchor Walker + Steenbarger)
 *   2. **Notes + confirm** : textarea optional max 500 chars + submit
 *
 * State management : `useState` + localStorage draft `fxmily:track:sleep:draft:v1`,
 * Framer Motion `<AnimatePresence mode="wait">` slide horizontal (x: direction*28),
 * `useReducedMotion()` SSR-safe (V1.9 polish pattern), haptic feedback on
 * step transitions + submit success/error (J5 carbone).
 *
 * Server Action : `submitHabitLogAction` re-parses with full Zod schema —
 * client-side validation is UX only.
 */

const STEP_TITLES = ['Durée & qualité', 'Notes & confirmation'] as const;
const STEP_ICONS = [Moon, NotebookPen] as const;
type StepIndex = 0 | 1;

interface DraftState {
  date: string;
  sleepHours: string;
  sleepQuality: number; // 1-10
  notes: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:track:sleep:draft:v1';

function localToday(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function emptyDraft(today: string): DraftState {
  return {
    date: today,
    sleepHours: '',
    sleepQuality: 6,
    notes: '',
  };
}

function loadDraft(today: string): DraftState {
  if (typeof window === 'undefined') return emptyDraft(today);
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft(today);
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      ...emptyDraft(today),
      ...parsed,
      // Anchor to today on hydrate — yesterday's draft would silently mis-attribute.
      date: today,
    };
  } catch {
    return emptyDraft(today);
  }
}

function persistDraft(draft: DraftState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota exceeded — non-blocking */
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const SLEEP_QUALITY_LABEL = (v: number): string => {
  if (v <= 3) return 'Mauvais';
  if (v <= 5) return 'Moyen';
  if (v <= 7) return 'Bon';
  return 'Excellent';
};

/** Parse FR-locale decimals : "7,5" → 7.5. Returns NaN if invalid. */
function parseLocaleNumber(s: string): number {
  if (s.trim().length === 0) return Number.NaN;
  return Number(s.replace(',', '.'));
}

/**
 * Validate the current step's required fields. Returns `null` when valid,
 * otherwise an error message scoped to the step.
 */
function validateStep(step: StepIndex, draft: DraftState): string | null {
  if (step === 0) {
    const h = parseLocaleNumber(draft.sleepHours);
    if (Number.isNaN(h)) return 'Saisis tes heures de sommeil.';
    if (h < 0 || h > 24) return 'La durée doit être entre 0 et 24h.';
  }
  return null;
}

export function SleepHabitWizard() {
  const prefersReducedMotion = useReducedMotion();
  const [hasMounted, setHasMounted] = useState(false);
  const [today] = useState(() => localToday());
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(today));
  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverState, formAction] = useActionState<TrackActionState | null, FormData>(
    submitHabitLogAction,
    null,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Hydrate localStorage on mount only — avoids SSR/CSR mismatch. The
  // setState-in-effect is intentional and canonical Fxmily (J5
  // morning-checkin-wizard + sleep-zones-bar carbone) : localStorage is
  // unavailable at SSR so the draft MUST be read post-mount. Lazy
  // `useState(() => emptyDraft())` keeps the first paint deterministic ;
  // this effect swaps in the persisted draft exactly once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasMounted(true);
    setDraft(loadDraft(today));
  }, [today]);

  // Persist on change once hydrated.
  useEffect(() => {
    if (!hasMounted) return;
    persistDraft(draft);
  }, [draft, hasMounted]);

  // Focus the step heading on transition for screen-readers (APG wizard).
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function goToStep(next: StepIndex) {
    setStepError(null);
    setDirection(next > step ? 1 : -1);
    setStep(next);
    hapticTap();
  }

  function handleNext() {
    const err = validateStep(step, draft);
    if (err) {
      setStepError(err);
      hapticError();
      return;
    }
    if (step < STEP_TITLES.length - 1) {
      goToStep((step + 1) as StepIndex);
    }
  }

  function handlePrev() {
    if (step > 0) {
      goToStep((step - 1) as StepIndex);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowRight' && step < STEP_TITLES.length - 1) {
      e.preventDefault();
      handleNext();
    } else if (e.key === 'ArrowLeft' && step > 0) {
      e.preventDefault();
      handlePrev();
    }
  }

  // Server feedback handling — clear draft + haptic on success ; haptic on error.
  useEffect(() => {
    if (serverState?.ok) {
      hapticSuccess();
      clearDraft();
    } else if (serverState?.ok === false) {
      hapticError();
    }
  }, [serverState]);

  const sleepHoursNum = parseLocaleNumber(draft.sleepHours);
  const hasValidHours = !Number.isNaN(sleepHoursNum);
  const StepIcon = STEP_ICONS[step]!;
  const totalSteps = STEP_TITLES.length;
  const animate = hasMounted && !prefersReducedMotion;

  // The hidden form is mounted whenever — we submit at step 1.
  // Server expects `value.durationMin` (int). Client surfaces hours.
  const durationMin = hasValidHours ? Math.round(sleepHoursNum * 60) : '';

  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
      {/* Step progress bar — APG sr-only ordered list pattern V1.8 carbone. */}
      <div className="space-y-2" role="group" aria-label="Progression du wizard">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StepIcon className="h-4 w-4 text-[var(--acc)]" aria-hidden />
            <span className="t-eyebrow-lg text-[var(--t-3)]">
              Étape <span className="font-mono tabular-nums">{step + 1}</span> /{' '}
              <span className="font-mono tabular-nums">{totalSteps}</span>
            </span>
          </div>
          <Link
            href="/track"
            className="text-[12px] font-medium text-[var(--t-3)] hover:text-[var(--t-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          >
            Annuler
          </Link>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--bg-3)]">
          <m.div
            className="h-full bg-[var(--acc)]"
            initial={false}
            animate={{ scaleX: (step + 1) / totalSteps }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: '0% 50%' }}
          />
        </div>
        <ol className="sr-only">
          {STEP_TITLES.map((title, i) => (
            <li key={title} aria-current={i === step ? 'step' : undefined}>
              {title}
            </li>
          ))}
        </ol>
      </div>

      {/* Server error banner (after submit) */}
      {serverState?.ok === false ? (
        <Alert tone="danger" role="alert">
          {serverState.error === 'unauthorized' && "Tu n'es plus connecté(e). Recharge la page."}
          {serverState.error === 'invalid_input' && 'Vérifie les champs — un détail ne passe pas.'}
          {serverState.error === 'persist_failed' &&
            'Le serveur a hoqueté — réessaie dans un instant.'}
        </Alert>
      ) : null}

      {/* Steps */}
      <div className="relative min-h-[280px]">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={step}
            initial={animate ? { opacity: 0, x: direction * 28 } : false}
            animate={{ opacity: 1, x: 0 }}
            exit={animate ? { opacity: 0, x: -direction * 28 } : { opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 ? (
              <SleepDurationStep
                draft={draft}
                setDraft={setDraft}
                stepError={stepError}
                headingRef={headingRef}
              />
            ) : (
              <SleepNotesStep draft={draft} setDraft={setDraft} headingRef={headingRef} />
            )}
          </m.div>
        </AnimatePresence>
      </div>

      {/* Sticky bottom CTA bar — iOS safe-area-inset aware */}
      <div
        className={cn(
          'sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-[var(--b-default)] bg-[var(--bg)] px-4 pt-3',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        )}
      >
        <Btn
          type="button"
          kind="ghost"
          size="m"
          onClick={handlePrev}
          disabled={step === 0 || isPending}
          aria-label="Étape précédente"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>Retour</span>
        </Btn>

        {step < totalSteps - 1 ? (
          <Btn
            type="button"
            kind="primary"
            size="m"
            onClick={handleNext}
            disabled={isPending}
            aria-label="Étape suivante"
          >
            <span>Suivant</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Btn>
        ) : (
          <form
            action={(fd) => {
              // Inject hidden fields right before submit.
              fd.set('kind', 'sleep');
              fd.set('date', draft.date);
              fd.set('value.durationMin', String(durationMin));
              if (draft.sleepQuality >= 1 && draft.sleepQuality <= 10) {
                fd.set('value.quality', String(draft.sleepQuality));
              }
              if (draft.notes.trim().length > 0) {
                fd.set('notes', draft.notes.trim());
              }
              startTransition(() => {
                formAction(fd);
              });
            }}
          >
            <Btn
              type="submit"
              kind="primary"
              size="m"
              disabled={isPending || !hasValidHours}
              aria-busy={isPending}
            >
              {isPending ? (
                <span>Enregistrement…</span>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  <span>Logger</span>
                </>
              )}
            </Btn>
          </form>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Step components
// =============================================================================

interface StepProps {
  draft: DraftState;
  setDraft: (updater: (prev: DraftState) => DraftState) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  stepError?: string | null;
}

function SleepDurationStep({ draft, setDraft, stepError, headingRef }: StepProps) {
  const hours = parseLocaleNumber(draft.sleepHours);
  const hoursForBar = Number.isNaN(hours) ? null : hours;

  return (
    <Card className="space-y-5 p-4">
      <header className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-semibold tracking-tight text-[var(--t-1)] outline-none"
        >
          Combien d&apos;heures as-tu dormi ?
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Saisis-le en heures décimales : <code className="font-mono">7,5</code> pour 7h30. Note ta
          qualité ressentie en complément.
        </p>
      </header>

      <div className="space-y-3">
        <label htmlFor="sleep-hours" className="t-eyebrow-lg text-[var(--t-3)]">
          Durée
        </label>
        <div className="flex items-baseline gap-2">
          <input
            id="sleep-hours"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft.sleepHours}
            onChange={(e) => setDraft((d) => ({ ...d, sleepHours: e.target.value }))}
            placeholder="7,5"
            className="rounded-input w-28 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 font-mono text-[18px] text-[var(--t-1)] tabular-nums outline-none focus-visible:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-invalid={stepError ? 'true' : 'false'}
            aria-describedby={stepError ? 'sleep-hours-error' : undefined}
          />
          <span className="text-[14px] text-[var(--t-3)]">heures</span>
        </div>
        {stepError ? (
          <p id="sleep-hours-error" className="text-[12px] text-[var(--bad)]" role="alert">
            {stepError}
          </p>
        ) : null}
      </div>

      <SleepZonesBar hours={hoursForBar} />

      <div className="space-y-3 pt-2">
        <ScoreSlider
          name="sleep-quality"
          label="Qualité ressentie"
          value={draft.sleepQuality}
          onChange={(v) => setDraft((d) => ({ ...d, sleepQuality: v }))}
          describeAt={SLEEP_QUALITY_LABEL}
          tone="acc"
        />
      </div>
    </Card>
  );
}

function SleepNotesStep({ draft, setDraft, headingRef }: StepProps) {
  const remaining = HABIT_NOTES_MAX_CHARS - draft.notes.length;
  return (
    <Card className="space-y-4 p-4">
      <header className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-semibold tracking-tight text-[var(--t-1)] outline-none"
        >
          Une note pour toi ?
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Optionnel. Si tu veux noter un contexte (réveil nocturne, voyage, écran tard), ça nourrit
          ton rapport hebdo IA dimanche.
        </p>
      </header>

      <div className="space-y-2">
        <label htmlFor="sleep-notes" className="t-eyebrow-lg text-[var(--t-3)]">
          Note
        </label>
        <textarea
          id="sleep-notes"
          rows={5}
          value={draft.notes}
          onChange={(e) =>
            setDraft((d) => ({ ...d, notes: e.target.value.slice(0, HABIT_NOTES_MAX_CHARS) }))
          }
          maxLength={HABIT_NOTES_MAX_CHARS}
          placeholder="Réveil 3h, lait écrémé avant lit, écran arrêté à 22h…"
          className="rounded-input w-full resize-y border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[14px] leading-relaxed text-[var(--t-1)] outline-none focus-visible:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        />
        <p
          className={cn(
            'text-right font-mono text-[11px] tabular-nums',
            remaining < 50 ? 'text-[var(--warn)]' : 'text-[var(--t-3)]',
          )}
        >
          {draft.notes.length}/{HABIT_NOTES_MAX_CHARS}
        </p>
      </div>

      <div className="rounded-input border border-[var(--b-default)] bg-[var(--bg-2)] p-3.5">
        <h3 className="t-eyebrow-lg mb-2 text-[var(--t-3)]">Récapitulatif</h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-[var(--t-3)]">Durée</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">{draft.sleepHours} h</dd>
          <dt className="text-[var(--t-3)]">Qualité</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">
            {draft.sleepQuality}/10 — {SLEEP_QUALITY_LABEL(draft.sleepQuality)}
          </dd>
        </dl>
      </div>
    </Card>
  );
}
