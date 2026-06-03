'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CalendarRange, Check, Minus } from 'lucide-react';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { submitCalendarQuestionnaireAction } from '@/app/calendar/questionnaire/actions';
import { Alert } from '@/components/alert';
import { CalendarStepProgress } from '@/components/calendar/calendar-step-progress';
import { V18_SPRING } from '@/components/v18/motion-presets';
import {
  CALENDAR_SESSION_GOAL_MAX,
  CALENDAR_SESSION_GOAL_MIN,
  CALENDAR_SLOTS,
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKEND_DAYS,
  CURRENT_CALENDAR_INSTRUMENT,
  type CalendarMeetingCommitment,
  type CalendarPracticeFocus,
  type CalendarProfile,
  type CalendarSingleChoiceItem,
  type CalendarSleepChronotype,
  type CalendarSlotValue,
  type CalendarWeekConstraint,
  type CalendarWeekday,
  type CalendarWeekendDay,
} from '@/lib/calendar/instrument-v1';
import type { WeeklyScheduleResponses } from '@/lib/schemas/weekly-schedule-questionnaire';
import { cn } from '@/lib/utils';

/**
 * §26 Calendrier adaptatif — `<CalendarQuestionnaireWizard>` (J-C3).
 *
 * A faithful clone of `<MindsetCheckWizard>` (V1.5 §27) mechanics: `useActionState`
 * + hidden-input "submit everything" + localStorage draft + Framer `m.*` (the
 * `<LazyMotion>` ancestor lives in the app shell — NEVER `motion.*`, V1.9 strict)
 * + `AnimatePresence mode="wait"` + `useReducedMotion()` gating + APG roving
 * tabindex on the radiogroups + focus-on-step-change + sticky safe-area CTA.
 *
 * Identity: DS-v2 NEUTRAL/lime (`--acc` blue). NEVER the cyan `--cy` family
 * (§21.7 training-only), NEVER `.v18-theme` (REFLECT-only).
 *
 * Posture §2 (BLOQUANT) + §26 instrument: the questionnaire organises the
 * member's TIME of practice — availability, sleep, energy, focus. ZERO free-text
 * (closed instrument) → ZERO crisis/injection surface on this form (the EU AI
 * Act banner lives in J-C4 on the GENERATED calendar, not here). The server is
 * the only authority: the Server Action recomputes `weekStart` (Europe/Paris)
 * and rebuilds the answers from the frozen instrument before Zod `.strict()`
 * re-validates the whole payload — client step gating is UX, not security.
 *
 * Anti-Black-Hat (Yu-kai Chou): no score, no streak, no timer, no urgency — a
 * calm "organise ton temps" tool. The instrument is the SoT (labels/options
 * come from `CURRENT_CALENDAR_INSTRUMENT`, frozen + versioned).
 */

const INSTRUMENT = CURRENT_CALENDAR_INSTRUMENT;
const ITEM_BY_ID = new Map(INSTRUMENT.items.map((it) => [it.id, it]));

/** Resolve a frozen single-choice item (text + options) by its instrument id. */
function choiceItem(id: string): CalendarSingleChoiceItem {
  const it = ITEM_BY_ID.get(id);
  if (!it || it.kind !== 'single_choice') {
    throw new Error(`calendar instrument: expected single_choice item "${id}"`);
  }
  return it;
}

function textOf(id: string): string {
  return ITEM_BY_ID.get(id)?.text ?? '';
}

const PROFILE_ITEM = choiceItem('profile');
const SLEEP_ITEM = choiceItem('sleep');
const ENERGY_ITEM = choiceItem('energy_peak');
const MEETING_ITEM = choiceItem('meeting_commitment');
const FOCUS_ITEM = choiceItem('practice_focus');
const CONSTRAINT_ITEM = choiceItem('constraint');

const WEEKDAY_LABELS: Record<string, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

const SLOT_LABELS: Record<CalendarSlotValue, string> = {
  morning: 'Matin',
  afternoon: 'Après-midi',
  evening: 'Soir',
};

const SLOT_SHORT: Record<CalendarSlotValue, string> = {
  morning: 'Matin',
  afternoon: 'Aprèm',
  evening: 'Soir',
};

const STEP_LABELS = [
  'Profil & objectif',
  'Disponibilités en semaine',
  'Week-end & énergie',
  'Réunions & focus',
] as const;
const TOTAL_STEPS = STEP_LABELS.length;

interface DaySlots {
  morning: boolean;
  afternoon: boolean;
  evening: boolean;
}

interface CalendarDraftState {
  weekStart: string;
  instrumentVersion: number;
  profile?: CalendarProfile;
  sessionGoal?: number;
  weekdayAvailability: Record<CalendarWeekday, DaySlots>;
  weekendAvailability: Record<CalendarWeekendDay, DaySlots>;
  sleep?: CalendarSleepChronotype;
  energyPeak?: CalendarSlotValue;
  meetingCommitment?: CalendarMeetingCommitment;
  practiceFocus?: CalendarPracticeFocus;
  /** Item 9 is optional — defaults to 'none' so the record always stays complete. */
  constraint: CalendarWeekConstraint;
}

export interface CalendarQuestionnairePrefill {
  instrumentVersion: number;
  responses: WeeklyScheduleResponses;
}

const DRAFT_STORAGE_KEY = 'fxmily:calendar-questionnaire:draft:v1';

function emptyDay(): DaySlots {
  return { morning: false, afternoon: false, evening: false };
}

function emptyWeekdays(): Record<CalendarWeekday, DaySlots> {
  return CALENDAR_WEEKDAYS.reduce(
    (acc, day) => {
      acc[day] = emptyDay();
      return acc;
    },
    {} as Record<CalendarWeekday, DaySlots>,
  );
}

function emptyWeekend(): Record<CalendarWeekendDay, DaySlots> {
  return CALENDAR_WEEKEND_DAYS.reduce(
    (acc, day) => {
      acc[day] = emptyDay();
      return acc;
    },
    {} as Record<CalendarWeekendDay, DaySlots>,
  );
}

function emptyDraft(weekStart: string, prefill?: CalendarQuestionnairePrefill): CalendarDraftState {
  // Prefill only counts if it was captured against the CURRENT instrument
  // version (longitudinal integrity — item ids/options differ across versions).
  const usePrefill = prefill && prefill.instrumentVersion === INSTRUMENT.version;
  const base: CalendarDraftState = {
    weekStart,
    instrumentVersion: INSTRUMENT.version,
    weekdayAvailability: emptyWeekdays(),
    weekendAvailability: emptyWeekend(),
    constraint: 'none',
  };
  if (!usePrefill) return base;
  const r = prefill.responses;
  return {
    ...base,
    profile: r.profile,
    sessionGoal: r.sessionGoal,
    // Deep-copy the grids so editing the draft never mutates the server prop.
    weekdayAvailability: CALENDAR_WEEKDAYS.reduce(
      (acc, day) => {
        acc[day] = { ...r.weekdayAvailability[day] };
        return acc;
      },
      {} as Record<CalendarWeekday, DaySlots>,
    ),
    weekendAvailability: CALENDAR_WEEKEND_DAYS.reduce(
      (acc, day) => {
        acc[day] = { ...r.weekendAvailability[day] };
        return acc;
      },
      {} as Record<CalendarWeekendDay, DaySlots>,
    ),
    sleep: r.sleep,
    energyPeak: r.energyPeak,
    meetingCommitment: r.meetingCommitment,
    practiceFocus: r.practiceFocus,
    constraint: r.constraint,
  };
}

function loadDraft(weekStart: string, prefill?: CalendarQuestionnairePrefill): CalendarDraftState {
  const base = emptyDraft(weekStart, prefill);
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<CalendarDraftState>;
    // Discard a draft from another week OR another instrument version (stale
    // ids would not map — server Zod would reject anyway).
    if (parsed.weekStart && parsed.weekStart !== weekStart) return base;
    if (parsed.instrumentVersion && parsed.instrumentVersion !== INSTRUMENT.version) return base;
    return {
      ...base,
      ...parsed,
      // Always re-pin the server-authoritative anchors regardless of the draft.
      weekStart,
      instrumentVersion: INSTRUMENT.version,
      // Merge grids cell-by-cell so a partial/legacy draft can't drop a day.
      weekdayAvailability: mergeGrid(base.weekdayAvailability, parsed.weekdayAvailability),
      weekendAvailability: mergeGrid(base.weekendAvailability, parsed.weekendAvailability),
      constraint: parsed.constraint ?? base.constraint,
    };
  } catch {
    return base;
  }
}

function mergeGrid<K extends string>(
  base: Record<K, DaySlots>,
  override: Partial<Record<K, Partial<DaySlots>>> | undefined,
): Record<K, DaySlots> {
  if (!override) return base;
  const out = { ...base };
  for (const key of Object.keys(base) as K[]) {
    const o = override[key];
    if (o && typeof o === 'object') {
      out[key] = {
        morning: typeof o.morning === 'boolean' ? o.morning : base[key].morning,
        afternoon: typeof o.afternoon === 'boolean' ? o.afternoon : base[key].afternoon,
        evening: typeof o.evening === 'boolean' ? o.evening : base[key].evening,
      };
    }
  }
  return out;
}

function isStepValid(step: number, draft: CalendarDraftState): boolean {
  switch (step) {
    case 0:
      return (
        draft.profile !== undefined &&
        typeof draft.sessionGoal === 'number' &&
        draft.sessionGoal >= CALENDAR_SESSION_GOAL_MIN &&
        draft.sessionGoal <= CALENDAR_SESSION_GOAL_MAX
      );
    // Availability grids are valid in any state (the schema allows all-false —
    // a member who is unavailable a whole day is legitimate). No min required.
    case 1:
      return true;
    case 2:
      return draft.sleep !== undefined && draft.energyPeak !== undefined;
    case 3:
      // `constraint` defaults to 'none' so it is always satisfied.
      return draft.meetingCommitment !== undefined && draft.practiceFocus !== undefined;
    default:
      return false;
  }
}

interface CalendarQuestionnaireWizardProps {
  /** Server-derived Monday (Europe/Paris) of the current week. */
  weekStart: string;
  /** Existing questionnaire for this week → editing (upsert). */
  prefill?: CalendarQuestionnairePrefill;
}

export function CalendarQuestionnaireWizard({
  weekStart,
  prefill,
}: CalendarQuestionnaireWizardProps) {
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<CalendarDraftState>(() => emptyDraft(weekStart, prefill));
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState(submitCalendarQuestionnaireAction, null);

  // Hydrate from localStorage post-mount (SSR-safe — carbon J5/V1.5).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(weekStart, prefill));
    setHydrated(true);
    // `prefill` is a stable server prop for the page's lifetime; intentionally
    // not in deps (it would re-run + clobber an in-progress edit on re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* quota / private-mode — ignore */
    }
  }, [draft, hydrated]);

  // Focus the step heading on step change (APG). Skip first mount so SR users
  // read the progress chrome first (REFLECT canon).
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const safeStep = Math.max(0, Math.min(step, TOTAL_STEPS - 1));
  const errors = state?.fieldErrors;
  const formError = state?.error;
  const stepValid = isStepValid(safeStep, draft);
  const allValid = [0, 1, 2, 3].every((s) => isStepValid(s, draft));

  function setField<K extends keyof CalendarDraftState>(key: K, value: CalendarDraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleWeekday(day: CalendarWeekday, slot: CalendarSlotValue) {
    setDraft((d) => ({
      ...d,
      weekdayAvailability: {
        ...d.weekdayAvailability,
        [day]: { ...d.weekdayAvailability[day], [slot]: !d.weekdayAvailability[day][slot] },
      },
    }));
  }

  function toggleWeekend(day: CalendarWeekendDay, slot: CalendarSlotValue) {
    setDraft((d) => ({
      ...d,
      weekendAvailability: {
        ...d.weekendAvailability,
        [day]: { ...d.weekendAvailability[day], [slot]: !d.weekendAvailability[day][slot] },
      },
    }));
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="calendar-questionnaire-wizard"
      aria-labelledby="cqw-heading"
      aria-describedby="cqw-preamble"
    >
      {/* Hidden payload — server is the authority; every field always sent.
          Booleans travel as the literal strings 'true'/'false' (the action's
          `coerceBool` guard defeats the Boolean('false') === true footgun). */}
      <input type="hidden" name="weekStart" value={draft.weekStart} />
      <input type="hidden" name="instrumentVersion" value={draft.instrumentVersion} />
      <input type="hidden" name="profile" value={draft.profile ?? ''} />
      <input type="hidden" name="sessionGoal" value={draft.sessionGoal ?? ''} />
      {CALENDAR_WEEKDAYS.flatMap((day) =>
        CALENDAR_SLOTS.map((slot) => (
          <input
            key={`weekday.${day}.${slot}`}
            type="hidden"
            name={`weekday.${day}.${slot}`}
            value={draft.weekdayAvailability[day][slot] ? 'true' : 'false'}
          />
        )),
      )}
      {CALENDAR_WEEKEND_DAYS.flatMap((day) =>
        CALENDAR_SLOTS.map((slot) => (
          <input
            key={`weekend.${day}.${slot}`}
            type="hidden"
            name={`weekend.${day}.${slot}`}
            value={draft.weekendAvailability[day][slot] ? 'true' : 'false'}
          />
        )),
      )}
      <input type="hidden" name="sleep" value={draft.sleep ?? ''} />
      <input type="hidden" name="energyPeak" value={draft.energyPeak ?? ''} />
      <input type="hidden" name="meetingCommitment" value={draft.meetingCommitment ?? ''} />
      <input type="hidden" name="practiceFocus" value={draft.practiceFocus ?? ''} />
      <input type="hidden" name="constraint" value={draft.constraint} />

      <p
        id="cqw-preamble"
        className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]"
      >
        {INSTRUMENT.preamble}
      </p>

      <CalendarStepProgress current={safeStep + 1} total={TOTAL_STEPS} labels={STEP_LABELS} />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      {/* DS-v3 glass step-region — frosted panel over the page ambient mesh.
          NO `overflow-hidden` (it would clip the icon halo; the x:±24 slide
          rides the child `m.div` in `mode="wait"`). Blur via Tailwind backdrop
          utilities (Lightning CSS strips a raw `backdrop-filter`). */}
      <div className="glass-panel border-edge-top rounded-card-lg relative min-h-[340px] p-5 backdrop-blur-[16px] backdrop-saturate-150 sm:p-6">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={safeStep}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={V18_SPRING}
            className="flex flex-col gap-6"
          >
            <header className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className="rounded-pill mt-1 flex h-10 w-10 shrink-0 items-center justify-center border"
                style={{
                  background: 'var(--acc-dim)',
                  borderColor: 'var(--b-acc)',
                  color: 'var(--acc)',
                  boxShadow: 'var(--acc-glow)',
                }}
              >
                <CalendarRange size={18} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="t-eyebrow-lg text-[var(--t-3)]">
                  Étape {safeStep + 1} sur {TOTAL_STEPS}
                </p>
                <h2
                  id="cqw-heading"
                  ref={headingRef}
                  tabIndex={-1}
                  className="t-h1 mt-1 text-[var(--t-1)]"
                >
                  {STEP_LABELS[safeStep]}
                </h2>
              </div>
            </header>

            {safeStep === 0 ? (
              <div className="flex flex-col gap-6">
                <SingleChoiceField
                  legend={textOf('profile')}
                  options={PROFILE_ITEM.options}
                  value={draft.profile}
                  onChange={(v) => setField('profile', v as CalendarProfile)}
                  error={errors?.['responses.profile']}
                />
                <SessionGoalField
                  legend={textOf('session_goal')}
                  value={draft.sessionGoal}
                  onChange={(v) => setField('sessionGoal', v)}
                  error={errors?.['responses.sessionGoal']}
                />
              </div>
            ) : null}

            {safeStep === 1 ? (
              <AvailabilityGrid
                legend={textOf('weekday_availability')}
                days={CALENDAR_WEEKDAYS}
                value={draft.weekdayAvailability}
                onToggle={(day, slot) => toggleWeekday(day as CalendarWeekday, slot)}
              />
            ) : null}

            {safeStep === 2 ? (
              <div className="flex flex-col gap-6">
                <AvailabilityGrid
                  legend={textOf('weekend_availability')}
                  days={CALENDAR_WEEKEND_DAYS}
                  value={draft.weekendAvailability}
                  onToggle={(day, slot) => toggleWeekend(day as CalendarWeekendDay, slot)}
                />
                <SingleChoiceField
                  legend={textOf('sleep')}
                  options={SLEEP_ITEM.options}
                  value={draft.sleep}
                  onChange={(v) => setField('sleep', v as CalendarSleepChronotype)}
                  error={errors?.['responses.sleep']}
                />
                <SingleChoiceField
                  legend={textOf('energy_peak')}
                  options={ENERGY_ITEM.options}
                  value={draft.energyPeak}
                  onChange={(v) => setField('energyPeak', v as CalendarSlotValue)}
                  error={errors?.['responses.energyPeak']}
                />
              </div>
            ) : null}

            {safeStep === 3 ? (
              <div className="flex flex-col gap-6">
                <SingleChoiceField
                  legend={textOf('meeting_commitment')}
                  options={MEETING_ITEM.options}
                  value={draft.meetingCommitment}
                  onChange={(v) => setField('meetingCommitment', v as CalendarMeetingCommitment)}
                  error={errors?.['responses.meetingCommitment']}
                />
                <SingleChoiceField
                  legend={textOf('practice_focus')}
                  options={FOCUS_ITEM.options}
                  value={draft.practiceFocus}
                  onChange={(v) => setField('practiceFocus', v as CalendarPracticeFocus)}
                  error={errors?.['responses.practiceFocus']}
                />
                <SingleChoiceField
                  legend={textOf('constraint')}
                  options={CONSTRAINT_ITEM.options}
                  value={draft.constraint}
                  onChange={(v) => setField('constraint', v as CalendarWeekConstraint)}
                  error={errors?.['responses.constraint']}
                />
              </div>
            ) : null}
          </m.div>
        </AnimatePresence>
      </div>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (anti
          Black-Hat): keyboard/SR users learn WHY "Suivant"/"Enregistrer" is
          disabled instead of meeting a silent dead control (WCAG 3.3.1). */}
      <p className="sr-only" role="status" aria-live="polite">
        {safeStep < TOTAL_STEPS - 1
          ? stepValid
            ? ''
            : 'Complète cette étape pour passer à la suivante.'
          : allValid
            ? ''
            : 'Réponds à toutes les questions pour enregistrer ton organisation.'}
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
            {isPending ? 'Enregistrement…' : 'Enregistrer mon organisation'}
            <Check size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Single-choice field — WAI-ARIA APG radiogroup (arrow-key roving)
// ---------------------------------------------------------------------------

interface SingleChoiceFieldProps {
  legend: string;
  options: readonly { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
}

function SingleChoiceField({ legend, options, value, onChange, error }: SingleChoiceFieldProps) {
  const labelId = useId();
  const errorId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  // Roving tabindex: the selected radio is the single tab stop; if none is
  // selected the first radio stays reachable so the group is never tab-trapped.
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(delta: number) {
    // APG radio: from an empty group the first arrow selects the FOCUSED
    // (first) radio, not its neighbour (WCAG 2.1.1).
    if (selectedIndex < 0) {
      const first = options[0];
      if (first) onChange(first.value);
      return;
    }
    const next = (selectedIndex + delta + options.length) % options.length;
    const opt = options[next];
    if (opt) onChange(opt.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
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
    <div className="flex flex-col gap-2.5">
      <p id={labelId} className="t-body text-[var(--t-1)]">
        {legend}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className="flex flex-col gap-2"
      >
        {options.map((opt, i) => {
          const checked = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(opt.value)}
              className={cn(
                'rounded-control flex min-h-11 items-center gap-3 border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-btn)] text-[var(--acc-fg)]'
                  : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
              )}
            >
              {/* Not color-only: the checked radio shows a Check glyph too
                  (aria-checked is the SR signal — WCAG 1.4.1). */}
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                  checked ? 'border-current' : 'border-[var(--b-strong)]',
                )}
              >
                {checked ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              <span className="text-[13px] font-medium">{opt.label}</span>
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

// ---------------------------------------------------------------------------
// Session-goal field — segmented 1-7 radiogroup (horizontal roving)
// ---------------------------------------------------------------------------

interface SessionGoalFieldProps {
  legend: string;
  value: number | undefined;
  onChange: (value: number) => void;
  error?: string | undefined;
}

const SESSION_GOAL_VALUES = Array.from(
  { length: CALENDAR_SESSION_GOAL_MAX - CALENDAR_SESSION_GOAL_MIN + 1 },
  (_, i) => CALENDAR_SESSION_GOAL_MIN + i,
);

function SessionGoalField({ legend, value, onChange, error }: SessionGoalFieldProps) {
  const labelId = useId();
  const errorId = useId();
  const selectedIndex = value !== undefined ? SESSION_GOAL_VALUES.indexOf(value) : -1;
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(delta: number) {
    if (selectedIndex < 0) {
      const first = SESSION_GOAL_VALUES[0];
      if (first !== undefined) onChange(first);
      return;
    }
    const next = (selectedIndex + delta + SESSION_GOAL_VALUES.length) % SESSION_GOAL_VALUES.length;
    const v = SESSION_GOAL_VALUES[next];
    if (v !== undefined) onChange(v);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        move(-1);
        break;
      case 'Home': {
        e.preventDefault();
        const first = SESSION_GOAL_VALUES[0];
        if (first !== undefined) onChange(first);
        break;
      }
      case 'End': {
        e.preventDefault();
        const last = SESSION_GOAL_VALUES[SESSION_GOAL_VALUES.length - 1];
        if (last !== undefined) onChange(last);
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId} className="t-body text-[var(--t-1)]">
        {legend}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-1.5"
      >
        {SESSION_GOAL_VALUES.map((v, i) => {
          const checked = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${v} session${v > 1 ? 's' : ''} sur ${CALENDAR_SESSION_GOAL_MAX}`}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(v)}
              className={cn(
                'rounded-control flex min-h-11 items-center justify-center border text-[15px] font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-btn)] text-[var(--acc-fg)]'
                  : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
              )}
            >
              {v}
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

// ---------------------------------------------------------------------------
// Availability grid — independent toggle buttons (aria-pressed), one per
// (day, slot). Checkbox semantics, NOT a radiogroup.
// ---------------------------------------------------------------------------

interface AvailabilityGridProps {
  legend: string;
  days: readonly string[];
  value: Record<string, DaySlots>;
  onToggle: (day: string, slot: CalendarSlotValue) => void;
}

function AvailabilityGrid({ legend, days, value, onToggle }: AvailabilityGridProps) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId} className="t-body text-[var(--t-1)]">
        {legend}
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-col gap-1.5">
        {/* Slot header (decorative — each toggle carries its own full name). */}
        <div
          className="grid grid-cols-[4.25rem_repeat(3,minmax(0,1fr))] gap-1.5 pb-0.5"
          aria-hidden="true"
        >
          <span />
          {CALENDAR_SLOTS.map((slot) => (
            <span key={slot} className="t-cap text-center text-[var(--t-3)]">
              {SLOT_SHORT[slot]}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day}
            className="grid grid-cols-[4.25rem_repeat(3,minmax(0,1fr))] items-center gap-1.5"
          >
            <span className="text-[12px] font-medium text-[var(--t-2)]">{WEEKDAY_LABELS[day]}</span>
            {CALENDAR_SLOTS.map((slot) => {
              const pressed = value[day]?.[slot] ?? false;
              return (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={`${WEEKDAY_LABELS[day]} ${SLOT_LABELS[slot]}`}
                  onClick={() => onToggle(day, slot)}
                  className={cn(
                    'rounded-control flex min-h-11 items-center justify-center border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                    pressed
                      ? 'border-[var(--b-acc-strong)] bg-[var(--acc-btn)] text-[var(--acc-fg)]'
                      : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-4)] hover:border-[var(--b-acc)] hover:text-[var(--t-2)]',
                  )}
                >
                  {/* Icon, not color-only (WCAG 1.4.1): a Check when available,
                      a muted dash when not. aria-pressed is the SR signal. */}
                  {pressed ? (
                    <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                  ) : (
                    <Minus size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
