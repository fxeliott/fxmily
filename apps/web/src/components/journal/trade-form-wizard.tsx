'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Camera,
  Heart,
  Info,
  Sliders,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { createTradeAction, type CreateTradeActionState } from '@/app/journal/actions';
import { Alert } from '@/components/alert';
import { EmotionPicker } from '@/components/journal/emotion-picker';
import { PairAutocomplete } from '@/components/journal/pair-autocomplete';
import { ScreenshotUploader } from '@/components/journal/screenshot-uploader';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Pill } from '@/components/ui/pill';
import { clamp } from '@/lib/hooks';
import { tradeOpenSchema, WIZARD_STEPS } from '@/lib/schemas/trade';
import { TRADING_PAIRS, type TradingPair } from '@/lib/trading/pairs';
import { detectSession, SESSION_HINT, SESSION_LABEL, SESSIONS } from '@/lib/trading/sessions';
import { cn } from '@/lib/utils';

/**
 * Mobile-first wizard for opening a trade (J2, SPEC §7.3).
 * Élévation Sprint 1C — design system v2 lime + slider custom + breakeven
 * probability ladder + Framer Motion direction-aware transitions.
 *
 * Logique métier préservée à 100% : DraftState + localStorage draft +
 * Server Action createTradeAction + validateStep partial Zod parse.
 *
 * Différenciants pédago Douglas appliqués au step R:R :
 *   - Live breakeven win rate (1/(1+R)) avec threshold pulse aux entiers
 *   - Ratio bar split rouge/lime proportionnel au R:R
 *   - Ladder 9-cells (R = 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5) avec WR requis
 *   - Anti-pattern warning si R<1 (EV négatif)
 */

const STEP_TITLES = [
  'Quand & quelle paire',
  'Direction & session',
  'Prix & taille',
  'Plan : R:R prévu',
  'Discipline & émotion',
  'Capture avant entrée',
] as const;

const STEP_ICONS = [Calendar, TrendingUp, Sliders, Target, Heart, Camera] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface DraftState {
  pair: string;
  direction: 'long' | 'short' | '';
  session: 'asia' | 'london' | 'newyork' | 'overlap' | '';
  enteredAt: string;
  entryPrice: string;
  lotSize: string;
  stopLossPrice: string;
  /** V1.5 — Tharp risk % rule. Empty string = "not captured" (default). */
  riskPct: string;
  plannedRR: number;
  /** V1.5 — Steenbarger setup quality. Empty string = "not captured" (default). */
  tradeQuality: 'A' | 'B' | 'C' | '';
  emotionBefore: string[];
  planRespected: boolean | null;
  hedgeRespected: 'true' | 'false' | 'na' | '';
  notes: string;
  screenshotEntryKey: string;
  screenshotEntryReadUrl: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:journal:draft:v1';

function nowIsoLocal(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(): DraftState {
  return {
    pair: '',
    direction: '',
    session: '',
    enteredAt: nowIsoLocal(),
    entryPrice: '',
    lotSize: '',
    stopLossPrice: '',
    riskPct: '',
    plannedRR: 2,
    tradeQuality: '',
    emotionBefore: [],
    planRespected: null,
    hedgeRespected: '',
    notes: '',
    screenshotEntryKey: '',
    screenshotEntryReadUrl: '',
  };
}

function loadDraft(): DraftState {
  if (typeof window === 'undefined') return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return { ...emptyDraft(), ...parsed };
  } catch {
    return emptyDraft();
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

export function TradeFormWizard() {
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft());
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const restored = loadDraft();
    if (!restored.session) {
      restored.session = detectSession(new Date(restored.enteredAt));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(restored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persistDraft(draft);
  }, [draft, hydrated]);

  const update = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const updateEnteredAt = (value: string) => {
    setDraft((d) => ({
      ...d,
      enteredAt: value,
      session: d.session || detectSession(new Date(value)),
    }));
  };

  const goToStep = (next: StepIndex, opts: { keepErrors?: boolean } = {}) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    if (!opts.keepErrors) {
      setFieldErrors({});
      setServerError(null);
    }
  };

  useEffect(() => {
    if (!hydrated) return;
    headingRef.current?.focus();
  }, [step, hydrated]);

  const validateStep = (s: StepIndex): boolean => {
    const stepFields = WIZARD_STEPS[s] ?? [];
    const candidate = {
      pair: draft.pair,
      direction: draft.direction,
      session: draft.session,
      enteredAt: draft.enteredAt ? new Date(draft.enteredAt) : new Date(NaN),
      entryPrice: draft.entryPrice,
      lotSize: draft.lotSize,
      stopLossPrice: draft.stopLossPrice === '' ? null : Number(draft.stopLossPrice),
      // V1.5 — empty strings are treated as "not captured" (omitted), so the
      // Zod schema's `.optional()` handles them as undefined → service NULL.
      ...(draft.riskPct !== '' ? { riskPct: draft.riskPct } : {}),
      plannedRR: draft.plannedRR,
      ...(draft.tradeQuality !== '' ? { tradeQuality: draft.tradeQuality } : {}),
      emotionBefore: draft.emotionBefore,
      planRespected: draft.planRespected ?? false,
      hedgeRespected: draft.hedgeRespected || 'na',
      notes: draft.notes,
      screenshotEntryKey: draft.screenshotEntryKey,
    };
    const result = tradeOpenSchema.safeParse(candidate);
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

  const planChosen = draft.planRespected !== null;
  const hedgeChosen = draft.hedgeRespected !== '';

  const next = () => {
    if (step === 4 && (!planChosen || !hedgeChosen)) {
      setFieldErrors({
        ...(planChosen ? {} : { planRespected: 'Réponds avant de continuer.' }),
        ...(hedgeChosen ? {} : { hedgeRespected: 'Réponds avant de continuer.' }),
      });
      return;
    }
    if (!validateStep(step)) return;
    if (step < 5) goToStep((step + 1) as StepIndex);
  };
  const prev = () => {
    if (step > 0) goToStep((step - 1) as StepIndex);
  };

  const submit = () => {
    if (pending) return;
    if (!validateStep(5)) return;
    if (!planChosen || !hedgeChosen) {
      setFieldErrors({
        ...(planChosen ? {} : { planRespected: 'Réponds avant de continuer.' }),
        ...(hedgeChosen ? {} : { hedgeRespected: 'Réponds avant de continuer.' }),
      });
      setServerError('Réponds aux questions de discipline avant de soumettre.');
      goToStep(4, { keepErrors: true });
      return;
    }

    const fd = new FormData();
    fd.set('pair', draft.pair);
    fd.set('direction', draft.direction);
    fd.set('session', draft.session);
    fd.set('enteredAt', new Date(draft.enteredAt).toISOString());
    fd.set('entryPrice', draft.entryPrice);
    fd.set('lotSize', draft.lotSize);
    if (draft.stopLossPrice !== '') fd.set('stopLossPrice', draft.stopLossPrice);
    if (draft.riskPct !== '') fd.set('riskPct', draft.riskPct);
    fd.set('plannedRR', String(draft.plannedRR));
    if (draft.tradeQuality !== '') fd.set('tradeQuality', draft.tradeQuality);
    for (const slug of draft.emotionBefore) fd.append('emotionBefore', slug);
    fd.set('planRespected', String(draft.planRespected));
    fd.set('hedgeRespected', draft.hedgeRespected);
    if (draft.notes) fd.set('notes', draft.notes);
    fd.set('screenshotEntryKey', draft.screenshotEntryKey);

    startTransition(async () => {
      const result: CreateTradeActionState = await createTradeAction(null, fd);
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
      aria-labelledby="wizard-heading"
      className="mx-auto flex w-full max-w-xl flex-col gap-5"
    >
      {/* Header */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/journal"
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
            <span className="text-[var(--t-4)]"> / 06</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <StepIcon className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <h1
            id="wizard-heading"
            ref={headingRef}
            tabIndex={-1}
            className="f-display text-[22px] leading-[1.1] font-bold tracking-[-0.02em] text-[var(--t-1)] sm:text-[26px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            {STEP_TITLES[step]}
          </h1>
        </div>

        {/* Progress bar 6 segments lime accent */}
        <div
          role="progressbar"
          aria-valuenow={step + 1}
          aria-valuemin={1}
          aria-valuemax={6}
          aria-valuetext={`Étape ${step + 1} sur 6`}
          aria-label="Progression de la saisie"
          className="flex w-full gap-1"
        >
          {Array.from({ length: 6 }).map((_, i) => (
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

      {/* Step content with direction-aware Framer transition */}
      <div className="relative min-h-[24rem]">
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
              <StepWhenAndWhat
                draft={draft}
                update={update}
                onEnteredAtChange={updateEnteredAt}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 1 ? (
              <StepDirectionSession
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 2 ? (
              <StepPricesSizing
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 3 ? <StepPlannedRR draft={draft} update={update} disabled={pending} /> : null}
            {step === 4 ? (
              <StepDisciplineEmotions
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
            {step === 5 ? (
              <StepEntryScreenshot
                draft={draft}
                update={update}
                fieldErrors={fieldErrors}
                disabled={pending}
              />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sticky bottom nav with Btn primitives + kbd hints */}
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

          {step < 5 ? (
            <Btn kind="primary" size="m" onClick={next} disabled={pending} kbd="↵" type="button">
              Suivant
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            </Btn>
          ) : (
            <Btn
              kind="primary"
              size="m"
              onClick={submit}
              disabled={pending || !draft.screenshotEntryKey}
              loading={pending}
              kbd={pending || !draft.screenshotEntryKey ? undefined : '↵'}
              aria-describedby={!draft.screenshotEntryKey ? 'submit-hint' : undefined}
              type="button"
            >
              {pending ? 'Enregistrement…' : 'Sauvegarder le trade'}
            </Btn>
          )}
        </div>
        {step === 5 && !draft.screenshotEntryKey ? (
          <p id="submit-hint" className="text-right text-[11px] text-[var(--t-4)] tabular-nums">
            Ajoute la capture pour activer la sauvegarde.
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
  draft: DraftState;
  update: <K extends keyof DraftState>(key: K, value: DraftState[K]) => void;
  fieldErrors: Record<string, string>;
  disabled?: boolean | undefined;
}

function StepWhenAndWhat({
  draft,
  update,
  onEnteredAtChange,
  fieldErrors,
  disabled,
}: StepProps & { onEnteredAtChange: (next: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="enteredAt" className="t-eyebrow-lg text-[var(--t-3)]">
          Date et heure d&apos;entrée
        </label>
        <input
          id="enteredAt"
          type="datetime-local"
          value={draft.enteredAt}
          onChange={(e) => onEnteredAtChange(e.target.value)}
          disabled={disabled}
          aria-invalid={fieldErrors.enteredAt ? 'true' : undefined}
          className={cn(
            'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            fieldErrors.enteredAt
              ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
              : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
        {fieldErrors.enteredAt ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {fieldErrors.enteredAt}
          </p>
        ) : (
          <p className="t-cap text-[var(--t-4)]">
            Heure locale (Europe/Paris). Pré-rempli à maintenant — la session se devine à
            l&apos;étape suivante.
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

function StepDirectionSession({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">Direction</legend>
        <div role="radiogroup" aria-label="Direction du trade" className="grid grid-cols-2 gap-2">
          {(['long', 'short'] as const).map((d) => {
            const active = draft.direction === d;
            const Icon = d === 'long' ? TrendingUp : TrendingDown;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update('direction', d)}
                disabled={disabled}
                className={cn(
                  'rounded-card flex min-h-16 flex-col items-center justify-center gap-1.5 border bg-[var(--bg-1)] px-3 py-3 text-[13px] font-semibold tracking-[0.08em] uppercase transition-all',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                  active
                    ? d === 'long'
                      ? 'border-[var(--ok)] bg-[var(--ok-dim-2)] text-[var(--ok)] shadow-[0_0_0_3px_oklch(0.804_0.181_145_/_0.10)]'
                      : 'border-[var(--bad)] bg-[var(--bad-dim-2)] text-[var(--bad)] shadow-[0_0_0_3px_oklch(0.7_0.165_22_/_0.10)]'
                    : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                {d === 'long' ? 'Long' : 'Short'}
              </button>
            );
          })}
        </div>
        {fieldErrors.direction ? (
          <p className="text-[11px] text-[var(--bad)]" role="alert">
            {fieldErrors.direction}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="t-eyebrow-lg mb-1 text-[var(--t-3)]">Session</legend>
        <div
          role="radiogroup"
          aria-label="Session de trading"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {SESSIONS.map((s) => {
            const active = draft.session === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update('session', s)}
                disabled={disabled}
                className={cn(
                  'rounded-card flex min-h-16 flex-col items-start justify-center gap-0.5 border bg-[var(--bg-1)] px-3 py-2.5 text-left transition-all',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                  active
                    ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] shadow-[var(--sh-card-selected)]'
                    : 'border-[var(--b-default)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    't-h3 leading-tight',
                    active ? 'text-[var(--acc)]' : 'text-[var(--t-1)]',
                  )}
                >
                  {SESSION_LABEL[s]}
                </span>
                <span className="t-cap text-[var(--t-4)]">{SESSION_HINT[s]}</span>
              </button>
            );
          })}
        </div>
        <p className="t-cap text-[var(--t-4)]">
          Pré-sélection :{' '}
          <span className="font-mono text-[var(--t-2)]">
            {draft.session ? SESSION_LABEL[draft.session as keyof typeof SESSION_LABEL] : '—'}
          </span>
          . Tu peux corriger.
        </p>
      </fieldset>
    </div>
  );
}

function StepPricesSizing({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <NumericField
        id="entryPrice"
        label="Prix d'entrée"
        value={draft.entryPrice}
        onChange={(v) => update('entryPrice', v)}
        error={fieldErrors.entryPrice}
        disabled={disabled}
        autoFocus
        step="any"
        inputMode="decimal"
        placeholder={pairExamplePrice(draft.pair as TradingPair | '')}
      />
      <NumericField
        id="lotSize"
        label="Taille (lots / contrats)"
        value={draft.lotSize}
        onChange={(v) => update('lotSize', v)}
        error={fieldErrors.lotSize}
        disabled={disabled}
        step="0.01"
        inputMode="decimal"
        placeholder="0.10"
      />
      <NumericField
        id="stopLossPrice"
        label="Stop-loss (optionnel mais recommandé)"
        value={draft.stopLossPrice}
        onChange={(v) => update('stopLossPrice', v)}
        error={fieldErrors.stopLossPrice}
        disabled={disabled}
        step="any"
        inputMode="decimal"
        placeholder="—"
        hint="Sans stop-loss, le R réalisé sera estimé (computed → estimated fallback)."
      />
      {/* V1.5 — Tharp risk % rule. Optional capture; surfaces a soft warning
          when the value exceeds 2 % (Tharp gold standard). */}
      <NumericField
        id="riskPct"
        label="Risque % du compte (optionnel — règle Tharp 1-2 %)"
        value={draft.riskPct}
        onChange={(v) => update('riskPct', v)}
        error={fieldErrors.riskPct}
        disabled={disabled}
        step="0.1"
        inputMode="decimal"
        placeholder="1.5"
        hint={
          draft.riskPct !== '' && Number(draft.riskPct) > 2
            ? `⚠ ${Number(draft.riskPct).toFixed(2)} % dépasse la limite Tharp 2 %. Vérifie ta taille.`
            : 'Pourcentage du compte exposé sur ce trade. Ex: 1.5 = 1.5 % du capital.'
        }
      />
    </div>
  );
}

/**
 * StepPlannedRR — Le step pédagogique stratégique du wizard.
 *
 * Implémente les différenciants Mark Douglas + Van Tharp :
 *   1. Slider lime custom (track gradient cyan→lime, thumb halo)
 *   2. Big number 1:R.RR avec drop-shadow lime + threshold-pulse aux entiers
 *   3. Live ratio bar split rouge/lime (proportionnel à 1/(1+R) et R/(1+R))
 *   4. Breakeven probability ladder 9-cells (R = 1, 1.5, 2, ..., 5)
 *   5. EV warning si R<1 (anti-pattern "moving the stop")
 *   6. Keyboard nav ←/→ pour fine-tune ±0.25, Shift+ pour ±0.5
 */
function StepPlannedRR({
  draft,
  update,
  disabled,
}: {
  draft: DraftState;
  update: StepProps['update'];
  disabled?: boolean | undefined;
}) {
  const rr = draft.plannedRR;
  const isLowRR = rr < 1;
  const breakeven = (1 / (1 + rr)) * 100;
  const [pulse, setPulse] = useState(false);
  const lastIntRef = useRef(Math.floor(rr));

  // Threshold pulse animation when crossing integer thresholds (1, 2, 3, 4, 5)
  // Use ref instead of state to track lastInt → no setState cascade in useEffect.
  useEffect(() => {
    const f = Math.floor(rr);
    if (f !== lastIntRef.current) {
      lastIntRef.current = f;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [rr]);

  // Keyboard nav : ←/→ ±0.25, Shift+←/→ ±0.5
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        update('plannedRR', Math.round(clamp(rr - (e.shiftKey ? 0.5 : 0.25), 0.5, 10) * 4) / 4);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        update('plannedRR', Math.round(clamp(rr + (e.shiftKey ? 0.5 : 0.25), 0.5, 10) * 4) / 4);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rr, disabled, update]);

  const pct = ((rr - 0.5) / (10 - 0.5)) * 100;

  return (
    <div className="flex flex-col gap-5">
      {/* Big number + EV pill */}
      <Card primary className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="t-eyebrow">R:R prévu</span>
          <Pill tone={isLowRR ? 'bad' : 'acc'}>
            EV {isLowRR ? 'NÉGATIF' : 'POSITIF'} si WR&gt;{breakeven.toFixed(0)}%
          </Pill>
        </div>

        <div className="mb-4 flex items-baseline gap-3">
          <span
            className={cn(
              'f-mono text-[48px] leading-none font-bold tracking-[-0.04em] tabular-nums sm:text-[56px]',
              isLowRR ? 'text-[var(--bad)]' : 'text-[var(--acc)]',
              pulse && 'threshold-pulse',
            )}
            style={{
              filter: isLowRR
                ? 'drop-shadow(0 0 14px oklch(0.7 0.165 22 / 0.32))'
                : 'drop-shadow(0 0 14px oklch(0.879 0.231 130 / 0.40))',
            }}
          >
            1:{rr.toFixed(2)}
          </span>
        </div>

        {/* Live ratio bar split rouge/lime */}
        <div
          className="rounded-input relative flex h-10 overflow-hidden border border-[var(--b-default)] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.04)]"
          aria-hidden
        >
          <div
            className="grid place-items-center border-r border-[var(--b-default)] bg-gradient-to-r from-[oklch(0.7_0.165_22_/_0.20)] to-[oklch(0.7_0.165_22_/_0.10)] font-mono text-[11px] font-semibold text-[var(--bad)] tabular-nums transition-[flex-basis]"
            style={{ flexBasis: `${100 / (1 + rr)}%`, transitionDuration: '120ms' }}
          >
            −1R
          </div>
          <div
            className="grid place-items-center bg-gradient-to-r from-[oklch(0.879_0.231_130_/_0.10)] to-[oklch(0.879_0.231_130_/_0.22)] font-mono text-[11px] font-semibold text-[var(--acc)] tabular-nums transition-[flex-basis]"
            style={{ flexBasis: `${(rr * 100) / (1 + rr)}%`, transitionDuration: '120ms' }}
          >
            +{rr.toFixed(1)}R
          </div>
        </div>

        {/* Custom slider — track gradient cyan→lime, thumb lime halo */}
        <div className="relative mt-5 h-6">
          {/* Track background */}
          <div
            aria-hidden
            className="rounded-pill absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 border border-[var(--b-subtle)] bg-[var(--bg-2)]"
          />
          {/* Track filled — gradient */}
          <div
            aria-hidden
            className="rounded-pill absolute top-1/2 left-0 h-1.5 -translate-y-1/2"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--cy) 0%, var(--acc) 80%)',
              boxShadow: '0 0 10px -2px oklch(0.879 0.231 130 / 0.50)',
              transition: 'width 80ms cubic-bezier(0.4,0,0.2,1)',
            }}
          />
          {/* Tick marks (visible at 1, 2, 3, 4, 5) */}
          {[1, 2, 3, 4, 5].map((t) => (
            <div
              key={t}
              aria-hidden
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--b-strong)]"
              style={{ left: `${((t - 0.5) / 9.5) * 100}%` }}
            />
          ))}
          {/* Native range input on top, opacity 0 for accessibility */}
          <input
            id="plannedRR"
            type="range"
            min={0.5}
            max={10}
            step={0.25}
            value={rr}
            onChange={(e) => update('plannedRR', Number(e.target.value))}
            disabled={disabled}
            aria-label="Risk Reward ratio"
            aria-valuetext={`R:R 1 pour ${rr.toFixed(2)}`}
            className="absolute inset-0 w-full cursor-grab opacity-0 active:cursor-grabbing disabled:cursor-not-allowed"
          />
          {/* Custom thumb */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg)] bg-[var(--acc)] transition-shadow"
            style={{
              left: `${pct}%`,
              boxShadow: '0 0 0 4px oklch(0.879 0.231 130 / 0.18), 0 2px 4px oklch(0 0 0 / 0.4)',
              transition: 'left 80ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            <div className="absolute inset-1 rounded-full bg-gradient-to-br from-[var(--acc-hi)] to-[var(--acc)]" />
          </div>
        </div>

        {/* Tick labels */}
        <div className="mt-2 flex justify-between font-mono text-[10px] text-[var(--t-4)] tabular-nums">
          <span>0.5</span>
          <span>1.0</span>
          <span>2.0</span>
          <span className={cn(rr >= 2.4 && rr <= 2.6 && 'text-[var(--acc)]')}>2.5</span>
          <span>3.0</span>
          <span>5.0</span>
          <span>10</span>
        </div>

        {/* Keyboard hint */}
        <p className="t-cap mt-3 inline-flex items-center gap-1.5 text-[var(--t-4)]">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          ±0.25 ·{' '}
          <span className="inline-flex items-center gap-1">
            <Kbd>⇧</Kbd>+<Kbd>←</Kbd>
            <Kbd>→</Kbd>
            ±0.5
          </span>
        </p>
      </Card>

      {/* Inline EV warning si R<1 */}
      {isLowRR ? (
        <div className="confirm-flash rounded-control flex items-start gap-2 border border-[var(--b-danger)] bg-[var(--bad-dim)] px-3 py-2.5">
          <Info
            aria-hidden
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bad)]"
            strokeWidth={2}
          />
          <div className="flex-1">
            <div className="text-[12px] font-medium text-[var(--bad-hi)]">EV négatif sous 1:1</div>
            <p className="t-cap mt-0.5 text-[var(--t-2)]">
              Avec R:R 1:{rr.toFixed(2)}, ton win rate doit dépasser{' '}
              <span className="font-mono font-semibold text-[var(--bad-hi)] tabular-nums">
                {breakeven.toFixed(0)}%
              </span>{' '}
              pour ne pas perdre. Vérifie que ton plan est cohérent — ne déplace pas le stop pour
              forcer un meilleur ratio.
            </p>
          </div>
        </div>
      ) : null}

      {/* Breakeven probability ladder 9-cells */}
      <Card className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="t-eyebrow">Breakeven probability</span>
            <p className="t-cap text-[var(--t-3)]">Win rate minimum pour ne pas perdre, par R:R.</p>
          </div>
          <Pill tone="cy" dot="live">
            CALCULÉ LIVE
          </Pill>
        </div>

        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'f-mono text-[24px] leading-none font-bold tracking-[-0.02em] tabular-nums',
              isLowRR ? 'text-[var(--bad)]' : 'text-[var(--acc)]',
              pulse && !isLowRR && 'threshold-pulse',
            )}
          >
            {breakeven.toFixed(0)}%
          </span>
          <span className="t-eyebrow">win rate requis</span>
        </div>

        <p className="t-body mt-2 text-[var(--t-3)]">
          Avec 1:{rr.toFixed(2)} il te faut{' '}
          <span className="font-mono text-[var(--t-1)] tabular-nums">{breakeven.toFixed(0)}%</span>{' '}
          de wins pour être à zéro. Au-dessus = EV positif sur le long terme.
        </p>

        {/* Ladder 9-cells */}
        <div className="mt-4 grid grid-cols-5 gap-1.5 border-t border-[var(--b-subtle)] pt-4 sm:grid-cols-9">
          {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((R) => {
            const active = Math.abs(R - rr) < 0.13;
            const close = Math.abs(R - rr) < 0.5;
            const wr = Math.round((1 / (1 + R)) * 100);
            return (
              <button
                key={R}
                type="button"
                onClick={() => update('plannedRR', R)}
                disabled={disabled}
                className={cn(
                  'rounded-control p-1.5 text-center transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                  active
                    ? 'border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] shadow-[0_0_0_3px_oklch(0.879_0.231_130_/_0.10)]'
                    : close
                      ? 'border border-[var(--b-acc)] bg-[var(--acc-dim-2)]'
                      : 'border border-[var(--b-subtle)] hover:border-[var(--b-default)]',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <div className="font-mono text-[10px] text-[var(--t-4)] tabular-nums">
                  1:{R.toFixed(R % 1 === 0 ? 0 : 1)}
                </div>
                <div
                  className={cn(
                    'mt-0.5 font-mono text-[12px] font-semibold tabular-nums',
                    active ? 'text-[var(--acc)]' : 'text-[var(--t-2)]',
                  )}
                >
                  {wr}%
                </div>
              </button>
            );
          })}
        </div>
        <p className="t-foot mt-3 text-[var(--t-4)]">
          EV = (WR × R) − (1 − WR). Hors frais &amp; swap.
        </p>
      </Card>
    </div>
  );
}

function StepDisciplineEmotions({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <TradeQualitySelector
        value={draft.tradeQuality}
        onChange={(v) => update('tradeQuality', v)}
        disabled={disabled}
        error={fieldErrors.tradeQuality}
      />
      <RadioGroup
        legend="Plan respecté ?"
        name="planRespected"
        value={draft.planRespected === null ? '' : String(draft.planRespected)}
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Non' },
        ]}
        onChange={(v) => update('planRespected', v === 'true')}
        disabled={disabled}
        error={fieldErrors.planRespected}
      />
      <RadioGroup
        legend="Hedge respecté ?"
        name="hedgeRespected"
        value={draft.hedgeRespected}
        options={[
          { value: 'true', label: 'Oui' },
          { value: 'false', label: 'Non' },
          { value: 'na', label: 'N/A' },
        ]}
        onChange={(v) => update('hedgeRespected', v as DraftState['hedgeRespected'])}
        disabled={disabled}
        error={fieldErrors.hedgeRespected}
      />
      <EmotionPicker
        value={draft.emotionBefore}
        onChange={(v) => update('emotionBefore', v)}
        name="emotionBefore"
        label="Émotion(s) avant l'entrée"
        disabled={disabled}
      />
      {fieldErrors.emotionBefore ? (
        <p className="text-[11px] text-[var(--bad)]" role="alert">
          {fieldErrors.emotionBefore}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="t-eyebrow-lg text-[var(--t-3)]">
          Notes (optionnel)
        </label>
        <textarea
          id="notes"
          value={draft.notes}
          onChange={(e) => update('notes', e.target.value)}
          disabled={disabled}
          rows={3}
          maxLength={2000}
          placeholder="Setup, contexte, déclencheur…"
          className={cn(
            'rounded-input w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
            'placeholder:text-[var(--t-4)]',
            'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
            'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        />
      </div>
    </div>
  );
}

function StepEntryScreenshot({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="t-body text-[var(--t-2)]">
        Capture obligatoire avant entrée — preuve que tu as analysé le setup. C&apos;est la couche
        d&apos;audit comportemental la plus solide.
      </p>
      <ScreenshotUploader
        kind="trade-entry"
        name="screenshotEntryKey"
        initialKey={draft.screenshotEntryKey || null}
        initialReadUrl={draft.screenshotEntryReadUrl || null}
        disabled={disabled}
        error={fieldErrors.screenshotEntryKey}
        onUploaded={({ key, readUrl }) => {
          update('screenshotEntryKey', key);
          update('screenshotEntryReadUrl', readUrl);
        }}
        onCleared={() => {
          update('screenshotEntryKey', '');
          update('screenshotEntryReadUrl', '');
        }}
      />
    </div>
  );
}

// ============================================================
// BUILDING BLOCKS
// ============================================================

/**
 * V1.5 — Steenbarger setup quality classification (Daily Trading Coach).
 *
 * Captured BEFORE the outcome is known so it cannot rationalize a posteriori
 * ("ce trade gagnant était un A" — biais de résultat). Three buckets,
 * mutually exclusive, optional capture (member can skip if undecided).
 *
 * Tooltips are pedagogical (Steenbarger's exact framing) — no judgment, just
 * description. The picker uses the same visual treatment as the Direction
 * Long/Short cards for consistency.
 */
function TradeQualitySelector({
  value,
  onChange,
  disabled,
  error,
}: {
  value: 'A' | 'B' | 'C' | '';
  onChange: (next: 'A' | 'B' | 'C' | '') => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
}) {
  const options = [
    {
      value: 'A' as const,
      label: 'A — Setup parfait',
      hint: 'Conviction haute, contexte favorable, le marché te dit oui sur tous les fronts.',
      tone: 'ok' as const,
    },
    {
      value: 'B' as const,
      label: 'B — Setup correct',
      hint: 'Conviction moyenne ou contexte mitigé. Acceptable mais à surveiller.',
      tone: 'cy' as const,
    },
    {
      value: 'C' as const,
      label: 'C — Setup limite',
      hint: 'Conviction basse ou doute sur le contexte. À éviter idéalement.',
      tone: 'bad' as const,
    },
  ];
  const errorId = error ? 'tradeQuality-error' : undefined;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errorId}>
      <legend className="t-eyebrow-lg mb-1 flex items-center gap-2 text-[var(--t-3)]">
        Qualité du setup
        <span className="text-[10px] tracking-normal text-[var(--t-4)] normal-case">
          (optionnel — Steenbarger A/B/C)
        </span>
      </legend>
      <div
        role="radiogroup"
        aria-label="Qualité du setup A B C"
        className="grid gap-2 sm:grid-cols-3"
      >
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              // Click an already-selected card to clear the field (back to "not captured").
              onClick={() => onChange(active ? '' : opt.value)}
              disabled={disabled}
              className={cn(
                'rounded-card flex min-h-20 flex-col items-start gap-1 border bg-[var(--bg-1)] px-3 py-2.5 text-left transition-all',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
                active
                  ? opt.tone === 'ok'
                    ? 'border-[var(--ok)] bg-[var(--ok-dim-2)] text-[var(--ok)] shadow-[0_0_0_3px_oklch(0.804_0.181_145_/_0.10)]'
                    : opt.tone === 'cy'
                      ? 'border-[var(--cy)] bg-[var(--cy-dim-2)] text-[var(--cy)] shadow-[0_0_0_3px_oklch(0.78_0.16_240_/_0.10)]'
                      : 'border-[var(--bad)] bg-[var(--bad-dim-2)] text-[var(--bad)] shadow-[0_0_0_3px_oklch(0.7_0.165_22_/_0.10)]'
                  : 'border-[var(--b-default)] text-[var(--t-3)] hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="text-[13px] font-semibold tracking-[0.06em] uppercase">
                {opt.label}
              </span>
              <span className="t-cap text-[var(--t-4)]">{opt.hint}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[11px] text-[var(--bad)]">
          {error}
        </p>
      ) : (
        <p className="t-cap text-[var(--t-4)]">
          Capture la qualité du setup AVANT de connaître l&apos;issue — bloque le biais de résultat.
          Un C qui gagne reste un C.
        </p>
      )}
    </fieldset>
  );
}

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
      <label htmlFor={id} className="t-eyebrow-lg text-[var(--t-3)]">
        {label}
      </label>
      <input
        id={id}
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

// ============================================================
// HELPERS
// ============================================================

function pairExamplePrice(pair: TradingPair | ''): string {
  if (pair === 'USDJPY') return '152.000';
  if (pair === 'XAUUSD') return '2034.50';
  if (pair === 'XAGUSD') return '24.50';
  if (pair === 'US30') return '35420.00';
  if (pair === 'NAS100') return '15800.00';
  if (pair === 'SPX500') return '4520.00';
  if (pair && (TRADING_PAIRS as readonly string[]).includes(pair)) return '1.10000';
  return '—';
}

function serverErrorMessage(state: CreateTradeActionState): string {
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
