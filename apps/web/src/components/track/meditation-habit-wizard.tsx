'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Brain, Check, NotebookPen } from 'lucide-react';
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
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { hapticError, hapticSuccess, hapticTap } from '@/lib/haptics';
import { HABIT_NOTES_MAX_CHARS } from '@/lib/schemas/habit-log';
import { cn } from '@/lib/utils';

/**
 * V2.1.1 TRACK — Méditation wizard (carbon `<SleepHabitWizard>`).
 *
 * Posture (Mark Douglas anchor): Hofmann et al. (*J. Consult. Clin.
 * Psychol.* 78, 2010) meta-analysis — ~10 min/day of mindfulness already
 * yields a robust effect on anxiety and emotional regulation, the two
 * levers that decide a trader's execution under uncertainty. The single
 * 10-min anchor is a calmer pedagogical surface than a 4-zone bar (the
 * subagent verdict for V2.1.1 explicitly kept meditation to a duration
 * anchor, not a NutritionZonesBar-style component).
 *
 * Steps :
 *   1. **Durée & qualité** : duration (0–180 min) → Hofmann 10-min anchor
 *      + optional 1–10 quality
 *   2. **Notes + confirm** : optional textarea max 500 chars + submit
 */

const STEP_TITLES = ['Durée & qualité', 'Notes & confirmation'] as const;
const STEP_ICONS = [Brain, NotebookPen] as const;
type StepIndex = 0 | 1;

const HOFMANN_ANCHOR_MIN = 10;
const ANCHOR_SCALE_MAX = 60;

const QUALITY_LABEL = (v: number): string => {
  if (v <= 3) return 'Dispersé';
  if (v <= 5) return 'Moyen';
  if (v <= 7) return 'Posé';
  return 'Profond';
};

interface DraftState {
  date: string;
  durationMin: string;
  quality: number; // 1-10
  notes: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:track:meditation:draft:v1';

function localToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(today: string): DraftState {
  return { date: today, durationMin: '', quality: 6, notes: '' };
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

/** Parse FR-locale decimals : "10" → 10. Returns NaN if invalid. */
function parseLocaleNumber(s: string): number {
  if (s.trim().length === 0) return Number.NaN;
  return Number(s.replace(',', '.'));
}

function validateStep(step: StepIndex, draft: DraftState): string | null {
  if (step === 0) {
    const n = parseLocaleNumber(draft.durationMin);
    if (Number.isNaN(n)) return 'Saisis la durée de ta séance.';
    if (!Number.isInteger(n)) return 'Une durée en minutes entières est attendue.';
    if (n < 0 || n > 180) return 'La durée doit être entre 0 et 180 min.';
  }
  return null;
}

/**
 * Minimal Hofmann-anchor track : a filled bar to the entered duration with a
 * labelled tick at the 10-min meta-analysis anchor. Decorative-only
 * (`aria-hidden`) — the caption carries the same information for SR.
 */
function HofmannAnchor({ durationMin }: { durationMin: number | null }) {
  const value =
    durationMin == null || Number.isNaN(durationMin)
      ? null
      : Math.max(0, Math.min(ANCHOR_SCALE_MAX, durationMin));
  const fillPct = value === null ? 0 : (value / ANCHOR_SCALE_MAX) * 100;
  const anchorPct = (HOFMANN_ANCHOR_MIN / ANCHOR_SCALE_MAX) * 100;
  const reached = value !== null && value >= HOFMANN_ANCHOR_MIN;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
          Ancre Hofmann
        </span>
        <span
          className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums"
          style={{ color: reached ? 'var(--acc)' : 'var(--t-3)' }}
          aria-live="polite"
        >
          {reached ? 'Ancre 10 min atteinte' : 'Cible 10 min'}
        </span>
      </div>
      <div
        aria-hidden
        className="rounded-input relative h-7 overflow-hidden border border-[var(--b-default)] bg-[var(--bg-2)]"
      >
        <div
          className="absolute top-0 left-0 h-full transition-[width] duration-150"
          style={{
            width: `${fillPct}%`,
            background: reached ? 'var(--acc-dim)' : 'var(--cy-dim)',
          }}
        />
        {/* 10-min anchor tick */}
        <div
          className="absolute top-0 h-full w-0.5"
          style={{
            left: `${anchorPct}%`,
            transform: 'translateX(-50%)',
            background: 'var(--acc)',
            boxShadow: '0 0 8px -1px var(--acc)',
          }}
        />
      </div>
      <div className="relative h-2 font-mono text-[10px] text-[var(--t-3)] tabular-nums">
        {[0, 10, 30, 60].map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${(t / ANCHOR_SCALE_MAX) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>
      <p className="t-cap text-[var(--t-3)]">
        Hofmann 2010 (méta-analyse) :{' '}
        <span className="font-mono text-[var(--t-2)] tabular-nums">10 min/jour</span> suffisent à
        réduire l&apos;anxiété et stabiliser ta régulation émotionnelle. La régularité prime sur la
        durée.
      </p>
    </div>
  );
}

export function MeditationHabitWizard() {
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

  const durationNum = parseLocaleNumber(draft.durationMin);
  const durationForBar = Number.isNaN(durationNum) ? null : durationNum;
  const hasValidDuration =
    !Number.isNaN(durationNum) &&
    Number.isInteger(durationNum) &&
    durationNum >= 0 &&
    durationNum <= 180;
  const StepIcon = STEP_ICONS[step]!;
  const totalSteps = STEP_TITLES.length;
  const animate = hasMounted && !prefersReducedMotion;

  return (
    <div className="space-y-5" onKeyDown={onKeyDown}>
      <div className="space-y-2" role="group" aria-label="Progression du wizard">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StepIcon className="h-4 w-4 text-[var(--acc)]" aria-hidden />
            <span className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
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
          <motion.div
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
          <motion.div
            key={step}
            initial={animate ? { opacity: 0, x: direction * 28 } : false}
            animate={{ opacity: 1, x: 0 }}
            exit={animate ? { opacity: 0, x: -direction * 28 } : { opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 ? (
              <MeditationStep
                draft={draft}
                setDraft={setDraft}
                stepError={stepError}
                headingRef={headingRef}
                durationForBar={durationForBar}
              />
            ) : (
              <MeditationNotesStep draft={draft} setDraft={setDraft} headingRef={headingRef} />
            )}
          </motion.div>
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
              fd.set('kind', 'meditation');
              fd.set('date', draft.date);
              fd.set('value.durationMin', String(Math.round(durationNum)));
              if (draft.quality >= 1 && draft.quality <= 10) {
                fd.set('value.quality', String(draft.quality));
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
              disabled={isPending || !hasValidDuration}
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
  durationForBar?: number | null;
}

function MeditationStep({ draft, setDraft, stepError, headingRef, durationForBar }: StepProps) {
  return (
    <Card className="space-y-5 p-4">
      <header className="space-y-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[18px] font-semibold tracking-tight text-[var(--t-1)] outline-none"
        >
          Combien de temps as-tu médité ?
        </h2>
        <p className="text-[13px] leading-relaxed text-[var(--t-3)]">
          Méditation, cohérence cardiaque, respiration consciente — tout compte. Note la qualité de
          présence ressentie en complément.
        </p>
      </header>

      <div className="space-y-3">
        <label
          htmlFor="meditation-duration"
          className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
        >
          Durée
        </label>
        <div className="flex items-baseline gap-2">
          <input
            id="meditation-duration"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={draft.durationMin}
            onChange={(e) => setDraft((d) => ({ ...d, durationMin: e.target.value }))}
            placeholder="10"
            className="rounded-input w-28 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 font-mono text-[18px] text-[var(--t-1)] tabular-nums outline-none focus-visible:border-[var(--b-acc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-invalid={stepError ? 'true' : 'false'}
            aria-describedby={stepError ? 'meditation-duration-error' : undefined}
          />
          <span className="text-[14px] text-[var(--t-3)]">minutes</span>
        </div>
        {stepError ? (
          <p id="meditation-duration-error" className="text-[12px] text-[var(--bad)]" role="alert">
            {stepError}
          </p>
        ) : null}
      </div>

      <HofmannAnchor durationMin={durationForBar ?? null} />

      <div className="space-y-3 pt-2">
        <ScoreSlider
          name="meditation-quality"
          label="Qualité de présence"
          value={draft.quality}
          onChange={(v) => setDraft((d) => ({ ...d, quality: v }))}
          describeAt={QUALITY_LABEL}
          tone="cy"
        />
      </div>
    </Card>
  );
}

function MeditationNotesStep({ draft, setDraft, headingRef }: StepProps) {
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
          Optionnel. Si tu veux noter un contexte (mental agité, séance avant la session, focus
          difficile), ça nourrit ton rapport hebdo IA dimanche.
        </p>
      </header>

      <div className="space-y-2">
        <label
          htmlFor="meditation-notes"
          className="text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase"
        >
          Note
        </label>
        <textarea
          id="meditation-notes"
          rows={5}
          value={draft.notes}
          onChange={(e) =>
            setDraft((d) => ({ ...d, notes: e.target.value.slice(0, HABIT_NOTES_MAX_CHARS) }))
          }
          maxLength={HABIT_NOTES_MAX_CHARS}
          placeholder="Cohérence cardiaque 5 min avant Londres, mental dispersé…"
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
        <h3 className="mb-2 text-[12px] font-medium tracking-[0.10em] text-[var(--t-3)] uppercase">
          Récapitulatif
        </h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-[var(--t-3)]">Durée</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">{draft.durationMin} min</dd>
          <dt className="text-[var(--t-3)]">Présence</dt>
          <dd className="font-mono text-[var(--t-1)] tabular-nums">
            {draft.quality}/10 — {QUALITY_LABEL(draft.quality)}
          </dd>
        </dl>
      </div>
    </Card>
  );
}
