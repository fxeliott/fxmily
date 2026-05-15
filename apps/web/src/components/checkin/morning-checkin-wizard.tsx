'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Coffee,
  Dumbbell,
  Heart,
  Moon,
  Sparkles,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from 'react';

import { submitMorningCheckinAction, type CheckinActionState } from '@/app/checkin/actions';
import { Alert } from '@/components/alert';
import { EmotionCheckinPicker } from '@/components/checkin/emotion-checkin-picker';
import { ScoreSlider } from '@/components/checkin/score-slider';
import { SleepZonesBar } from '@/components/checkin/sleep-zones-bar';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics';
import { MORNING_ROUTINE_SUGGESTIONS } from '@/lib/checkin/routine';
import { cn } from '@/lib/utils';

/**
 * Mobile-first wizard for the morning check-in (J5, SPEC §7.4).
 *
 * 5 steps:
 *   1. Sleep block — hours + quality slider
 *   2. Routine — yes/no toggle + suggestion list
 *   3. Body — meditation min + sport (optional)
 *   4. Mind — mood slider + emotion tags
 *   5. Intention — short text (optional)
 *
 * State management identical to the trade wizard: useState + localStorage
 * draft. Slide animation via Framer Motion. Server Action re-validates with
 * the Zod schema, returns `fieldErrors` we surface inline.
 */

const STEP_TITLES = [
  'Sommeil',
  'Routine matinale',
  'Corps',
  'Mental',
  'Intention du jour',
] as const;
const STEP_ICONS = [Moon, Sparkles, Dumbbell, Heart, Target] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

interface DraftState {
  date: string;
  sleepHours: string;
  sleepQuality: number;
  morningRoutineCompleted: boolean | null;
  meditationMin: string;
  sportType: string;
  sportDurationMin: string;
  moodScore: number;
  emotionTags: string[];
  intention: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:checkin:morning:draft:v1';

function emptyDraft(today: string): DraftState {
  return {
    date: today,
    sleepHours: '',
    sleepQuality: 6,
    morningRoutineCompleted: null,
    meditationMin: '0',
    sportType: '',
    sportDurationMin: '',
    moodScore: 6,
    emotionTags: [],
    intention: '',
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
      // Always anchor to today on hydrate — no point editing yesterday's draft.
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
  if (v <= 7) return 'Correct';
  if (v <= 9) return 'Bon';
  return 'Excellent';
};

const MOOD_LABEL = (v: number): string => {
  if (v <= 3) return 'Bof';
  if (v <= 5) return 'Neutre';
  if (v <= 7) return 'Calme';
  if (v <= 9) return 'Très bien';
  return 'Excellent';
};

interface MorningCheckinWizardProps {
  /** Server-provided "today" in the user's local timezone. */
  today: string;
}

export function MorningCheckinWizard({ today }: MorningCheckinWizardProps) {
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

  const goToStep = (s: StepIndex) => {
    setDirection(s > step ? 1 : -1);
    setStep(s);
    setFieldErrors({});
    setServerError(null);
    // Light tap on transitions — fires & forgets, no-op on iOS <18.
    hapticTap();
  };

  // Normalize FR decimal comma — `<input type="number" inputMode="decimal">`
  // accepts "7,5" on iOS Safari FR but Number("7,5") is NaN. Audit J5 (code H6).
  const parseLocaleNumber = (raw: string): number => Number(raw.replace(',', '.'));

  const validateStep = (s: StepIndex): boolean => {
    const errs: Record<string, string> = {};
    if (s === 0) {
      if (draft.sleepHours === '') errs.sleepHours = 'Indique tes heures de sommeil.';
      else {
        const n = parseLocaleNumber(draft.sleepHours);
        if (Number.isNaN(n) || n < 0 || n > 24) errs.sleepHours = 'Entre 0 et 24h.';
      }
    }
    if (s === 1 && draft.morningRoutineCompleted === null) {
      errs.morningRoutineCompleted = 'Sélection requise.';
    }
    if (s === 2) {
      const med = parseLocaleNumber(draft.meditationMin);
      if (Number.isNaN(med) || med < 0 || med > 240) {
        errs.meditationMin = 'Entre 0 et 240 min.';
      }
      const hasType = draft.sportType.trim().length > 0;
      const hasDuration = draft.sportDurationMin.trim().length > 0;
      if (hasType && !hasDuration) errs.sportDurationMin = 'Indique la durée.';
      if (!hasType && hasDuration) errs.sportType = 'Indique le type.';
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
    // Find the first invalid step and jump to it (a11y H2 audit fix).
    const invalidStep = ([0, 1, 2] as const).find((stepIndex) => !validateStep(stepIndex));
    if (invalidStep !== undefined) {
      setServerError('Certains champs sont incomplets — utilise « Précédent » pour les compléter.');
      goToStep(invalidStep as StepIndex);
      hapticError();
      return;
    }

    const fd = new FormData();
    fd.set('date', draft.date);
    // Normalize FR comma → dot before sending to the server (Zod parses as number).
    fd.set('sleepHours', draft.sleepHours.replace(',', '.'));
    fd.set('sleepQuality', String(draft.sleepQuality));
    fd.set('morningRoutineCompleted', String(draft.morningRoutineCompleted ?? false));
    fd.set('meditationMin', (draft.meditationMin || '0').replace(',', '.'));
    fd.set('sportType', draft.sportType.trim());
    fd.set('sportDurationMin', draft.sportDurationMin.replace(',', '.'));
    fd.set('moodScore', String(draft.moodScore));
    fd.set('intention', draft.intention.trim());
    for (const slug of draft.emotionTags) fd.append('emotionTags', slug);

    startTransition(async () => {
      const result: CheckinActionState = await submitMorningCheckinAction(null, fd);
      if (result.ok) {
        clearDraft();
        hapticSuccess();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setServerError(serverErrorMessage(result));
      hapticError();
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
          <span className="font-mono text-[11px] text-[var(--t-3)] tabular-nums" aria-live="polite">
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
            <span className="t-eyebrow">Check-in matin</span>
            <h1
              id="checkin-heading"
              ref={headingRef}
              tabIndex={-1}
              // Programmatic-focus heading: SR users navigate to it on each
              // step transition, but the global outline rule would draw a
              // lime ring around the title which is visually parasitic and
              // not actionable (you don't "activate" an h1). Keep the focus
              // discoverable to AT, hidden visually. Audit J5 H3.
              className="f-display text-[20px] leading-[1.1] font-bold tracking-[-0.02em] text-[var(--t-1)] outline-none focus-visible:outline-none sm:text-[24px]"
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
          aria-label="Progression du check-in matin"
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
              <StepSleep
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 1 ? (
              <StepRoutine
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 2 ? (
              <StepBody
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
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
              <StepIntention
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <nav
        aria-label="Navigation du check-in matin"
        className="sticky bottom-0 -mx-4 flex flex-col gap-1 border-t border-[var(--b-default)] bg-[var(--bg)]/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/80"
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
              {pending ? 'Enregistrement…' : 'Enregistrer mon matin'}
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

function StepSleep({ draft, update, fieldErrors, disabled }: StepProps) {
  // Live-classify the entered hours for the SleepZonesBar (J5 audit UI B1
  // polish — pedagogical zones diagram).
  const parsed = draft.sleepHours.replace(',', '.');
  const numericHours = parsed === '' ? null : Number.isNaN(Number(parsed)) ? null : Number(parsed);

  return (
    <div className="flex flex-col gap-5">
      <NumericField
        id="sleepHours"
        label="Heures de sommeil"
        value={draft.sleepHours}
        onChange={(v) => update('sleepHours', v)}
        error={fieldErrors.sleepHours}
        disabled={disabled}
        autoFocus
        step="0.5"
        inputMode="decimal"
        placeholder="7.5"
        hint="0 à 24h. Demi-heures et virgule décimale acceptées."
      />

      <SleepZonesBar hours={numericHours} />

      <ScoreSlider
        name="sleepQuality"
        value={draft.sleepQuality}
        onChange={(v) => update('sleepQuality', v)}
        label="Qualité de sommeil"
        describeAt={SLEEP_QUALITY_LABEL}
        tone="acc"
        disabled={disabled}
        hint="Comment tu te sens au réveil."
      />
    </div>
  );
}

function StepRoutine({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-4">
        <span className="t-eyebrow">Suggestions de routine</span>
        <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--t-2)]">
          {MORNING_ROUTINE_SUGGESTIONS.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-[var(--acc)]" />
              {item}
            </li>
          ))}
        </ul>
        <p className="t-cap text-[var(--t-4)]">
          V1 : on capte un seul booléen «&nbsp;j’ai fait ma routine&nbsp;». V2 : checklist
          personnalisable.
        </p>
      </Card>

      <RadioGroup
        legend="As-tu fait ta routine matinale ?"
        name="morningRoutineCompleted"
        value={
          draft.morningRoutineCompleted === null
            ? ''
            : draft.morningRoutineCompleted
              ? 'true'
              : 'false'
        }
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Pas aujourd’hui' },
        ]}
        onChange={(v) => update('morningRoutineCompleted', v === 'true')}
        disabled={disabled}
        error={fieldErrors.morningRoutineCompleted}
      />
    </div>
  );
}

function StepBody({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <NumericField
        id="meditationMin"
        label="Méditation (minutes)"
        value={draft.meditationMin}
        onChange={(v) => update('meditationMin', v)}
        error={fieldErrors.meditationMin}
        disabled={disabled}
        step="1"
        inputMode="numeric"
        placeholder="0"
        hint="0 si tu n’as pas médité aujourd’hui."
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
          Sport (optionnel)
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-1">
            <input
              id="sportType"
              type="text"
              value={draft.sportType}
              onChange={(e) => update('sportType', e.target.value)}
              disabled={disabled}
              placeholder="Course, muscu, yoga…"
              aria-invalid={fieldErrors.sportType ? 'true' : undefined}
              className={cn(
                'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
                'placeholder:text-[var(--t-4)]',
                fieldErrors.sportType
                  ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
                  : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
                'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            />
            {fieldErrors.sportType ? (
              <p className="text-[11px] text-[var(--bad)]" role="alert">
                {fieldErrors.sportType}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <input
              id="sportDurationMin"
              type="number"
              value={draft.sportDurationMin}
              onChange={(e) => update('sportDurationMin', e.target.value)}
              disabled={disabled}
              step="1"
              inputMode="numeric"
              placeholder="min"
              aria-invalid={fieldErrors.sportDurationMin ? 'true' : undefined}
              className={cn(
                'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] tabular-nums transition-[border-color,box-shadow] duration-150 outline-none',
                'placeholder:text-[var(--t-4)]',
                fieldErrors.sportDurationMin
                  ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
                  : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
                'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            />
            {fieldErrors.sportDurationMin ? (
              <p className="text-[11px] text-[var(--bad)]" role="alert">
                {fieldErrors.sportDurationMin}
              </p>
            ) : null}
          </div>
        </div>
        <p className="t-cap text-[var(--t-4)]">
          Laisse vide si tu n’as pas bougé. Sinon, indique les deux : type + minutes.
        </p>
      </fieldset>
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
        label="Humeur ce matin"
        describeAt={MOOD_LABEL}
        tone="acc"
        disabled={disabled}
        hint="Sensation présente — ni anticipation, ni rétrospective."
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

function StepIntention({ draft, update, fieldErrors, disabled }: StepProps) {
  const charCount = draft.intention.length;
  const isCharLimitNear = charCount > 180;
  const hint = 'Une phrase courte. Ex: "Trader uniquement à Londres", "Pas de revenge trade".';
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex items-start gap-2.5 p-4">
        <Coffee className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cy)]" strokeWidth={1.75} />
        {/* Paraphrase Mark Douglas — pas de citation directe (pas de
            formulation sourçable telle quelle dans Trading in the Zone). On
            référence l'auteur sans fabriquer une citation à guillemets. */}
        <p className="t-body text-[var(--t-2)]">
          Dans l’esprit de Mark Douglas : définis tes règles <em>avant</em> de regarder l’écran. Une
          phrase courte qui te ramène à ton plan dès qu’elle se rappelle à toi.
        </p>
      </Card>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="intention"
            className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
          >
            Intention du jour (optionnel)
          </label>
          {/* Counter — silent for SR until ~10% headroom remains, then announces
              a single threshold message (a11y B4 audit fix: drop per-keystroke
              "polite" announcements that overwhelm dictation). */}
          <span
            className={cn(
              'font-mono text-[11px] tabular-nums',
              isCharLimitNear ? 'text-[var(--warn)]' : 'text-[var(--t-3)]',
            )}
            aria-hidden
          >
            {charCount}/200
          </span>
          <span className="sr-only" aria-live="polite">
            {isCharLimitNear ? `Limite proche, ${200 - charCount} caractères restants.` : ''}
          </span>
        </div>
        <textarea
          id="intention"
          name="intention"
          value={draft.intention}
          onChange={(e) => update('intention', e.target.value.slice(0, 200))}
          disabled={disabled}
          rows={3}
          maxLength={200}
          placeholder={hint}
          aria-invalid={fieldErrors.intention ? 'true' : undefined}
          className={cn(
            'rounded-input w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            'placeholder:text-[var(--t-3)]',
            fieldErrors.intention
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {fieldErrors.intention ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {fieldErrors.intention}
          </p>
        ) : null}
      </div>

      <Card primary className="flex items-start gap-2.5 p-4">
        <Brain className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acc)]" strokeWidth={1.75} />
        <div className="flex flex-1 flex-col gap-1">
          <span className="t-eyebrow">Récap</span>
          <p className="t-body text-[var(--t-2)]">
            Clique sur{' '}
            <span className="font-semibold text-[var(--t-1)]">Enregistrer mon matin</span> pour
            valider. Le check-in soir s’ouvrira ce soir.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// SHARED PRIMITIVES (private — duplicated minimally from the trade wizard)
// ============================================================================

function NumericField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  autoFocus,
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
  autoFocus?: boolean | undefined;
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
        className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
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
        autoFocus={autoFocus}
        step={step}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={cn(
          'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] tabular-nums transition-[border-color,box-shadow] duration-150 outline-none',
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

  // ARIA Authoring Practices roving tabindex needs Arrow/Home/End keys to be
  // operable by keyboard (a11y B5 audit fix). The native <input type="radio">
  // arrow handling is broken when the inputs are sr-only AND we apply our own
  // tabindex(-1) on non-active siblings — so we wire the keyboard handler
  // explicitly on the fieldset.
  const handleKeyDown = (e: KeyboardEvent<HTMLFieldSetElement>) => {
    if (disabled) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      return;
    }
    e.preventDefault();
    const currentIndex = options.findIndex((o) => o.value === (value || firstValue));
    const lastIndex = options.length - 1;
    let nextIndex = currentIndex;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = lastIndex;
    }
    const target = options[nextIndex];
    if (!target) return;
    onChange(target.value);
    // Focus the new option's input so the SR announces the selection change.
    const input = e.currentTarget.querySelector<HTMLInputElement>(
      `input[name="${name}"][value="${target.value}"]`,
    );
    input?.focus();
  };

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errorId} onKeyDown={handleKeyDown}>
      <legend className="mb-1 text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
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

export const __testables = {
  emptyDraft,
};
