'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Coffee,
  Flame,
  Heart,
  Shield,
  Sparkles,
  Target,
  Wind,
  Zap,
} from 'lucide-react';
import { useActionState, useEffect, useId, useRef, useState, type ComponentType } from 'react';

import { submitPreTradeCheckAction, type PreTradeCheckActionState } from '@/app/pre-trade/actions';
import { Alert } from '@/components/alert';
import {
  type CorrelationByReason,
  MIN_SAMPLE_PER_REASON_CORRELATION,
  type PerReasonStats,
} from '@/lib/pre-trade/correlation';
import {
  PRE_TRADE_EMOTIONS,
  PRE_TRADE_REASONS,
  type PreTradeEmotion,
  type PreTradeReason,
} from '@/lib/schemas/pre-trade-check';
import { cn } from '@/lib/utils';

/**
 * V2.3 — `PreTradeCheckWizard` (ADR-003, jalon Session BB+CC).
 *
 * 4 questions one-tap (~30s) before each trade, mapped to Mark Douglas's
 * 4 primary trading fears (`Trading in the Zone`, ch.7-8) + Gollwitzer
 * if-then implementation intentions meta d=0.65 (PMC4500900). The
 * instrument is 100 % closed (4 enums + 2 booleans, ZERO free-text) so
 * there is no crisis / injection surface (`.strict()` schema, mirror of
 * V1.5 mindset).
 *
 * Mechanics: faithful clone of `<MindsetCheckWizard>` (V1.5):
 *   - `useActionState` + form action (hidden inputs, "submit everything").
 *   - localStorage draft (versioned key) + SSR-safe hydration.
 *   - Framer Motion `<AnimatePresence mode="wait">` + `m.div`
 *     (the LazyMotion ancestor is mounted in the app shell).
 *   - APG radiogroup roving tabindex (arrow keys / Home / End) for
 *     Steps 1-2 (4 options) AND Steps 3-4 (2 options).
 *   - Focus-on-step-change to the dimension heading (SR users).
 *
 * DS-v2 NEUTRAL/lime identity — NEVER `--cy` (training-only, §21.7),
 * NEVER `.v18-*` (REFLECT-only).
 *
 * Posture §2 + ADR-003 §Scope V1 + ADR-003 §Alternatives:
 *   - NO free-text → no `safeFreeText` import, no banner EU AI Act, no
 *     `*.crisis_detected` slug.
 *   - NO Skip button — friction IS the feature (ADR-003 Alt 3 reject).
 *   - NO bloquant — wizard is a mirror, not a gate (master §29 R1).
 *   - Mark Douglas paraphrases ≤30 mots (fair use FR L122-5), NEVER
 *     verbatim quotes (no validated standalone quote from ch.7-8).
 */

const DRAFT_STORAGE_KEY = 'fxmily:pre-trade:draft:v1';

// ============================================================================
// Step content metadata (frozen — anti-regression vs UI drift)
// ============================================================================

const REASON_OPTIONS: ReadonlyArray<{
  value: PreTradeReason;
  label: string;
  caption: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  {
    value: 'edge',
    label: 'Edge / setup éprouvé',
    caption: 'Je suis dans ma routine. Le pattern est connu.',
    icon: Target,
  },
  {
    value: 'fomo',
    label: 'Peur de rater',
    caption: 'Je ne veux pas rater quelque chose.',
    icon: Flame,
  },
  {
    value: 'revenge',
    label: 'Compenser une perte',
    caption: 'Je veux récupérer une perte récente.',
    icon: Zap,
  },
  {
    value: 'boredom',
    label: 'Envie de faire quelque chose',
    caption: "Je m'ennuie. J'ai besoin d'action.",
    icon: Coffee,
  },
];

const EMOTION_OPTIONS: ReadonlyArray<{
  value: PreTradeEmotion;
  label: string;
  caption: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { value: 'calme', label: 'Calme', caption: 'Posé, clair, en contrôle.', icon: Wind },
  {
    value: 'excite',
    label: 'Excité',
    caption: 'Énergie haute, presque euphorique.',
    icon: Sparkles,
  },
  { value: 'frustre', label: 'Frustré', caption: 'Agacé, sous tension.', icon: Flame },
  { value: 'anxieux', label: 'Anxieux', caption: 'Tendu, incertain, hésitant.', icon: Heart },
];

// The typed `value: PreTradeReason` / `value: PreTradeEmotion` constraints
// above guarantee each option's value is a valid enum member. A new value
// added to `PRE_TRADE_REASONS` / `PRE_TRADE_EMOTIONS` without an entry here
// would render as a missing option (visible in review), but TS does not
// enforce exhaustiveness via tuple length alone — caught by `pre-trade-check
// .test.ts` anti-regression assertion on the enum tuples.

const STEP_LABELS = ['Raison', 'Émotion', 'Plan', 'Stop-loss'] as const;
const TOTAL_STEPS = STEP_LABELS.length;

// ============================================================================
// Draft state + localStorage
// ============================================================================

interface DraftState {
  reasonToTrade: PreTradeReason | '';
  emotionLabel: PreTradeEmotion | '';
  planAlignment: boolean | null;
  stopLossPredefined: boolean | null;
}

function emptyDraft(): DraftState {
  return {
    reasonToTrade: '',
    emotionLabel: '',
    planAlignment: null,
    stopLossPredefined: null,
  };
}

function loadDraft(): DraftState {
  if (typeof window === 'undefined') return emptyDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return {
      reasonToTrade: isValidReason(parsed.reasonToTrade) ? parsed.reasonToTrade : '',
      emotionLabel: isValidEmotion(parsed.emotionLabel) ? parsed.emotionLabel : '',
      planAlignment: typeof parsed.planAlignment === 'boolean' ? parsed.planAlignment : null,
      stopLossPredefined:
        typeof parsed.stopLossPredefined === 'boolean' ? parsed.stopLossPredefined : null,
    };
  } catch {
    return emptyDraft();
  }
}

function isValidReason(v: unknown): v is PreTradeReason {
  return typeof v === 'string' && (PRE_TRADE_REASONS as readonly string[]).includes(v);
}
function isValidEmotion(v: unknown): v is PreTradeEmotion {
  return typeof v === 'string' && (PRE_TRADE_EMOTIONS as readonly string[]).includes(v);
}

function persistDraft(d: DraftState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* quota / private-mode — ignore */
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

// ============================================================================
// Wizard
// ============================================================================

export function PreTradeCheckWizard({
  correlation = null,
  correlationWindowDays = 30,
}: {
  /** Member's own per-reason outcome stats (Session 21 mirror). `null` when
   * the load failed — the wizard degrades to no mirror (honest silence). */
  correlation?: CorrelationByReason | null;
  correlationWindowDays?: number;
} = {}) {
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft());
  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState<PreTradeCheckActionState | null, FormData>(
    submitPreTradeCheckAction,
    null,
  );

  // SSR-safe hydration (carbon V1.5 / J5 pattern).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persistDraft(draft);
  }, [draft, hydrated]);

  // Focus the step heading on step change (APG). Skip first mount so the
  // initial keyboard/SR navigation lands on the progress chrome.
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function setField<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function isStepValid(s: number): boolean {
    if (s === 0) return draft.reasonToTrade !== '';
    if (s === 1) return draft.emotionLabel !== '';
    if (s === 2) return draft.planAlignment !== null;
    if (s === 3) return draft.stopLossPredefined !== null;
    return false;
  }
  const allValid = [0, 1, 2, 3].every(isStepValid);
  const stepValid = isStepValid(step);
  const safeStep = Math.max(0, Math.min(step, TOTAL_STEPS - 1));

  // Micro-feedback: a one-shot confirm flash on the step body + an accent pulse
  // on the Suivant button the moment the current step becomes valid (an answer
  // is chosen). Compositor/one-shot only; the global reduced-motion net settles
  // both animations instantly. The key is `${step}` so the effect re-runs (and
  // re-arms) on each step change, and the local flag fires the flash only on the
  // first render of a step where the answer is present — i.e. the moment it
  // flips valid — not on every keystroke once already valid.
  const [confirmPulse, setConfirmPulse] = useState(false);
  const armedStepRef = useRef<number | null>(null);
  useEffect(() => {
    // Skip if we already flashed for this step instance, or the step is not yet
    // valid (waiting for the user to answer).
    if (!stepValid || armedStepRef.current === step) return undefined;
    armedStepRef.current = step;
    setConfirmPulse(true);
    const t = setTimeout(() => setConfirmPulse(false), 700);
    return () => clearTimeout(t);
  }, [stepValid, step]);

  // Re-arm when leaving a step so coming back re-flashes its confirmation.
  useEffect(() => {
    return () => {
      armedStepRef.current = null;
    };
  }, [step]);

  const formError = state?.error;
  const errors = state?.fieldErrors;

  // Drop the draft right before the form submission fires — the action will
  // throw NEXT_REDIRECT on success, so this `onSubmit` runs synchronously
  // before navigation. On a server error the draft is **preserved** (we only
  // call `clearDraft()` when `allValid`, AND the action would not throw on
  // error so handleSubmit's call still runs — but Next.js form action error
  // paths re-render the same page with `state.error` set, so the localStorage
  // draft remains untouched by setDraft and the user keeps their answers for
  // a quick retry).
  function handleSubmit() {
    if (allValid) clearDraft();
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-6"
      data-slot="pre-trade-wizard"
      aria-labelledby="ptw-heading"
    >
      {/* Hidden payload — server is the authority. Booleans are submitted as
          'true' / 'false' strings; the Server Action's `coerceBool` maps
          them back to JS booleans before Zod safeParse. */}
      <input type="hidden" name="reasonToTrade" value={draft.reasonToTrade} />
      <input type="hidden" name="emotionLabel" value={draft.emotionLabel} />
      <input
        type="hidden"
        name="planAlignment"
        value={draft.planAlignment === null ? '' : draft.planAlignment ? 'true' : 'false'}
      />
      <input
        type="hidden"
        name="stopLossPredefined"
        value={draft.stopLossPredefined === null ? '' : draft.stopLossPredefined ? 'true' : 'false'}
      />

      {/* Preamble — calm, non-coercive. Frame the wizard as a mirror. */}
      <p className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
        Pause 30 secondes. 4 questions pour observer ce qui se passe AVANT d&apos;entrer. Pas de
        bonne ni de mauvaise réponse, c&apos;est un miroir.
      </p>

      <StepProgress current={safeStep + 1} total={TOTAL_STEPS} labels={STEP_LABELS} />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'invalid_input' ? (
        <Alert tone="danger">
          {`Une réponse manque, utilise « Précédent » pour la compléter.`}
        </Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      <div className="relative min-h-[320px]">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={safeStep}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={{
              duration: reduceMotion ? 0 : 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={cn('rounded-card flex flex-col gap-6', confirmPulse && 'confirm-flash')}
          >
            {safeStep === 0 ? (
              <>
                <StepCardGroup
                  headingRef={headingRef}
                  eyebrow="Étape 1 sur 4"
                  title="Pourquoi tu prends ce trade ?"
                  description="La première raison qui te vient. Pas la version polie."
                  name="reasonToTrade__radio"
                  value={draft.reasonToTrade}
                  onChange={(v) => setField('reasonToTrade', v as PreTradeReason)}
                  options={REASON_OPTIONS}
                  error={errors?.reasonToTrade}
                />
                {/* Session 21 — empirical mirror the instant a reason is picked. */}
                {hydrated && correlation && draft.reasonToTrade !== '' ? (
                  <ReasonMirror
                    stats={correlation[draft.reasonToTrade]}
                    label={
                      REASON_OPTIONS.find((o) => o.value === draft.reasonToTrade)?.label ??
                      draft.reasonToTrade
                    }
                    windowDays={correlationWindowDays}
                  />
                ) : null}
              </>
            ) : null}
            {safeStep === 1 ? (
              <StepCardGroup
                headingRef={headingRef}
                eyebrow="Étape 2 sur 4"
                title="Comment tu te sens, là, maintenant ?"
                description="Pose la main sur le clavier. Ressens d'abord, choisis ensuite."
                name="emotionLabel__radio"
                value={draft.emotionLabel}
                onChange={(v) => setField('emotionLabel', v as PreTradeEmotion)}
                options={EMOTION_OPTIONS}
                error={errors?.emotionLabel}
              />
            ) : null}
            {safeStep === 2 ? (
              <StepBoolean
                headingRef={headingRef}
                eyebrow="Étape 3 sur 4"
                title="Ce trade respecte ton plan ?"
                description="Setup, session, RR, taille. Tout est dans ta routine documentée ?"
                name="planAlignment__radio"
                value={draft.planAlignment}
                onChange={(v) => setField('planAlignment', v)}
                error={errors?.planAlignment}
                paraphrase="Dans l'esprit de Mark Douglas : la bonne exécution n'est pas un trade gagnant, c'est un trade conforme à ton plan."
                icon={Shield}
              />
            ) : null}
            {safeStep === 3 ? (
              <StepBoolean
                headingRef={headingRef}
                eyebrow="Étape 4 sur 4"
                title="Ton stop-loss est défini AVANT d'entrer ?"
                description="Prix concret, pas une intention « je verrai bien »."
                name="stopLossPredefined__radio"
                value={draft.stopLossPredefined}
                onChange={(v) => setField('stopLossPredefined', v)}
                error={errors?.stopLossPredefined}
                paraphrase="Dans l'esprit de Mark Douglas : accepter le risque AVANT l'entrée fait disparaître la peur de perdre."
                icon={Shield}
              />
            ) : null}
          </m.div>
        </AnimatePresence>
      </div>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (anti
          Black-Hat). a11y WCAG 3.3.1 + V1.5 mindset carbone. */}
      <p className="sr-only" role="status" aria-live="polite">
        {safeStep < TOTAL_STEPS - 1
          ? stepValid
            ? ''
            : 'Choisis une réponse à cette étape pour passer à la suivante.'
          : allValid
            ? ''
            : 'Réponds aux 4 questions pour enregistrer.'}
      </p>

      {/* Sticky bottom CTA bar — DS-v2 neutral, safe-area aware. */}
      <div
        className="sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-[var(--b-default)] bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        {safeStep > 0 ? (
          <button
            type="button"
            onClick={() => setStep(safeStep - 1)}
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

        {safeStep < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={() => setStep(safeStep + 1)}
            disabled={!stepValid}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid
                ? 'bg-[var(--acc-btn)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
              confirmPulse && stepValid && 'threshold-pulse',
            )}
          >
            Suivant
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!allValid || isPending}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-5 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              allValid && !isPending
                ? 'bg-[var(--acc-btn)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Enregistrement…' : 'Prends ton temps · enregistrer'}
            <Check size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="t-cap text-center text-[var(--t-4)]">Le trade peut attendre. Toi non.</p>
    </form>
  );
}

// ============================================================================
// Reason mirror (Session 21 elevation — empirical, fact-only, posture §2)
// ============================================================================

export interface ReasonMirrorContent {
  /** `fact` = enough linked trades, show the empirical breakdown ; `pending`
   * = honest "not enough data yet" (never fabricate a stat). */
  tone: 'fact' | 'pending';
  text: string;
}

/**
 * Build the member's own empirical mirror for a freshly-picked reason.
 *
 * Pure (no Date / no I/O) so it is unit-testable. Posture §2 strict : the
 * output is FACT-ONLY ("tes trades fomo : 30% gagnants, 60% perdants, n=12") —
 * never a verdict, never "évite", never a trade suggestion. The member reads
 * what the number means. Honest absence below the per-reason sample floor
 * (`MIN_SAMPLE_PER_REASON_CORRELATION`) — we surface the progress, not a
 * fabricated rate.
 */
export function buildReasonMirror(
  stats: PerReasonStats,
  label: string,
  windowDays: number,
): ReasonMirrorContent {
  const reasonText = label.toLowerCase();
  if (stats.kind === 'insufficient_data') {
    if (stats.reason === 'no_linked_trades') {
      return {
        tone: 'pending',
        text: `Aucun trade « ${reasonText} » relié pour l'instant, ton miroir apparaîtra dès que tu en auras quelques-uns.`,
      };
    }
    const remaining = MIN_SAMPLE_PER_REASON_CORRELATION - stats.sampleSize;
    return {
      tone: 'pending',
      text: `Encore ${remaining} trade${remaining > 1 ? 's' : ''} « ${reasonText} » reliés et ton miroir s'affichera (${stats.sampleSize}/${MIN_SAMPLE_PER_REASON_CORRELATION}).`,
    };
  }

  const winPct = Math.round(stats.winRate * 100);
  const lossPct = Math.round(stats.lossRate * 100);
  let text = `Sur tes ${stats.sampleSize} trades « ${reasonText} » des ${windowDays} derniers jours : ${winPct}% gagnants · ${lossPct}% perdants`;
  if (stats.avgRealizedR !== null) {
    const avg = stats.avgRealizedR;
    const signed = `${avg >= 0 ? '+' : ''}${avg.toFixed(1)}`;
    text += ` · ${signed}R en moyenne (n=${stats.avgRSampleSize})`;
  }
  text += '.';
  return { tone: 'fact', text };
}

function ReasonMirror({
  stats,
  label,
  windowDays,
}: {
  stats: PerReasonStats;
  label: string;
  windowDays: number;
}) {
  const content = buildReasonMirror(stats, label, windowDays);
  // aria-live so screen-reader users hear the mirror appear after the choice.
  return (
    <aside
      aria-live="polite"
      data-slot="reason-mirror"
      data-tone={content.tone}
      className={cn(
        'rounded-card flex items-start gap-3 border p-4 transition-colors duration-200',
        content.tone === 'fact'
          ? 'border-[var(--b-acc)] bg-[var(--acc-dim)]'
          : 'border-[var(--b-default)] bg-[var(--bg-2)]',
      )}
    >
      <Sparkles
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          content.tone === 'fact' ? 'text-[var(--acc)]' : 'text-[var(--t-3)]',
        )}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-1">
        {content.tone === 'fact' ? (
          <p className="t-eyebrow-lg text-[var(--t-3)]">Ton miroir empirique</p>
        ) : null}
        <p className="t-body text-[var(--t-2)]">{content.text}</p>
        {content.tone === 'fact' ? (
          <p className="t-cap text-[var(--t-3)]">
            Juste une observation de tes propres données. À toi de lire ce qu&apos;elle raconte.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

// ============================================================================
// Step Progress (4-step bar — same a11y semantics as J5)
// ============================================================================

function StepProgress({
  current,
  total,
  labels,
}: {
  current: number;
  total: number;
  labels: readonly string[];
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuetext={`Étape ${current} sur ${total}: ${labels[current - 1] ?? ''}`}
      aria-label="Progression du circuit breaker pré-trade"
      className="flex w-full gap-1"
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            'rounded-pill h-1 flex-1 transition-all duration-300',
            i + 1 < current
              ? 'bg-[var(--acc)]'
              : i + 1 === current
                ? 'bg-[var(--acc)] shadow-[0_0_8px_oklch(0.62_0.19_254_/_0.55)]'
                : 'bg-[var(--b-default)]',
          )}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Step — Card group (4 options, Steps 1-2)
// ============================================================================

interface CardGroupOption {
  value: string;
  label: string;
  caption: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}

function StepCardGroup({
  headingRef,
  eyebrow,
  title,
  description,
  name,
  value,
  options,
  onChange,
  error,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  eyebrow: string;
  title: string;
  description: string;
  name: string;
  value: string;
  options: ReadonlyArray<CardGroupOption>;
  onChange: (next: string) => void;
  error?: string | undefined;
}) {
  const labelId = useId();
  const errorId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(delta: number) {
    if (options.length === 0) return;
    // APG: from an empty group the first arrow selects the focused (first)
    // radio, not its neighbour (V1.5 BUG-2 a11y carbone).
    if (selectedIndex < 0) {
      const first = options[0];
      if (first) onChange(first.value);
      return;
    }
    const next = (selectedIndex + delta + options.length) % options.length;
    const target = options[next];
    if (target) onChange(target.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home': {
        e.preventDefault();
        const first = options[0];
        if (first) onChange(first.value);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = options[options.length - 1];
        if (last) onChange(last.value);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="t-eyebrow-lg text-[var(--t-3)]">{eyebrow}</p>
        <h2
          id={labelId}
          ref={headingRef}
          tabIndex={-1}
          className="t-h1 text-[var(--t-1)] outline-none focus-visible:outline-none"
        >
          {title}
        </h2>
        <p className="t-cap text-[var(--t-3)]">{description}</p>
      </header>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
      >
        {options.map((opt, i) => {
          const checked = opt.value === value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${opt.label} · ${opt.caption}`}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(opt.value)}
              data-name={name}
              className={cn(
                'wow-hover-glow rounded-card flex min-h-[88px] items-start gap-3 border p-4 text-left transition-[color,background-color,border-color,transform] duration-150 hover:-translate-y-px',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] focus-visible:outline-solid',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)]'
                  : 'border-[var(--b-default)] bg-[var(--bg-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]',
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  'rounded-control grid h-9 w-9 shrink-0 place-items-center border',
                  checked
                    ? 'border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]'
                    : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
                )}
              >
                {checked ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    'text-[14px] leading-tight font-semibold',
                    checked ? 'text-[var(--acc)]' : 'text-[var(--t-1)]',
                  )}
                >
                  {opt.label}
                </span>
                <span className="text-[12px] leading-[1.4] text-[var(--t-3)]">{opt.caption}</span>
              </div>
            </button>
          );
        })}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ============================================================================
// Step — Boolean (Oui / Non, Steps 3-4) with Douglas paraphrase
// ============================================================================

function StepBoolean({
  headingRef,
  eyebrow,
  title,
  description,
  name,
  value,
  onChange,
  error,
  paraphrase,
  icon: Icon,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  eyebrow: string;
  title: string;
  description: string;
  name: string;
  value: boolean | null;
  onChange: (next: boolean) => void;
  error?: string | undefined;
  paraphrase: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  const labelId = useId();
  const errorId = useId();
  const options: Array<{ value: 'true' | 'false'; label: string; bool: boolean }> = [
    { value: 'true', label: 'Oui', bool: true },
    { value: 'false', label: 'Non', bool: false },
  ];
  const currentStr: 'true' | 'false' | '' = value === null ? '' : value ? 'true' : 'false';
  const selectedIndex = options.findIndex((o) => o.value === currentStr);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(delta: number) {
    if (selectedIndex < 0) {
      const first = options[0];
      if (first) onChange(first.bool);
      return;
    }
    const next = (selectedIndex + delta + options.length) % options.length;
    const target = options[next];
    if (target) onChange(target.bool);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Home': {
        e.preventDefault();
        const first = options[0];
        if (first) onChange(first.bool);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = options[options.length - 1];
        if (last) onChange(last.bool);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="t-eyebrow-lg text-[var(--t-3)]">{eyebrow}</p>
        <h2
          id={labelId}
          ref={headingRef}
          tabIndex={-1}
          className="t-h1 text-[var(--t-1)] outline-none focus-visible:outline-none"
        >
          {title}
        </h2>
        <p className="t-cap text-[var(--t-3)]">{description}</p>
      </header>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-2 gap-2.5"
      >
        {options.map((opt, i) => {
          const checked = opt.value === currentStr;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={opt.label}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(opt.bool)}
              data-name={name}
              className={cn(
                'wow-hover-glow rounded-card flex min-h-[60px] items-center justify-center gap-2 border px-4 py-3 text-[14px] font-semibold transition-[color,background-color,border-color,transform] duration-150 hover:-translate-y-px',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] focus-visible:outline-solid',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]'
                  : 'border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]',
              )}
            >
              {checked ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" /> : null}
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Mark Douglas paraphrase — frame the question without coercing.
          Calm tone, ≤30 mots, fair-use FR L122-5 (paraphrase, not quote). */}
      <aside
        className="rounded-card flex items-start gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
        aria-label="Repère psychologie trader"
      >
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acc)]"
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <p className="t-body text-[var(--t-2)]">{paraphrase}</p>
      </aside>

      {error ? (
        <p id={errorId} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
