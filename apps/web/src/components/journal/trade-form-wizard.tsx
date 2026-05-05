'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Alert } from '@/components/alert';
import { Spinner } from '@/components/spinner';
import { EmotionPicker } from '@/components/journal/emotion-picker';
import { PairAutocomplete } from '@/components/journal/pair-autocomplete';
import { ScreenshotUploader } from '@/components/journal/screenshot-uploader';
import { tradeOpenSchema, WIZARD_STEPS } from '@/lib/schemas/trade';
import { TRADING_PAIRS, type TradingPair } from '@/lib/trading/pairs';
import { detectSession, SESSION_HINT, SESSION_LABEL, SESSIONS } from '@/lib/trading/sessions';
import { createTradeAction, type CreateTradeActionState } from '@/app/journal/actions';

/**
 * Mobile-first wizard for opening a trade (J2, SPEC §7.3).
 *
 * Flow:
 *   step 0  When + what       (date, pair)
 *   step 1  Direction + session (radio cards)
 *   step 2  Prices + sizing  (entry, lot, stop-loss)
 *   step 3  R:R planned      (slider)
 *   step 4  Discipline + emotions before
 *   step 5  Entry screenshot (mandatory upload)
 *   submit  → /journal/[id]
 *
 * After submit the user lands on the trade detail page where they can
 * "Clôturer maintenant" to fill the post-exit block. We deliberately don't
 * cram the close into this wizard — separating the lifecycles avoids
 * partial drafts and matches how members actually work (open the trade,
 * then come back hours later).
 */

const STEP_TITLES = [
  'Quand & quelle paire',
  'Direction & session',
  'Prix & taille',
  'Plan : R:R prévu',
  'Discipline & émotion',
  'Capture avant entrée',
] as const;

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

interface DraftState {
  pair: string;
  direction: 'long' | 'short' | '';
  session: 'asia' | 'london' | 'newyork' | 'overlap' | '';
  enteredAt: string; // ISO local datetime-friendly (no timezone)
  entryPrice: string;
  lotSize: string;
  stopLossPrice: string;
  plannedRR: number;
  emotionBefore: string[];
  planRespected: boolean | null;
  hedgeRespected: 'true' | 'false' | 'na' | '';
  notes: string;
  screenshotEntryKey: string;
  screenshotEntryReadUrl: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:journal:draft:v1';

function nowIsoLocal(): string {
  // Format `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. Uses local
  // timezone (the user's). The Server Action converts to UTC via Date parser.
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
    plannedRR: 2,
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

  // Hydrate the draft on the client only — avoids SSR/CSR mismatch from
  // reading `localStorage` during render. The setState here intentionally
  // triggers a one-time re-render with the persisted draft; this is the
  // documented escape hatch for "sync from external store on mount".
  useEffect(() => {
    const restored = loadDraft();
    // Auto-detect session at hydration time too if the user never overrode.
    if (!restored.session) {
      restored.session = detectSession(new Date(restored.enteredAt));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(restored);
    setHydrated(true);
  }, []);

  // Persist on every change once hydrated.
  useEffect(() => {
    if (hydrated) persistDraft(draft);
  }, [draft, hydrated]);

  const update = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // Update the entered timestamp AND auto-fill the session in the same render —
  // avoids a setState-in-effect cascade. We only auto-fill if the user hasn't
  // explicitly chosen a session yet.
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

  // Focus the step heading after each transition so screen-reader users hear
  // the new title and keyboard users land at the top of the new content
  // (rather than staying on the now-disabled "Suivant" button).
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
      plannedRR: draft.plannedRR,
      emotionBefore: draft.emotionBefore,
      planRespected: draft.planRespected ?? false,
      hedgeRespected: draft.hedgeRespected || 'na',
      notes: draft.notes,
      screenshotEntryKey: draft.screenshotEntryKey,
    };
    // Use a partial parse — only check the fields the current step submitted.
    const result = tradeOpenSchema.safeParse(candidate);
    if (result.success) return true;

    // Surface only issues on the current step's fields. Other-step issues
    // bubble up at the final submit.
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

  const next = () => {
    // Step 4 has client-only invariants (radio cards) that the Zod-based
    // validateStep can't catch — enforce them inline.
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

  // Step 4 quick check — discipline radios must both be set.
  const planChosen = draft.planRespected !== null;
  const hedgeChosen = draft.hedgeRespected !== '';

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
    fd.set('plannedRR', String(draft.plannedRR));
    for (const slug of draft.emotionBefore) fd.append('emotionBefore', slug);
    fd.set('planRespected', String(draft.planRespected));
    fd.set('hedgeRespected', draft.hedgeRespected);
    if (draft.notes) fd.set('notes', draft.notes);
    fd.set('screenshotEntryKey', draft.screenshotEntryKey);

    startTransition(async () => {
      const result: CreateTradeActionState = await createTradeAction(null, fd);
      if (result.ok) {
        clearDraft();
        // Navigation is handled server-side via redirect(); this branch is
        // only hit in the unusual case where the redirect was suppressed.
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setServerError(serverErrorMessage(result));
    });
  };

  const progressPercent = Math.round(((step + 1) / 6) * 100);

  return (
    <section
      aria-labelledby="wizard-heading"
      className="mx-auto flex w-full max-w-xl flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/journal"
            className="text-muted hover:text-foreground focus-visible:outline-accent rounded text-sm underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            ← Retour au journal
          </Link>
          <span className="text-muted text-xs uppercase tracking-widest" aria-live="polite">
            Étape {step + 1} / 6
          </span>
        </div>
        <h1
          id="wizard-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-foreground focus-visible:outline-accent rounded text-2xl font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          {STEP_TITLES[step]}
        </h1>
        <div
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`Étape ${step + 1} sur 6`}
          aria-label="Progression de la saisie"
          className="flex w-full gap-1"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={[
                'h-1.5 flex-1 rounded-full transition-colors',
                i <= step ? 'bg-primary' : 'bg-secondary/60',
              ].join(' ')}
            />
          ))}
        </div>
      </header>

      {serverError ? <Alert tone="danger">{serverError}</Alert> : null}

      <div className="relative min-h-[24rem]">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={
              prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * 24 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, x: 0 } : { opacity: 0, x: direction * -24 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' }}
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

      <nav
        aria-label="Navigation du formulaire"
        className="bg-[var(--background)]/95 supports-[backdrop-filter]:bg-[var(--background)]/80 sticky bottom-0 -mx-4 flex flex-col gap-1 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={prev}
            disabled={step === 0 || pending}
            className="text-foreground hover:border-accent focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md border border-[var(--border)] px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Précédent
          </button>

          {step < 5 ? (
            <button
              type="button"
              onClick={next}
              disabled={pending}
              className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Suivant
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={pending || !draft.screenshotEntryKey}
              aria-describedby={!draft.screenshotEntryKey ? 'submit-hint' : undefined}
              className="bg-primary text-primary-foreground focus-visible:outline-accent inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Spinner />
                  <span>Enregistrement…</span>
                </>
              ) : (
                <span>Sauvegarder le trade</span>
              )}
            </button>
          )}
        </div>
        {step === 5 && !draft.screenshotEntryKey ? (
          <p id="submit-hint" className="text-muted text-right text-xs">
            Ajoute la capture pour activer la sauvegarde.
          </p>
        ) : null}
      </nav>
    </section>
  );
}

// ----- Steps -----------------------------------------------------------------

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
        <label htmlFor="enteredAt" className="text-foreground text-sm font-medium">
          Date et heure d&apos;entrée
        </label>
        <input
          id="enteredAt"
          type="datetime-local"
          value={draft.enteredAt}
          onChange={(e) => onEnteredAtChange(e.target.value)}
          disabled={disabled}
          aria-invalid={fieldErrors.enteredAt ? 'true' : undefined}
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
        {fieldErrors.enteredAt ? (
          <p className="text-danger text-xs" role="alert">
            {fieldErrors.enteredAt}
          </p>
        ) : (
          <p className="text-muted text-xs">
            Pré-rempli à maintenant — la session se devine à l&apos;étape suivante.
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
        <legend className="text-foreground mb-1 text-sm font-medium">Direction</legend>
        <div role="radiogroup" aria-label="Direction du trade" className="grid grid-cols-2 gap-2">
          {(['long', 'short'] as const).map((d) => {
            const active = draft.direction === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update('direction', d)}
                disabled={disabled}
                className={[
                  'focus-visible:outline-accent flex min-h-14 flex-col items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  active
                    ? d === 'long'
                      ? 'border-success bg-success/15 text-success'
                      : 'border-danger bg-danger/15 text-danger'
                    : 'text-muted hover:text-foreground hover:border-accent border-[var(--border)]',
                ].join(' ')}
              >
                {d === 'long' ? 'Long ↗︎' : 'Short ↘︎'}
              </button>
            );
          })}
        </div>
        {fieldErrors.direction ? (
          <p className="text-danger text-xs" role="alert">
            {fieldErrors.direction}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-foreground mb-1 text-sm font-medium">Session</legend>
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
                className={[
                  'focus-visible:outline-accent flex min-h-14 flex-col items-start justify-center rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                  active
                    ? 'border-accent bg-accent/15 text-foreground'
                    : 'text-muted hover:text-foreground hover:border-accent border-[var(--border)]',
                ].join(' ')}
              >
                <span className="font-semibold">{SESSION_LABEL[s]}</span>
                <span className="text-muted text-xs">{SESSION_HINT[s]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-muted text-xs">
          Pré-sélection :{' '}
          {draft.session ? SESSION_LABEL[draft.session as keyof typeof SESSION_LABEL] : '—'}. Tu
          peux corriger.
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
        hint="Sans stop-loss, le R réalisé sera estimé."
      />
    </div>
  );
}

function StepPlannedRR({
  draft,
  update,
  disabled,
}: {
  draft: DraftState;
  update: StepProps['update'];
  disabled?: boolean | undefined;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between">
          <label htmlFor="plannedRR" className="text-foreground text-sm font-medium">
            R:R prévu
          </label>
          <span className="text-foreground font-mono text-2xl">{draft.plannedRR.toFixed(2)}</span>
        </div>
        <input
          id="plannedRR"
          type="range"
          min={0.5}
          max={10}
          step={0.25}
          value={draft.plannedRR}
          onChange={(e) => update('plannedRR', Number(e.target.value))}
          disabled={disabled}
          aria-valuetext={`R:R ${draft.plannedRR.toFixed(2)} pour 1`}
          className="accent-[var(--primary)]"
        />
        <div className="text-muted flex justify-between text-xs">
          <span>0.5</span>
          <span>10</span>
        </div>
        <p className="text-muted text-xs">
          R:R 2 = tu risques 1 pour viser 2. Glisser pour ajuster.
        </p>
      </div>
    </div>
  );
}

function StepDisciplineEmotions({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
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
        <p className="text-danger text-xs" role="alert">
          {fieldErrors.emotionBefore}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-foreground text-sm font-medium">
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
          className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 placeholder:text-muted/70 rounded-md border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
        />
      </div>
    </div>
  );
}

function StepEntryScreenshot({ draft, update, fieldErrors, disabled }: StepProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-foreground text-sm">
        Capture obligatoire avant entrée — preuve que tu as analysé le setup.
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

// ----- Building blocks --------------------------------------------------------

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
      <label htmlFor={id} className="text-foreground text-sm font-medium">
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
        className="bg-card text-foreground focus-visible:border-accent focus-visible:ring-accent/40 placeholder:text-muted/70 rounded-md border border-[var(--border)] px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 disabled:opacity-60"
      />
      {error ? (
        <p id={errorId} className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted text-xs">
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
  // Roving tabindex: with no value selected yet, the first option is the
  // tab-stop so a keyboard user has a discoverable entry point. Once an
  // option is checked, only the checked one is tabbable (native radio
  // behaviour, see WAI-ARIA Radio Group pattern).
  const firstValue = options[0]?.value ?? '';
  const errorId = error ? `${name}-error` : undefined;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={errorId}>
      <legend className="text-foreground mb-1 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt.value;
          const tabbable = value === '' ? opt.value === firstValue : active;
          return (
            <label
              key={opt.value}
              className={[
                'focus-within:outline-accent inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                active
                  ? 'border-accent bg-accent/15 text-foreground'
                  : 'text-muted hover:text-foreground hover:border-accent border-[var(--border)]',
                disabled ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
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
        <p id={errorId} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

// ----- Helpers ----------------------------------------------------------------

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
