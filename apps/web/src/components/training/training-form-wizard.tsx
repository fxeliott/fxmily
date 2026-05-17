'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  Camera,
  GraduationCap,
  ShieldCheck,
  Target,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  createTrainingTradeAction,
  type CreateTrainingTradeActionState,
} from '@/app/training/actions';
import { Alert } from '@/components/alert';
import { PairAutocomplete } from '@/components/journal/pair-autocomplete';
import { ScreenshotUploader } from '@/components/journal/screenshot-uploader';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { trainingTradeCreateSchema } from '@/lib/schemas/training-trade';
import { cn } from '@/lib/utils';

/**
 * Mobile-first wizard for logging a backtest (J-T2, SPEC §21 "Mode
 * Entraînement"). Carbon mirror of `journal/trade-form-wizard.tsx` with the
 * LIGHTER backtest field set (SPEC §21.2): pair → capture → R:R → résultat →
 * respect système → leçon. NO emotions / sleep / confidence — backtest affect
 * ≠ real-risk affect (Mark Douglas).
 *
 * Visual identity is deliberately NON-confusable with the live journal
 * (cyan "Mode entraînement" marker, distinct copy) so a member never blurs
 * backtest and live (Mark Douglas discipline). DS-v2 tokens, NOT `.v18-theme`.
 *
 * Animation uses the bundle-safe `m` alias (a `<LazyMotion>` ancestor is
 * provided by the app shell — never `motion.*`). Reduced-motion kills every
 * non-essential transition.
 */

const STEP_TITLES = [
  'Quand & quelle paire',
  'Capture de ton analyse',
  'Plan : R:R prévu',
  'Résultat du backtest',
  'Respect du système',
  'Leçon tirée',
] as const;

const STEP_ICONS = [Calendar, Camera, Target, Trophy, ShieldCheck, BookOpen] as const;

const STEP_FIELDS = [
  ['pair', 'enteredAt'],
  ['entryScreenshotKey'],
  ['plannedRR'],
  ['outcome', 'resultR'],
  ['systemRespected'],
  ['lessonLearned'],
] as const;

const TOTAL_STEPS = STEP_TITLES.length;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface TrainingDraftState {
  pair: string;
  enteredAt: string;
  entryScreenshotKey: string;
  entryScreenshotReadUrl: string;
  plannedRR: number;
  outcome: '' | 'win' | 'loss' | 'break_even';
  resultR: string;
  systemRespected: 'true' | 'false' | 'na' | '';
  lessonLearned: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:training:draft:v1';

function nowIsoLocal(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(): TrainingDraftState {
  return {
    pair: '',
    enteredAt: nowIsoLocal(),
    entryScreenshotKey: '',
    entryScreenshotReadUrl: '',
    plannedRR: 2,
    outcome: '',
    resultR: '',
    systemRespected: '',
    lessonLearned: '',
  };
}

function loadDraft(): TrainingDraftState {
  if (typeof window === 'undefined') return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<TrainingDraftState>;
    return { ...emptyDraft(), ...parsed };
  } catch {
    return emptyDraft();
  }
}

function persistDraft(draft: TrainingDraftState) {
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

function serverErrorMessage(state: CreateTrainingTradeActionState): string {
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

export function TrainingFormWizard() {
  const [draft, setDraft] = useState<TrainingDraftState>(() => emptyDraft());
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
    setDraft(loadDraft());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persistDraft(draft);
  }, [draft, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    headingRef.current?.focus();
  }, [step, hydrated]);

  const update = <K extends keyof TrainingDraftState>(key: K, value: TrainingDraftState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const goToStep = (next: StepIndex, opts: { keepErrors?: boolean } = {}) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    if (!opts.keepErrors) {
      setFieldErrors({});
      setServerError(null);
    }
  };

  const validateStep = (s: StepIndex): boolean => {
    const stepFields = STEP_FIELDS[s] ?? [];
    const candidate = {
      pair: draft.pair,
      entryScreenshotKey: draft.entryScreenshotKey,
      plannedRR: draft.plannedRR,
      outcome: draft.outcome === '' ? null : draft.outcome,
      resultR: draft.resultR === '' ? null : draft.resultR,
      systemRespected: draft.systemRespected || 'na',
      lessonLearned: draft.lessonLearned,
      enteredAt: draft.enteredAt ? new Date(draft.enteredAt) : new Date(NaN),
    };
    const result = trainingTradeCreateSchema.safeParse(candidate);
    if (result.success) return true;

    const errs: Record<string, string> = {};
    let stepHasIssue = false;
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      const head = String(issue.path[0] ?? '');
      if ((stepFields as readonly string[]).includes(head)) {
        errs[key] ??= issue.message;
        stepHasIssue = true;
      }
    }
    setFieldErrors(errs);
    return !stepHasIssue;
  };

  const systemChosen = draft.systemRespected !== '';

  const next = () => {
    if (step === 4 && !systemChosen) {
      setFieldErrors({ systemRespected: 'Réponds avant de continuer.' });
      return;
    }
    if (!validateStep(step)) return;
    if (step < TOTAL_STEPS - 1) goToStep((step + 1) as StepIndex);
  };

  const prev = () => {
    if (step > 0) goToStep((step - 1) as StepIndex);
  };

  const submit = () => {
    if (pending) return;
    if (!systemChosen) {
      setFieldErrors({ systemRespected: 'Réponds avant de soumettre.' });
      setServerError('Indique si tu as respecté ton système avant de soumettre.');
      goToStep(4, { keepErrors: true });
      return;
    }
    if (!validateStep(5)) return;

    const fd = new FormData();
    fd.set('pair', draft.pair);
    fd.set('enteredAt', new Date(draft.enteredAt).toISOString());
    fd.set('entryScreenshotKey', draft.entryScreenshotKey);
    fd.set('plannedRR', String(draft.plannedRR));
    if (draft.outcome) fd.set('outcome', draft.outcome);
    if (draft.resultR !== '') fd.set('resultR', draft.resultR);
    fd.set('systemRespected', draft.systemRespected || 'na');
    fd.set('lessonLearned', draft.lessonLearned);

    startTransition(async () => {
      const result: CreateTrainingTradeActionState = await createTrainingTradeAction(null, fd);
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
      aria-labelledby="training-wizard-heading"
      className="mx-auto flex w-full max-w-xl flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/training"
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Retour
          </Link>
          <span className="font-mono text-[11px] text-[var(--t-3)] tabular-nums" aria-live="polite">
            Étape{' '}
            <span className="font-semibold text-[var(--cy)]">
              {String(step + 1).padStart(2, '0')}
            </span>
            <span className="text-[var(--t-4)]"> / {String(TOTAL_STEPS).padStart(2, '0')}</span>
          </span>
        </div>

        <span className="t-eyebrow inline-flex w-fit items-center gap-1.5 text-[var(--cy)]">
          <GraduationCap className="h-3.5 w-3.5" strokeWidth={2} />
          Mode entraînement — backtest isolé du réel
        </span>

        <div className="flex items-center gap-2.5">
          <div className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] text-[var(--cy)]">
            <StepIcon className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <h1
            id="training-wizard-heading"
            ref={headingRef}
            tabIndex={-1}
            className="f-display text-[22px] leading-[1.1] font-bold tracking-[-0.02em] text-[var(--t-1)] sm:text-[26px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            {STEP_TITLES[step]}
          </h1>
        </div>

        <div
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuetext={`Étape ${step + 1} sur ${TOTAL_STEPS}`}
          aria-label="Progression de la saisie"
          className="flex w-full gap-1"
        >
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'rounded-pill h-1 flex-1 transition-all duration-300',
                i < step
                  ? 'bg-[var(--cy)]'
                  : i === step
                    ? 'bg-[var(--cy)] shadow-[0_0_8px_oklch(0.789_0.139_217_/_0.55)]'
                    : 'bg-[var(--b-default)]',
              )}
            />
          ))}
        </div>
      </header>

      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

      <div className="relative min-h-[22rem]">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <m.div
            key={step}
            custom={direction}
            initial={
              prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * 28 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * -28 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-5"
          >
            {step === 0 ? (
              <StepPairDate
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 1 ? (
              <StepCapture
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 2 ? (
              <StepPlannedRR
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 3 ? (
              <StepResultat
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 4 ? (
              <StepSysteme
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 5 ? (
              <StepLecon
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
          </m.div>
        </AnimatePresence>
      </div>

      <nav
        aria-label="Navigation du formulaire"
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

          {step < TOTAL_STEPS - 1 ? (
            <Btn kind="primary" size="m" onClick={next} disabled={pending} kbd="↵" type="button">
              Suivant
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Btn>
          ) : (
            <Btn
              kind="primary"
              size="m"
              onClick={submit}
              disabled={pending || !draft.entryScreenshotKey}
              loading={pending}
              kbd={pending || !draft.entryScreenshotKey ? undefined : '↵'}
              aria-describedby={!draft.entryScreenshotKey ? 'training-submit-hint' : undefined}
              type="button"
            >
              {pending ? 'Enregistrement…' : 'Enregistrer le backtest'}
            </Btn>
          )}
        </div>
        {step === TOTAL_STEPS - 1 && !draft.entryScreenshotKey ? (
          <p
            id="training-submit-hint"
            className="text-right text-[11px] text-[var(--t-4)] tabular-nums"
          >
            Ajoute la capture (étape 2) pour activer l&apos;enregistrement.
          </p>
        ) : null}
      </nav>
    </section>
  );
}

// ============================================================
// STEPS
// ============================================================

interface StepProps {
  draft: TrainingDraftState;
  update: <K extends keyof TrainingDraftState>(key: K, value: TrainingDraftState[K]) => void;
  fieldErrors: Record<string, string>;
  disabled?: boolean | undefined;
}

function StepPairDate({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="enteredAt" className="t-eyebrow-lg text-[var(--t-3)]">
          Date et heure du backtest
        </label>
        <input
          id="enteredAt"
          type="datetime-local"
          value={draft.enteredAt}
          onChange={(e) => update('enteredAt', e.target.value)}
          disabled={disabled}
          aria-invalid={fieldErrors.enteredAt ? 'true' : undefined}
          className={cn(
            'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            fieldErrors.enteredAt
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--cy)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--cy-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {fieldErrors.enteredAt ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {fieldErrors.enteredAt}
          </p>
        ) : (
          <p className="t-cap text-[var(--t-4)]">
            Quand tu as analysé ce backtest. Pré-rempli à maintenant.
          </p>
        )}
      </div>

      <PairAutocomplete
        value={draft.pair}
        onChange={(v) => update('pair', v)}
        error={fieldErrors.pair}
        disabled={disabled}
      />
    </div>
  );
}

function StepCapture({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-body text-[var(--t-2)]">
        Capture ton analyse TradingView (le setup que tu testes). Obligatoire — c&apos;est la base
        de la correction.
      </p>
      <ScreenshotUploader
        kind="training-entry"
        name="entryScreenshotKey"
        initialKey={draft.entryScreenshotKey || null}
        initialReadUrl={draft.entryScreenshotReadUrl || null}
        disabled={disabled}
        error={fieldErrors.entryScreenshotKey}
        onUploaded={({ key, readUrl }) => {
          update('entryScreenshotKey', key);
          update('entryScreenshotReadUrl', readUrl);
        }}
        onCleared={() => {
          update('entryScreenshotKey', '');
          update('entryScreenshotReadUrl', '');
        }}
      />
    </div>
  );
}

function StepPlannedRR({ draft, update, fieldErrors, disabled }: StepProps) {
  const rr = draft.plannedRR;
  const breakeven = (1 / (1 + rr)) * 100;
  return (
    <div className="flex flex-col gap-5">
      <Card primary className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="t-eyebrow">R:R prévu</span>
          <Pill tone={rr < 1 ? 'bad' : 'cy'}>
            WR&nbsp;requis&nbsp;&gt;&nbsp;{breakeven.toFixed(0)}%
          </Pill>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="f-mono text-[40px] leading-none font-bold tracking-[-0.03em] text-[var(--cy)] tabular-nums">
            1:{rr.toFixed(2)}
          </span>
        </div>
        <p className="t-cap mt-3 text-[var(--t-3)]">
          Sur ce backtest, ton win rate doit dépasser{' '}
          <span className="font-mono text-[var(--t-1)] tabular-nums">{breakeven.toFixed(0)}%</span>{' '}
          pour être à l&apos;équilibre. Sans frais ni swap.
        </p>
      </Card>

      <NumericField
        id="plannedRR"
        label="R:R prévu (0.25 → 20)"
        value={String(rr)}
        onChange={(v) => update('plannedRR', v === '' ? 0 : Number(v))}
        error={fieldErrors.plannedRR}
        disabled={disabled}
        step="0.25"
        inputMode="decimal"
        placeholder="2"
      />
    </div>
  );
}

function StepResultat({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="t-cap text-[var(--t-4)]">
        Optionnel — tu peux enregistrer un backtest sans résultat (analyse seule) et le compléter
        plus tard côté admin.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">Résultat</legend>
        <div role="radiogroup" aria-label="Résultat du backtest" className="grid grid-cols-3 gap-2">
          {(
            [
              { v: 'win', label: 'Gagnant', tone: 'ok' as const },
              { v: 'break_even', label: 'Break-even', tone: 'cy' as const },
              { v: 'loss', label: 'Perdant', tone: 'bad' as const },
            ] as const
          ).map((o) => {
            const active = draft.outcome === o.v;
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update('outcome', active ? '' : o.v)}
                disabled={disabled}
                className={cn(
                  'rounded-card flex min-h-14 items-center justify-center border bg-[var(--bg-1)] px-2 py-2 text-[13px] font-semibold transition-all',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]',
                  active
                    ? o.tone === 'ok'
                      ? 'border-[var(--ok)] bg-[var(--ok-dim-2)] text-[var(--ok)]'
                      : o.tone === 'bad'
                        ? 'border-[var(--bad)] bg-[var(--bad-dim-2)] text-[var(--bad)]'
                        : 'border-[var(--cy)] bg-[var(--cy-dim-2)] text-[var(--cy)]'
                    : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className="t-cap text-[var(--t-4)]">Re-clique pour effacer (= analyse sans résultat).</p>
      </fieldset>

      <NumericField
        id="resultR"
        label="Résultat en R (optionnel)"
        value={draft.resultR}
        onChange={(v) => update('resultR', v)}
        error={fieldErrors.resultR}
        disabled={disabled}
        step="0.01"
        inputMode="decimal"
        placeholder="ex : 1.8 ou -1"
      />
    </div>
  );
}

function StepSysteme({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <p className="t-body text-[var(--t-2)]">
        As-tu respecté ton système / ton plan sur ce backtest ? (Le moteur ne juge jamais la qualité
        de ton analyse — seulement si tu suis ton process.)
      </p>
      <RadioGroup
        legend="Système respecté ?"
        name="systemRespected"
        value={draft.systemRespected}
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Non' },
          { value: 'na', label: 'N/A' },
        ]}
        onChange={(v) => update('systemRespected', v as TrainingDraftState['systemRespected'])}
        disabled={disabled}
        error={fieldErrors.systemRespected}
      />
    </div>
  );
}

function StepLecon({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="lessonLearned" className="t-eyebrow-lg text-[var(--t-3)]">
        Leçon tirée
      </label>
      <p className="t-cap text-[var(--t-4)]">
        Ce que ce backtest t&apos;a appris sur ton process. C&apos;est la régularité de cette
        réflexion qui fait progresser — pas le résultat.
      </p>
      <textarea
        id="lessonLearned"
        value={draft.lessonLearned}
        onChange={(e) => update('lessonLearned', e.target.value)}
        disabled={disabled}
        rows={5}
        maxLength={2000}
        placeholder="Ex : j'ai attendu la confirmation au lieu d'anticiper, l'entrée était plus propre."
        aria-invalid={fieldErrors.lessonLearned ? 'true' : undefined}
        className={cn(
          'rounded-input w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
          'placeholder:text-[var(--t-4)]',
          fieldErrors.lessonLearned
            ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
            : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--cy)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--cy-dim)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      {fieldErrors.lessonLearned ? (
        <p className="text-[11px] text-[var(--bad)]" role="alert">
          {fieldErrors.lessonLearned}
        </p>
      ) : null}
    </div>
  );
}

// ============================================================
// BUILDING BLOCKS
// ============================================================

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
}) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="t-eyebrow-lg text-[var(--t-3)]">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        step={step}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        className={cn(
          'f-mono rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] tabular-nums transition-[border-color,box-shadow] duration-150 outline-none',
          'placeholder:text-[var(--t-4)]',
          error
            ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
            : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--cy)]',
          'focus-visible:ring-2 focus-visible:ring-[var(--cy-dim)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      />
      {error ? (
        <p id={errorId} className="text-[11px] text-[var(--bad)]" role="alert">
          {error}
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
      <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt.value;
          const tabbable = value === '' ? opt.value === firstValue : active;
          return (
            <label
              key={opt.value}
              className={cn(
                'rounded-pill inline-flex min-h-11 cursor-pointer items-center gap-2 border px-4 py-2 text-[13px] font-medium transition-all',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--cy)]',
                active
                  ? 'border-[oklch(0.789_0.139_217_/_0.40)] bg-[var(--cy-dim)] text-[var(--cy)] shadow-[0_0_0_3px_oklch(0.789_0.139_217_/_0.10)]'
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
