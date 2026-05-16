'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, NotebookPen, UtensilsCrossed } from 'lucide-react';
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
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics';
import { HABIT_NOTES_MAX_CHARS } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

/**
 * V2.1.1 TRACK — Nutrition wizard (carbon `<SleepHabitWizard>`).
 *
 * Posture : 2 steps max — habit log < 30 s mobile. Nutrition quality is
 * inherently subjective (no objective "zone"), so the pedagogical surface
 * is a 4-level quality selector + a meals count, not a zones bar (the
 * subagent verdict for V2.1.1 explicitly excluded a NutritionZonesBar).
 *
 * Steps :
 *   1. **Repas & qualité** : meals count (0–10) + optional 4-level quality
 *   2. **Notes + confirm** : optional textarea max 500 chars + submit
 *
 * Server Action `submitHabitLogAction` re-parses the full Zod schema —
 * client-side validation is UX only.
 */

const STEP_TITLES = ['Repas & qualité', 'Notes & confirmation'] as const;
const STEP_ICONS = [UtensilsCrossed, NotebookPen] as const;
type StepIndex = 0 | 1;

type NutritionQuality = 'poor' | 'fair' | 'good' | 'excellent';
const QUALITY_OPTIONS: { value: NutritionQuality; label: string }[] = [
  { value: 'poor', label: 'Pauvre' },
  { value: 'fair', label: 'Correct' },
  { value: 'good', label: 'Bon' },
  { value: 'excellent', label: 'Excellent' },
];

interface DraftState {
  date: string;
  mealsCount: string;
  quality: NutritionQuality | '';
  notes: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:track:nutrition:draft:v1';

function localToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(today: string): DraftState {
  return { date: today, mealsCount: '', quality: '', notes: '' };
}

function loadDraft(today: string): DraftState {
  if (typeof window === 'undefined') return emptyDraft(today);
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft(today);
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return { ...emptyDraft(today), ...parsed, date: today };
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

/** Parse FR-locale decimals : "3" → 3. Returns NaN if invalid. */
function parseLocaleNumber(s: string): number {
  if (s.trim().length === 0) return Number.NaN;
  return Number(s.replace(',', '.'));
}

function validateStep(step: StepIndex, draft: DraftState): string | null {
  if (step === 0) {
    const n = parseLocaleNumber(draft.mealsCount);
    if (Number.isNaN(n)) return 'Saisis ton nombre de repas.';
    if (!Number.isInteger(n)) return 'Un nombre entier de repas est attendu.';
    if (n < 0 || n > 10) return 'Le nombre de repas doit être entre 0 et 10.';
  }
  return null;
}

export function NutritionHabitWizard() {
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasMounted(true);
    setDraft(loadDraft(today));
  }, [today]);

  useEffect(() => {
    if (!hasMounted) return;
    persistDraft(draft);
  }, [draft, hasMounted]);

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
    if (step > 0) goToStep((step - 1) as StepIndex);
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

  useEffect(() => {
    if (serverState?.ok) {
      hapticSuccess();
      clearDraft();
    } else if (serverState?.ok === false) {
      hapticError();
    }
  }, [serverState]);

  const mealsNum = parseLocaleNumber(draft.mealsCount);
  const hasValidMeals =
    !Number.isNaN(mealsNum) && Number.isInteger(mealsNum) && mealsNum >= 0 && mealsNum <= 10;
  const StepIcon = STEP_ICONS[step]!;
  const totalSteps = STEP_TITLES.length;
  const animate = hasMounted && !prefersReducedMotion;

  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
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

      {serverState?.ok === false ? (
        <Alert tone="danger" role="alert">
          {serverState.error === 'unauthorized' && "Tu n'es plus connecté(e). Recharge la page."}
          {serverState.error === 'invalid_input' && 'Vérifie les champs — un détail ne passe pas.'}
          {serverState.error === 'persist_failed' &&
            'Le serveur a hoqueté — réessaie dans un instant.'}
        </Alert>
      ) : null}

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
              <NutritionStep
                draft={draft}
                setDraft={setDraft}
                stepError={stepError}
                headingRef={headingRef}
              />
            ) : (
              <NutritionNotesStep draft={draft} setDraft={setDraft} headingRef={headingRef} />
            )}
          </m.div>
        </AnimatePresence>
      </div>

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
              fd.set('kind', 'nutrition');
              fd.set('date', draft.date);
              fd.set('value.mealsCount', String(Math.round(mealsNum)));
              if (draft.quality) {
                fd.set('value.quality', draft.quality);
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
              disabled={isPending || !hasValidMeals}
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

interface StepProps {
  draft: DraftState;
  setDraft: (updater: (prev: DraftState) => DraftState) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  stepError?: string | null;
}

function NutritionStep({ draft, setDraft, stepError, headingRef }: StepProps) {
  return (
    <Card className="space-y-5 p-4">
      <header className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-semibold tracking-tight text-[var(--t-1)] outline-none"
        >
          Combien de repas aujourd&apos;hui ?
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Des repas réguliers stabilisent ta glycémie — un cerveau sans à-coups décide plus
          posément. Note ta qualité ressentie en complément.
        </p>
      </header>

      <div className="space-y-3">
        <label htmlFor="nutrition-meals" className="t-eyebrow-lg text-[var(--t-3)]">
          Nombre de repas
        </label>
        <div className="flex items-baseline gap-2">
          <input
            id="nutrition-meals"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={draft.mealsCount}
            onChange={(e) => setDraft((d) => ({ ...d, mealsCount: e.target.value }))}
            placeholder="3"
            className="rounded-input w-28 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 font-mono text-[18px] text-[var(--t-1)] tabular-nums outline-none focus-visible:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-invalid={stepError ? 'true' : 'false'}
            aria-describedby={stepError ? 'nutrition-meals-error' : undefined}
          />
          <span className="text-[14px] text-[var(--t-3)]">repas</span>
        </div>
        {stepError ? (
          <p id="nutrition-meals-error" className="text-[12px] text-[var(--bad)]" role="alert">
            {stepError}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <span id="nutrition-quality-label" className="t-eyebrow-lg block text-[var(--t-3)]">
          Qualité ressentie <span className="normal-case">(optionnel)</span>
        </span>
        <div
          role="group"
          aria-labelledby="nutrition-quality-label"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {QUALITY_OPTIONS.map((opt) => {
            const selected = draft.quality === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    quality: d.quality === opt.value ? '' : opt.value,
                  }))
                }
                className={cn(
                  'rounded-input flex min-h-11 items-center justify-center border px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                  selected
                    ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]'
                    : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function NutritionNotesStep({ draft, setDraft, headingRef }: StepProps) {
  const remaining = HABIT_NOTES_MAX_CHARS - draft.notes.length;
  const qualityLabel = QUALITY_OPTIONS.find((o) => o.value === draft.quality)?.label ?? '—';
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
          Optionnel. Si tu veux noter un contexte (repas sauté, fringale, écart), ça nourrit ton
          rapport hebdo IA dimanche.
        </p>
      </header>

      <div className="space-y-2">
        <label htmlFor="nutrition-notes" className="t-eyebrow-lg text-[var(--t-3)]">
          Note
        </label>
        <textarea
          id="nutrition-notes"
          rows={5}
          value={draft.notes}
          onChange={(e) =>
            setDraft((d) => ({ ...d, notes: e.target.value.slice(0, HABIT_NOTES_MAX_CHARS) }))
          }
          maxLength={HABIT_NOTES_MAX_CHARS}
          placeholder="Déjeuner sauté, grosse fringale 16h, dîner léger…"
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
          <dt className="text-[var(--t-3)]">Repas</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">{draft.mealsCount}</dd>
          <dt className="text-[var(--t-3)]">Qualité</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">{qualityLabel}</dd>
        </dl>
      </div>
    </Card>
  );
}
