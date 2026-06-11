'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Phone, Sparkles } from 'lucide-react';
import { useActionState, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  appendAnswerAction,
  finalizeInterviewAction,
  type AppendAnswerActionState,
  type FinalizeInterviewActionState,
} from '@/app/onboarding/interview/actions';
import { Alert } from '@/components/alert';
import { V18_SPRING, V18_SPRING_TIGHT } from '@/components/v18/motion-presets';
import {
  ONBOARDING_INSTRUMENT_V1,
  type OnboardingItem,
  type OnboardingPhase,
} from '@/lib/onboarding-interview/instrument-v1';
import {
  ONBOARDING_ANSWER_MAX_CHARS,
  ONBOARDING_ANSWER_MIN_CHARS,
} from '@/lib/schemas/onboarding-interview';
import { CRISIS_RESOURCES_FR } from '@/lib/safety/crisis-detection';
import { cn } from '@/lib/utils';

/**
 * V2.4 Phase B — OnboardingInterviewWizard (Session A frontend, M3 directive
 * 2026-05-28).
 *
 * 30-question deep-interview wizard backing `/onboarding/interview/new`.
 * Pattern carbone hybride per Round 3 audit hardcore (3 sub-agents convergence):
 *
 *   - **80% V1.5 `MindsetCheckWizard`** — DS-v2 NEUTRAL/lime identity (NEVER
 *     `.v18-theme` REFLECT-only, NEVER `--cy` §21.7 training-only), Framer
 *     `m.*` + `AnimatePresence mode="wait"`, `useReducedMotion` gating,
 *     hidden-input "submit everything", APG focus-on-step-change heading,
 *     sticky safe-area CTA bar, localStorage per-question draft.
 *
 *   - **15% V1.8 REFLECT** — crisis routing UX (FR resources `3114` + SOS
 *     Amitié + Suicide Écoute), persist-anyway Q4=A on crisis MEDIUM/HIGH
 *     (silent skip would break the wizard), calm copy "Si tu traverses un
 *     moment difficile" non-alarmist. Crisis banner rendered DS-v2 lime
 *     (forks `V18CrisisBanner` → `--bad`/`--warn` tokens, not v18 OKLCH
 *     literals).
 *
 *   - **5% V2.3 PreTrade** — `useActionState` discriminated state pattern,
 *     `<QuestionStep key={currentStep}>` resets state on step advance.
 *
 * Innovation UX Round 3 decisions verrouillées :
 *
 *   - **Progress segmentée par groupe** (Phase 2/3 — "Core — Question 14/22")
 *     instead of "Question 14/30" flat. Honors the 3-phase journey
 *     (warmup → core → reflective_close) ; rolling weighted estimation of
 *     remaining minutes (JS-measured average answer typing time).
 *
 *   - **Mobile 9 min cap STRICT** — estimation surfaced via dedicated row.
 *     Long answers don't penalize the membre subjectively ("encore 4 min"
 *     drift-honest rather than "30 questions left" demotivating).
 *
 *   - **localStorage per-question + prompt explicite resume** (R7 §C #3
 *     shared-device risk) — on mount, if a draft exists for the current
 *     question that DIFFERS from server state, prompt "Reprendre la
 *     brouillon ?" before silently overwriting (Y/N modal).
 *
 *   - **Pas de skip de question** — chaque réponse est obligatoire (≥10
 *     caractères, `answerTextSchema`). NB : un "skip OPT-IN" via un marqueur
 *     `_skipped: '1'` avait été envisagé (R7 §E) mais n'est PAS implémenté
 *     (ni bouton "Passer", ni champ `_skipped`, ni branche serveur). À cadrer
 *     en jalon dédié si le besoin est confirmé.
 *
 *   - **Crisis routing UX = persist QUAND MÊME** (R6 §C) + banner FR +
 *     audit slug separate. Returned crisisLevel from action triggers the
 *     inline banner ; wizard advances to next question (membre keeps
 *     moving).
 *
 *   - **Injection warning = persist anyway** (R6 §C) + audit + calm warning
 *     "Ta réponse a été enregistrée. Si tu testais l'IA, sache que les
 *     consignes système ne peuvent pas être contournées".
 *
 * Posture §27.7 longitudinal-validity invariant enforced :
 *   - Instrument v1 is FROZEN. Item ids + dimensionIds + questionIndex are
 *     immutable. `CURRENT_INSTRUMENT_VERSION` constant pinned. Any change
 *     ⇒ v2 bump + migration (see `instrument-v1.ts` JSDoc).
 *
 * Posture §J / §16 — answer text NEVER echoes back via the wizard UI nor
 * via any audit slug. Crisis/injection detection happens server-side at the
 * service layer ; this wizard receives only the safe `{crisisLevel,
 * injectionSuspected}` signals.
 */

const INSTRUMENT = ONBOARDING_INSTRUMENT_V1;
const ITEMS = INSTRUMENT.items;
const TOTAL_QUESTIONS = ITEMS.length;
const INSTRUMENT_VERSION = INSTRUMENT.version;

/** Average typing speed estimate (chars per minute) — used for the
 *  estimation row. Conservative ~250 cpm = ~50 wpm sustained.
 *  Mobile-first ~30 min total per preamble (30 questions × ~200 chars
 *  ÷ 250 cpm). Round 3 R7 mobile cap = 9 min cap STRICT. */
const AVG_CHARS_PER_MINUTE = 250;
/** Floor estimation at 30 s (otherwise "0 min restant" feels off when only
 *  1 short Q is left). */
const MIN_REMAINING_SECONDS = 30;

const DRAFT_PREFIX = 'fxmily:onboarding-interview:answer:v1:';

function draftKey(questionIndex: number): string {
  return `${DRAFT_PREFIX}q-${questionIndex}`;
}

function loadDraft(questionIndex: number): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(draftKey(questionIndex)) ?? '';
  } catch {
    return '';
  }
}

function saveDraft(questionIndex: number, text: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (text.trim().length === 0) {
      window.localStorage.removeItem(draftKey(questionIndex));
    } else {
      window.localStorage.setItem(draftKey(questionIndex), text);
    }
  } catch {
    /* quota / private-mode — ignore */
  }
}

function clearAllDrafts(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const item of ITEMS) {
      window.localStorage.removeItem(draftKey(item.questionIndex));
    }
  } catch {
    /* quota / private-mode — ignore */
  }
}

// ---------------------------------------------------------------------------
// Phase-segmented progress (Round 3 §E innovation UX)
// ---------------------------------------------------------------------------

interface PhaseSegmentation {
  readonly phase: OnboardingPhase;
  readonly label: string;
  /** Position within the phase (1-indexed). */
  readonly positionInPhase: number;
  /** Total questions in this phase. */
  readonly phaseTotal: number;
}

const PHASE_LABELS: Record<OnboardingPhase, string> = {
  warmup: 'Échauffement',
  core: "Cœur de l'entretien",
  reflective_close: 'Clôture',
};

function getPhaseSegmentation(questionIndex: number): PhaseSegmentation {
  const item = ITEMS[questionIndex];
  if (!item) {
    return {
      phase: 'warmup',
      label: PHASE_LABELS.warmup,
      positionInPhase: 1,
      phaseTotal: 1,
    };
  }
  const phaseItems = ITEMS.filter((it) => it.phase === item.phase);
  const positionInPhase = phaseItems.findIndex((it) => it.questionIndex === questionIndex) + 1;
  return {
    phase: item.phase,
    label: PHASE_LABELS[item.phase],
    positionInPhase,
    phaseTotal: phaseItems.length,
  };
}

/** Estimate remaining seconds based on (a) the membre's recent typing tempo
 *  if measurable, (b) the conservative AVG_CHARS_PER_MINUTE baseline.
 *  Honest "encore environ N min" surfacing (Round 3 R7 mobile 9 min cap). */
function estimateRemainingSeconds(currentIndex: number, recentAvgCharsPerAnswer: number): number {
  const remaining = TOTAL_QUESTIONS - currentIndex - 1;
  if (remaining <= 0) return 0;
  // Use rolling avg if at least 3 measured answers ; otherwise lean on the
  // baseline (200 chars / answer, AVG_CHARS_PER_MINUTE rate).
  const charsPerAnswer = recentAvgCharsPerAnswer > 0 ? recentAvgCharsPerAnswer : 200;
  const seconds = (remaining * charsPerAnswer * 60) / AVG_CHARS_PER_MINUTE;
  return Math.max(MIN_REMAINING_SECONDS, Math.round(seconds));
}

function formatRemainingMinutes(seconds: number): string {
  if (seconds <= MIN_REMAINING_SECONDS) return 'encore 1 min';
  const minutes = Math.round(seconds / 60);
  return `encore environ ${minutes} min`;
}

// ---------------------------------------------------------------------------
// Crisis banner — DS-v2 lime/neutral fork of `V18CrisisBanner`
// ---------------------------------------------------------------------------

interface OnboardingCrisisBannerProps {
  level: 'high' | 'medium' | 'low';
}

function OnboardingCrisisBanner({ level }: OnboardingCrisisBannerProps) {
  const isHigh = level === 'high';
  const isMedium = level === 'medium';
  const toneVar = isHigh ? '--bad' : isMedium ? '--warn' : '--t-2';
  if (level === 'low') return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      data-slot="onboarding-crisis-banner"
      data-level={level}
      className="rounded-card-lg relative overflow-hidden border p-5"
      style={{
        background: 'var(--bg-2)',
        borderColor: `var(${toneVar})`,
        borderWidth: 1,
        boxShadow: `0 8px 24px -8px var(${toneVar}-dim, var(--bg-3))`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border"
          style={{
            background: 'var(--bg-3)',
            borderColor: `var(${toneVar})`,
            color: `var(${toneVar})`,
          }}
        >
          <AlertTriangle size={18} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow-lg text-[var(--t-2)]">Ressources d&apos;écoute</p>
          <h3 className="t-h2 mt-1 text-[var(--t-1)]">
            Si tu traverses un moment difficile, tu n&apos;es pas seul·e.
          </h3>
          <p className="t-body mt-2 text-[var(--t-2)]">
            Ta réponse a bien été enregistrée. Ces lignes d&apos;écoute sont gratuites,
            confidentielles et disponibles 24/7.
          </p>

          <ul className="mt-4 space-y-2.5">
            {CRISIS_RESOURCES_FR.map((r) => (
              <li key={r.phone} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={`tel:${r.phone}`}
                  className="rounded-pill inline-flex min-h-11 items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3.5 py-2 text-[13px] font-semibold text-[var(--acc-fg)] transition-[background-color,box-shadow] duration-150 hover:bg-[var(--acc-dim-2)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
                  aria-label={`Appeler ${r.name}, ${r.description}, ${r.hours}`}
                >
                  <Phone aria-hidden="true" size={14} strokeWidth={2.2} />
                  <span className="font-mono tracking-wide">{r.name}</span>
                </a>
                <span className="t-body text-[var(--t-2)]">{r.description}</span>
                <span className="t-cap text-[var(--t-3)]">· {r.hours}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Injection warning — calm copy, non-alarmist (Round 3 §C)
// ---------------------------------------------------------------------------

function InjectionWarningBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="onboarding-injection-warning"
      className="rounded-card border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--b-default)] text-[var(--t-3)]"
        >
          <Sparkles size={14} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-body text-[var(--t-2)]">
            Ta réponse a bien été enregistrée. Si tu testais l&apos;IA, sache que les consignes
            système ne peuvent pas être contournées — ton entretien suit son cours normalement.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resume prompt modal — Round 3 §C #3 explicit prompt (shared-device safety)
// ---------------------------------------------------------------------------

interface ResumePromptProps {
  onResume: () => void;
  onDiscard: () => void;
  questionCount: number;
}

function ResumePrompt({ onResume, onDiscard, questionCount }: ResumePromptProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-prompt-heading"
      className="rounded-card-lg border-2 border-[var(--b-acc)] bg-[var(--bg-2)] p-5"
    >
      <h3 id="resume-prompt-heading" className="t-h2 text-[var(--t-1)]">
        Reprendre ton brouillon ?
      </h3>
      <p className="t-body mt-2 text-[var(--t-2)]">
        Tu as un brouillon enregistré localement ({questionCount} réponse
        {questionCount > 1 ? 's' : ''}). Le reprendre va le restaurer dans le formulaire. Si tu es
        sur un appareil partagé, tu peux préférer effacer.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onResume}
          className="rounded-control inline-flex h-11 items-center gap-1.5 bg-[var(--acc-btn)] px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]"
        >
          Reprendre
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-control inline-flex h-11 items-center gap-1.5 border border-[var(--b-strong)] bg-transparent px-4 text-[13px] font-medium text-[var(--t-2)] transition-colors hover:bg-[var(--bg-3)] hover:text-[var(--t-1)]"
        >
          Effacer
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionStep — one form, its own useActionState (reset on key change)
// ---------------------------------------------------------------------------

interface QuestionStepProps {
  item: OnboardingItem;
  initialAnswer: string;
  onAdvance: (chars: number) => void;
  isLast: boolean;
  /** Existing recent average chars/answer (rolling), for honest estimation. */
  recentAvgChars: number;
  questionIndex: number;
}

function QuestionStep({
  item,
  initialAnswer,
  onAdvance,
  isLast,
  recentAvgChars,
  questionIndex,
}: QuestionStepProps) {
  const reduceMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const textareaId = useId();
  const errorId = useId();
  const counterId = useId();
  const [text, setText] = useState<string>(initialAnswer);
  const [state, formAction, isPending] = useActionState<AppendAnswerActionState | null, FormData>(
    appendAnswerAction,
    null,
  );

  // Focus the heading on mount (APG focus-on-step-change).
  useEffect(() => {
    headingRef.current?.focus();
    // Run once per key (key = currentStep) — intentionally no deps.
  }, []);

  // Persist draft on every change (carbone V1.5 mindset hydration).
  useEffect(() => {
    saveDraft(item.questionIndex, text);
  }, [item.questionIndex, text]);

  // On successful submit, advance to next question (parent owns step state) —
  // UNLESS a safety signal came back. TIER1 fix (S2 audit 2026-06-11) : the
  // crisis/injection banners are rendered by THIS step (below), so the old
  // unconditional auto-advance unmounted the step in the same render cycle
  // and the 3114 / SOS Amitié resources were NEVER visible to a member in
  // distress. On a safety hold the member reads the banner and continues
  // explicitly (the answer is already persisted — Q4=A persist-anyway).
  // `crisisLevel === 'low'` is noise by design (no banner) → still advances.
  useEffect(() => {
    if (!state?.ok) return;
    const safetyHold =
      state.crisisLevel === 'high' || state.crisisLevel === 'medium' || state.injectionSuspected;
    if (!safetyHold) {
      onAdvance(text.length);
    }
    // We intentionally depend on state only — onAdvance is parent-stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const safetyHold = Boolean(
    state?.ok &&
    (state.crisisLevel === 'high' || state.crisisLevel === 'medium' || state.injectionSuspected),
  );
  const continueBtnRef = useRef<HTMLButtonElement | null>(null);

  // Keyboard flow : when the hold engages, move focus to the explicit
  // continue button (the banner itself announces via role="alert").
  useEffect(() => {
    if (safetyHold) continueBtnRef.current?.focus();
  }, [safetyHold]);

  const trimmedLen = text.trim().length;
  const isUnderMin = trimmedLen > 0 && trimmedLen < ONBOARDING_ANSWER_MIN_CHARS;
  const isOverMax = trimmedLen > ONBOARDING_ANSWER_MAX_CHARS;
  // `!safetyHold` : during a crisis/injection hold the answer is ALREADY
  // persisted — re-submitting would re-trigger detection and loop the hold.
  // The explicit continue button is the only way forward.
  const canSubmit =
    trimmedLen >= ONBOARDING_ANSWER_MIN_CHARS && !isOverMax && !isPending && !safetyHold;
  const counterTone = isOverMax ? 'var(--bad)' : isUnderMin ? 'var(--warn)' : 'var(--t-3)';
  const fieldErrors = state?.fieldErrors;
  const remainingSec = estimateRemainingSeconds(questionIndex, recentAvgChars);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="onboarding-question-step"
      aria-labelledby={`oiw-heading-${item.id}`}
    >
      {/* Hidden payload — server is the authority. */}
      <input type="hidden" name="instrumentVersion" value={INSTRUMENT_VERSION} />
      <input type="hidden" name="questionIndex" value={String(item.questionIndex)} />
      <input type="hidden" name="questionKey" value={item.id} />

      {state?.error === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour continuer.</Alert>
      ) : null}
      {state?.error === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      {/* Crisis + injection banners — surfaced only on the JUST-submitted Q,
          based on state.crisisLevel / state.injectionSuspected. The step is
          HELD while they are visible (no auto-advance) — see safetyHold. */}
      {state?.crisisLevel ? <OnboardingCrisisBanner level={state.crisisLevel} /> : null}
      {state?.injectionSuspected ? <InjectionWarningBanner /> : null}
      {safetyHold ? (
        <button
          ref={continueBtnRef}
          type="button"
          onClick={() => onAdvance(text.length)}
          data-slot="onboarding-safety-continue"
          className="rounded-control inline-flex h-11 items-center justify-center gap-1.5 bg-[var(--acc-btn)] px-5 text-[14px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none active:translate-y-0"
        >
          J&apos;ai lu, continuer l&apos;entretien
        </button>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={item.id}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={V18_SPRING}
          className="flex flex-col gap-5"
        >
          <h2
            id={`oiw-heading-${item.id}`}
            ref={headingRef}
            tabIndex={-1}
            className="t-h1 text-[var(--t-1)] outline-none"
          >
            {item.text}
          </h2>

          <div className="flex flex-col gap-2">
            <textarea
              id={textareaId}
              name="answerText"
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              rows={6}
              maxLength={ONBOARDING_ANSWER_MAX_CHARS + 200}
              placeholder="Prends ton temps. Quelques phrases honnêtes valent mieux qu'un long discours idéalisé."
              aria-describedby={`${counterId}${fieldErrors?.answerText ? ' ' + errorId : ''}`}
              className="rounded-control min-h-[160px] w-full resize-y border border-[var(--b-strong)] bg-[var(--bg-2)] p-3 font-sans text-[15px] leading-[1.55] text-[var(--t-1)] placeholder:text-[var(--t-3)] focus-visible:border-[var(--b-acc)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
            />
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span
                id={counterId}
                style={{ color: counterTone }}
                className="font-mono tabular-nums"
              >
                {trimmedLen} / {ONBOARDING_ANSWER_MAX_CHARS} caractères
                {isUnderMin ? ` · minimum ${ONBOARDING_ANSWER_MIN_CHARS}` : ''}
              </span>
              <span className="t-cap text-[var(--t-3)]">
                {formatRemainingMinutes(remainingSec)}
              </span>
            </div>
            {fieldErrors?.answerText ? (
              <p id={errorId} role="alert" className="t-cap text-[var(--bad)]">
                {fieldErrors.answerText}
              </p>
            ) : null}
          </div>
        </m.div>
      </AnimatePresence>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (anti
          Black-Hat) — carbone V1.5 mindset WCAG 3.3.1. */}
      <p className="sr-only" role="status" aria-live="polite">
        {canSubmit
          ? ''
          : safetyHold
            ? `Ta réponse est enregistrée. Utilise le bouton « Continuer l'entretien » quand tu es prêt·e.`
            : isOverMax
              ? `Ta réponse dépasse ${ONBOARDING_ANSWER_MAX_CHARS} caractères, raccourcis-la pour continuer.`
              : `Écris au moins ${ONBOARDING_ANSWER_MIN_CHARS} caractères pour passer à la suivante.`}
      </p>

      <div
        className="sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-[var(--b-default)] bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'rounded-control inline-flex h-11 flex-1 items-center justify-center gap-1.5 text-[14px] font-semibold transition-[background-color,box-shadow,transform] duration-150',
            canSubmit
              ? 'bg-[var(--acc-btn)] text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
              : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
          )}
          aria-busy={isPending || undefined}
        >
          {isPending ? 'Envoi…' : isLast ? 'Soumettre la dernière réponse' : 'Suivant'}
          {!isPending ? (
            isLast ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <ArrowRight size={14} aria-hidden="true" />
            )
          ) : null}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Finalize step — last screen, calls finalizeInterviewAction (redirects)
// ---------------------------------------------------------------------------

function FinalizeStep() {
  const [state, formAction, isPending] = useActionState<
    FinalizeInterviewActionState | null,
    FormData
  >(finalizeInterviewAction, null);

  return (
    <form
      action={formAction}
      className="rounded-card-lg flex flex-col gap-6 border border-[var(--b-acc)] bg-[var(--bg-2)] p-6"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill mt-1 flex h-10 w-10 shrink-0 items-center justify-center border"
          style={{
            background: 'var(--acc-dim)',
            borderColor: 'var(--b-acc)',
            color: 'var(--acc)',
          }}
        >
          <Check size={18} strokeWidth={2.4} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow-lg text-[var(--t-3)]">Étape finale</p>
          <h2 className="t-h1 mt-1 text-[var(--t-1)]">Tu as terminé tes 30 questions.</h2>
          <p className="t-body mt-2 text-[var(--t-2)]">
            Eliot lit chaque réponse personnellement. Ton profil sera analysé dans les prochaines
            24h. Tu peux le retrouver à tout moment sur{' '}
            <span className="font-medium text-[var(--t-1)]">/profile</span>.
          </p>
        </div>
      </div>

      {state?.error === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi.</Alert>
      ) : null}
      {state?.error === 'no_interview' ? (
        <Alert tone="danger">
          Aucun entretien actif. Retourne sur la page de démarrage pour recommencer.
        </Alert>
      ) : null}
      {state?.error === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className={cn(
          'rounded-control inline-flex h-12 w-full items-center justify-center gap-2 text-[14px] font-semibold transition-[background-color,box-shadow,transform] duration-150',
          isPending
            ? 'cursor-not-allowed bg-[var(--bg-3)] text-[var(--t-2)] shadow-none'
            : 'bg-[var(--acc-btn)] text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] hover:-translate-y-px hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)]',
        )}
        aria-busy={isPending || undefined}
      >
        {isPending ? 'Finalisation…' : 'Terminer mon entretien'}
        {!isPending ? <Check size={16} aria-hidden="true" /> : null}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// OnboardingInterviewWizard (main)
// ---------------------------------------------------------------------------

export interface OnboardingInterviewWizardProps {
  /** Initial step index — derived server-side from existing answers count. */
  initialStep: number;
  /** Existing answers (server-truth), keyed by questionIndex → answerText. */
  initialAnswers: Readonly<Record<number, string>>;
}

export function OnboardingInterviewWizard({
  initialStep,
  initialAnswers,
}: OnboardingInterviewWizardProps) {
  const reduceMotion = useReducedMotion();
  const [currentStep, setCurrentStep] = useState<number>(
    Math.max(0, Math.min(initialStep, TOTAL_QUESTIONS)),
  );
  const [resumeChoice, setResumeChoice] = useState<'undecided' | 'resumed' | 'discarded'>(
    'undecided',
  );
  const [draftCount, setDraftCount] = useState<number>(0);
  const [recentChars, setRecentChars] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate localStorage on mount. Count drafts that DIFFER from server state
  // — they're the ones to prompt about (Round 3 §C #3 shared-device safety).
  // Canon V1.5 mindset wizard `mindset-wizard.tsx:115` carbone : SSR-safe
  // hydration pattern, setState in effect is the only way to deliver the
  // localStorage snapshot post-mount without an SSR hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    let count = 0;
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      const draft = loadDraft(i);
      const server = initialAnswers[i] ?? '';
      if (draft.trim().length > 0 && draft !== server) {
        count++;
      }
    }

    setDraftCount(count);
    // initialAnswers is server-stable for the page lifetime ; intentionally
    // not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve initial answer for the active step (resume vs server).
  const initialAnswerForStep = useMemo(() => {
    const fromServer = initialAnswers[currentStep] ?? '';
    if (resumeChoice === 'resumed') {
      const draft = loadDraft(currentStep);
      return draft || fromServer;
    }
    return fromServer;
  }, [currentStep, initialAnswers, resumeChoice]);

  const recentAvgChars =
    recentChars.length > 0
      ? Math.round(recentChars.reduce((a, b) => a + b, 0) / recentChars.length)
      : 0;

  function handleAdvance(chars: number) {
    setRecentChars((prev) => [...prev.slice(-4), chars]); // keep last 5
    setCurrentStep((s) => Math.min(TOTAL_QUESTIONS, s + 1));
  }

  function handleResume() {
    setResumeChoice('resumed');
  }

  function handleDiscard() {
    clearAllDrafts();
    setResumeChoice('discarded');
    setDraftCount(0);
  }

  // Show the resume prompt only if (a) we hydrated, (b) we found drafts that
  // differ from server, (c) user hasn't decided yet.
  const showResumePrompt = hydrated && draftCount > 0 && resumeChoice === 'undecided';

  // If we're past the last question, render the finalize step.
  const isFinalize = currentStep >= TOTAL_QUESTIONS;
  const currentItem = isFinalize ? null : ITEMS[currentStep];
  const segmentation = isFinalize ? null : getPhaseSegmentation(currentStep);

  return (
    <div className="flex flex-col gap-6" data-slot="onboarding-interview-wizard">
      {/* Preamble — surfaced once at the top, calm and posture-explicit. */}
      <p className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
        {INSTRUMENT.preamble}
      </p>

      {/* Progress segmentée par phase — Round 3 §E. */}
      {!isFinalize && segmentation && currentItem ? (
        <PhaseProgress
          currentStep={currentStep}
          phaseLabel={segmentation.label}
          positionInPhase={segmentation.positionInPhase}
          phaseTotal={segmentation.phaseTotal}
          globalIndex={currentItem.questionIndex + 1}
          totalQuestions={TOTAL_QUESTIONS}
        />
      ) : null}

      {/* Resume prompt — Round 3 §C #3. */}
      {showResumePrompt ? (
        <m.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={V18_SPRING_TIGHT}
        >
          <ResumePrompt
            onResume={handleResume}
            onDiscard={handleDiscard}
            questionCount={draftCount}
          />
        </m.div>
      ) : null}

      {/* Active step — keyed by step so useActionState resets cleanly. */}
      {isFinalize ? (
        <FinalizeStep />
      ) : currentItem ? (
        <QuestionStep
          key={`q-${currentStep}`}
          item={currentItem}
          initialAnswer={initialAnswerForStep}
          onAdvance={handleAdvance}
          isLast={currentStep === TOTAL_QUESTIONS - 1}
          recentAvgChars={recentAvgChars}
          questionIndex={currentStep}
        />
      ) : null}

      {/* Back link to previous question (server has the answer, no draft loss). */}
      {!isFinalize && currentStep > 0 ? (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
            aria-label="Revenir à la question précédente"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Revenir
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseProgress — segmented by phase per Round 3 §E
// ---------------------------------------------------------------------------

interface PhaseProgressProps {
  currentStep: number;
  phaseLabel: string;
  positionInPhase: number;
  phaseTotal: number;
  globalIndex: number;
  totalQuestions: number;
}

function PhaseProgress({
  phaseLabel,
  positionInPhase,
  phaseTotal,
  globalIndex,
  totalQuestions,
}: PhaseProgressProps) {
  const phasePercent = positionInPhase / phaseTotal;
  const globalPercent = globalIndex / totalQuestions;

  return (
    <div
      className="w-full"
      role="group"
      aria-label="Progression de l'entretien d'onboarding"
      data-slot="onboarding-phase-progress"
    >
      <div className="flex items-baseline justify-between gap-3 pb-2">
        <p className="t-mono-cap">
          {phaseLabel.toUpperCase()} — <span className="text-[var(--t-1)]">{positionInPhase}</span>{' '}
          / {phaseTotal}
        </p>
        <p className="t-cap text-[var(--t-3)]">
          Question <span className="text-[var(--t-2)]">{globalIndex}</span> / {totalQuestions}
        </p>
      </div>

      {/* Active-phase fill (lime). */}
      <div
        className="relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--b-default)]"
        data-slot="phase-bar"
      >
        <m.div
          className="absolute inset-y-0 left-0 origin-left rounded-full"
          style={{
            width: '100%',
            background: 'linear-gradient(90deg, var(--acc) 0%, var(--acc-hi) 100%)',
            boxShadow: 'var(--acc-glow)',
          }}
          initial={false}
          animate={{ scaleX: phasePercent }}
          transition={V18_SPRING_TIGHT}
          aria-hidden="true"
        />
      </div>

      {/* Global progress (subtle, secondary information). */}
      <div className="mt-1 flex items-center gap-2">
        <div className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-[var(--b-default)]">
          <m.div
            className="absolute inset-y-0 left-0 origin-left rounded-full bg-[var(--t-3)]"
            style={{ width: '100%' }}
            initial={false}
            animate={{ scaleX: globalPercent }}
            transition={V18_SPRING_TIGHT}
            aria-hidden="true"
          />
        </div>
        <span className="t-cap font-mono text-[var(--t-3)] tabular-nums">
          {Math.round(globalPercent * 100)}%
        </span>
      </div>
    </div>
  );
}
