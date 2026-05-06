'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Coffee,
  Heart,
  Moon,
  Shield,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { submitEveningCheckinAction, type CheckinActionState } from '@/app/checkin/actions';
import { Alert } from '@/components/alert';
import { EmotionCheckinPicker } from '@/components/checkin/emotion-checkin-picker';
import { ScoreSlider } from '@/components/checkin/score-slider';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Mobile-first wizard for the evening check-in (J5, SPEC §7.4).
 *
 * 5 steps:
 *   1. Discipline — plan respected + hedge respected (tri-state)
 *   2. Hydratation & caféine — 2 optional numeric fields
 *   3. Stress — slider 1-10
 *   4. Mental — mood slider + emotion tags
 *   5. Réflexion — journal note + 3 gratitudes (optional)
 */

const STEP_TITLES = [
  'Discipline du jour',
  'Hydratation & caféine',
  'Stress',
  'Mental',
  'Réflexion',
] as const;
const STEP_ICONS = [Shield, Coffee, Sparkles, Heart, BookOpen] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

interface DraftState {
  date: string;
  planRespectedToday: boolean | null;
  hedgeRespectedToday: 'true' | 'false' | 'na' | '';
  caffeineMl: string;
  waterLiters: string;
  stressScore: number;
  moodScore: number;
  emotionTags: string[];
  journalNote: string;
  gratitudeItems: [string, string, string];
}

const DRAFT_STORAGE_KEY = 'fxmily:checkin:evening:draft:v1';

function emptyDraft(today: string): DraftState {
  return {
    date: today,
    planRespectedToday: null,
    hedgeRespectedToday: '',
    caffeineMl: '',
    waterLiters: '',
    stressScore: 5,
    moodScore: 6,
    emotionTags: [],
    journalNote: '',
    gratitudeItems: ['', '', ''],
  };
}

function loadDraft(today: string): DraftState {
  if (typeof window === 'undefined') return emptyDraft(today);
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft(today);
    const parsed = JSON.parse(raw) as Partial<DraftState> & {
      gratitudeItems?: unknown;
    };
    const base = emptyDraft(today);
    return {
      ...base,
      ...parsed,
      date: today,
      gratitudeItems: Array.isArray(parsed.gratitudeItems)
        ? ([0, 1, 2].map((i) => String(parsed.gratitudeItems?.[i] ?? '')) as [
            string,
            string,
            string,
          ])
        : base.gratitudeItems,
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
    /* ignore */
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

const STRESS_LABEL = (v: number): string => {
  if (v <= 2) return 'Très bas';
  if (v <= 4) return 'Calme';
  if (v <= 6) return 'Mesuré';
  if (v <= 8) return 'Élevé';
  return 'Très élevé';
};

const MOOD_LABEL = (v: number): string => {
  if (v <= 3) return 'Difficile';
  if (v <= 5) return 'Neutre';
  if (v <= 7) return 'Bien';
  if (v <= 9) return 'Très bien';
  return 'Excellent';
};

interface EveningCheckinWizardProps {
  today: string;
}

export function EveningCheckinWizard({ today }: EveningCheckinWizardProps) {
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(today));
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(today));
    setHydrated(true);
  }, [today]);

  useEffect(() => {
    if (hydrated) persistDraft(draft);
  }, [draft, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    headingRef.current?.focus();
  }, [step, hydrated]);

  const update = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const updateGratitude = (idx: 0 | 1 | 2, value: string) => {
    setDraft((d) => {
      const next = [...d.gratitudeItems] as [string, string, string];
      next[idx] = value.slice(0, 200);
      return { ...d, gratitudeItems: next };
    });
  };

  const goToStep = (s: StepIndex) => {
    setDirection(s > step ? 1 : -1);
    setStep(s);
    setFieldErrors({});
    setServerError(null);
  };

  const validateStep = (s: StepIndex): boolean => {
    const errs: Record<string, string> = {};
    if (s === 0) {
      if (draft.planRespectedToday === null) {
        errs.planRespectedToday = 'Réponds avant de continuer.';
      }
      if (draft.hedgeRespectedToday === '') {
        errs.hedgeRespectedToday = 'Réponds avant de continuer.';
      }
    }
    if (s === 1) {
      if (draft.caffeineMl !== '') {
        const n = Number(draft.caffeineMl);
        if (Number.isNaN(n) || n < 0 || n > 2000) errs.caffeineMl = 'Entre 0 et 2000 mL.';
      }
      if (draft.waterLiters !== '') {
        const n = Number(draft.waterLiters);
        if (Number.isNaN(n) || n < 0 || n > 10) errs.waterLiters = 'Entre 0 et 10 L.';
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (!validateStep(step)) return;
    if (step < 4) goToStep((step + 1) as StepIndex);
  };
  const prev = () => {
    if (step > 0) goToStep((step - 1) as StepIndex);
  };

  const submit = () => {
    if (pending) return;
    if (!validateStep(0) || !validateStep(1)) {
      setServerError('Certains champs sont incomplets — reviens en arrière.');
      return;
    }

    const fd = new FormData();
    fd.set('date', draft.date);
    fd.set('planRespectedToday', String(draft.planRespectedToday ?? false));
    fd.set('hedgeRespectedToday', draft.hedgeRespectedToday);
    fd.set('caffeineMl', draft.caffeineMl);
    fd.set('waterLiters', draft.waterLiters);
    fd.set('stressScore', String(draft.stressScore));
    fd.set('moodScore', String(draft.moodScore));
    fd.set('journalNote', draft.journalNote.trim());
    for (const slug of draft.emotionTags) fd.append('emotionTags', slug);
    for (const item of draft.gratitudeItems) {
      // Always send all 3 slots (empties dropped server-side).
      fd.append('gratitudeItems', item);
    }

    startTransition(async () => {
      const result: CheckinActionState = await submitEveningCheckinAction(null, fd);
      if (result.ok) {
        clearDraft();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setServerError(serverErrorMessage(result));
    });
  };

  const StepIcon = STEP_ICONS[step];

  return (
    <section
      aria-labelledby="checkin-heading"
      className="mx-auto flex w-full max-w-xl flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/checkin"
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retour
          </Link>
          <span className="font-mono text-[11px] tabular-nums text-[var(--t-3)]" aria-live="polite">
            Étape{' '}
            <span className="font-semibold text-[var(--acc)]">
              {String(step + 1).padStart(2, '0')}
            </span>
            <span className="text-[var(--t-4)]"> / 05</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <StepIcon className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="t-eyebrow flex items-center gap-1.5">
              <Moon className="h-3 w-3" strokeWidth={1.75} aria-hidden /> Check-in soir
            </span>
            <h1
              id="checkin-heading"
              ref={headingRef}
              tabIndex={-1}
              className="f-display text-[20px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--t-1)] sm:text-[24px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {STEP_TITLES[step]}
            </h1>
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuetext={`Étape ${step + 1} sur 5`}
          aria-label="Progression du check-in soir"
          className="flex w-full gap-1"
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'rounded-pill h-1 flex-1 transition-all duration-300',
                i < step
                  ? 'bg-[var(--acc)]'
                  : i === step
                    ? 'bg-[var(--acc)] shadow-[0_0_8px_oklch(0.879_0.231_130_/_0.55)]'
                    : 'bg-[var(--b-default)]',
              )}
            />
          ))}
        </div>
      </header>

      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

      <div className="relative min-h-[20rem]">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={
              prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * 28 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * -28 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex flex-col gap-5"
          >
            {step === 0 ? (
              <StepDiscipline
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 1 ? (
              <StepHydration
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 2 ? (
              <ScoreSlider
                name="stressScore"
                value={draft.stressScore}
                onChange={(v) => update('stressScore', v)}
                label="Stress moyen aujourd’hui"
                describeAt={STRESS_LABEL}
                tone="warn"
                disabled={pending}
                hint="1 = très calme, 10 = sous tension constante."
              />
            ) : null}
            {step === 3 ? (
              <StepMind
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 4 ? (
              <StepReflection
                draft={draft}
                update={update}
                updateGratitude={updateGratitude}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <nav
        aria-label="Navigation du check-in soir"
        className="bg-[var(--bg)]/95 supports-[backdrop-filter]:bg-[var(--bg)]/80 sticky bottom-0 -mx-4 flex flex-col gap-1 border-t border-[var(--b-default)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-2">
          <Btn
            kind="secondary"
            size="m"
            onClick={prev}
            disabled={step === 0 || pending}
            type="button"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Précédent
          </Btn>
          {step < 4 ? (
            <Btn kind="primary" size="m" onClick={next} disabled={pending} type="button">
              Suivant
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Btn>
          ) : (
            <Btn
              kind="primary"
              size="m"
              onClick={submit}
              disabled={pending}
              loading={pending}
              type="button"
            >
              {pending ? 'Enregistrement…' : 'Enregistrer ma soirée'}
            </Btn>
          )}
        </div>
      </nav>
    </section>
  );
}

// ============================================================================
// STEPS
// ============================================================================

interface StepProps {
  draft: DraftState;
  update: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
  fieldErrors: Record<string, string>;
  disabled?: boolean | undefined;
}

function StepDiscipline({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <RadioGroup
        legend="Plan de trading respecté ?"
        name="planRespectedToday"
        value={draft.planRespectedToday === null ? '' : String(draft.planRespectedToday)}
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Non' },
        ]}
        onChange={(v) => update('planRespectedToday', v === 'true')}
        disabled={disabled}
        error={fieldErrors.planRespectedToday}
      />
      <RadioGroup
        legend="Hedge respecté ?"
        name="hedgeRespectedToday"
        value={draft.hedgeRespectedToday}
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Non' },
          { value: 'na', label: 'N/A' },
        ]}
        onChange={(v) => update('hedgeRespectedToday', v as DraftState['hedgeRespectedToday'])}
        disabled={disabled}
        error={fieldErrors.hedgeRespectedToday}
      />

      <Card className="flex items-start gap-2.5 p-4">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cy)]" strokeWidth={1.75} />
        <p className="t-cap text-[var(--t-3)]">
          Ce sont les seuls jugements binaires de la journée. Pas d’explication à fournir — on
          mesure le respect, pas l’intention.
        </p>
      </Card>
    </div>
  );
}

function StepHydration({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <NumericField
        id="caffeineMl"
        label="Caféine totale (mL, optionnel)"
        value={draft.caffeineMl}
        onChange={(v) => update('caffeineMl', v)}
        error={fieldErrors.caffeineMl}
        disabled={disabled}
        step="50"
        inputMode="numeric"
        placeholder="0"
        hint="Estimation. Café espresso ≈ 30 mL, mug café ≈ 250 mL."
      />
      <NumericField
        id="waterLiters"
        label="Eau bue (L, optionnel)"
        value={draft.waterLiters}
        onChange={(v) => update('waterLiters', v)}
        error={fieldErrors.waterLiters}
        disabled={disabled}
        step="0.25"
        inputMode="decimal"
        placeholder="2"
      />
    </div>
  );
}

function StepMind({ draft, update, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <ScoreSlider
        name="moodScore"
        value={draft.moodScore}
        onChange={(v) => update('moodScore', v)}
        label="Humeur moyenne aujourd’hui"
        describeAt={MOOD_LABEL}
        tone="acc"
        disabled={disabled}
        hint="Sur la journée entière, pas le sentiment de l’instant."
      />
      <EmotionCheckinPicker
        value={draft.emotionTags}
        onChange={(v) => update('emotionTags', v)}
        name="emotionTags"
        label="Émotions dominantes (optionnel)"
        disabled={disabled}
      />
    </div>
  );
}

function StepReflection({
  draft,
  update,
  updateGratitude,
  fieldErrors,
  disabled,
}: StepProps & {
  updateGratitude: (idx: 0 | 1 | 2, value: string) => void;
}) {
  const journalChars = draft.journalNote.length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="journalNote"
            className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]"
          >
            Journal libre (optionnel)
          </label>
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              journalChars > 3500 ? 'text-[var(--warn)]' : 'text-[var(--t-4)]',
            )}
            aria-live="polite"
          >
            {journalChars}/4000
          </span>
        </div>
        <textarea
          id="journalNote"
          name="journalNote"
          value={draft.journalNote}
          onChange={(e) => update('journalNote', e.target.value.slice(0, 4000))}
          disabled={disabled}
          rows={4}
          maxLength={4000}
          placeholder="Une pensée, un moment, un déclic, une frustration…"
          aria-invalid={fieldErrors.journalNote ? 'true' : undefined}
          className={cn(
            'rounded-input w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] outline-none transition-[border-color,box-shadow] duration-150',
            'placeholder:text-[var(--t-4)]',
            fieldErrors.journalNote
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]">
          3 gratitudes (optionnel)
        </legend>
        {([0, 1, 2] as const).map((i) => (
          <input
            key={i}
            type="text"
            value={draft.gratitudeItems[i]}
            onChange={(e) => updateGratitude(i, e.target.value)}
            disabled={disabled}
            placeholder={`Gratitude ${i + 1}`}
            maxLength={200}
            aria-label={`Gratitude ${i + 1}`}
            className={cn(
              'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] outline-none transition-[border-color,box-shadow] duration-150',
              'placeholder:text-[var(--t-4)]',
              'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          />
        ))}
        <p className="t-cap text-[var(--t-4)]">
          Trois choses pour lesquelles tu es reconnaissant aujourd’hui. Petites ou grandes.
        </p>
      </fieldset>
    </div>
  );
}

// ============================================================================
// Shared primitives (small enough to duplicate)
// ============================================================================

function NumericField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  step,
  inputMode,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string | undefined;
  disabled?: boolean | undefined;
  step?: string | undefined;
  inputMode?: 'decimal' | 'numeric' | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        step={step}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={cn(
          'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] tabular-nums text-[var(--t-1)] outline-none transition-[border-color,box-shadow] duration-150',
          'placeholder:text-[var(--t-4)]',
          error
            ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
            : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      {error ? (
        <p id={errorId} className="text-[11px] text-[var(--bad)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="t-cap text-[var(--t-4)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function RadioGroup({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  error,
}: {
  legend: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
}) {
  const firstValue = options[0]?.value ?? '';
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errorId}>
      <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.10em] text-[var(--t-3)]">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt.value;
          const tabbable = value === '' ? opt.value === firstValue : active;
          return (
            <label
              key={opt.value}
              className={cn(
                'rounded-pill inline-flex min-h-11 cursor-pointer items-center gap-2 border px-4 py-2 text-[13px] font-medium transition-all',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--acc)]',
                active
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[0_0_0_3px_oklch(0.879_0.231_130_/_0.10)]'
                  : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                disabled={disabled}
                tabIndex={tabbable ? 0 : -1}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function serverErrorMessage(state: CheckinActionState): string {
  switch (state.error) {
    case 'unauthorized':
      return 'Session expirée — reconnecte-toi puis réessaie.';
    case 'invalid_input':
      return 'Certains champs sont invalides — contrôle les étapes.';
    case 'unknown':
    default:
      return 'Erreur inattendue — réessaie dans un instant.';
  }
}
