'use client';

import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Compass } from 'lucide-react';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { submitMindsetCheckAction, type MindsetCheckActionState } from '@/app/mindset/actions';
import { Alert } from '@/components/alert';
import { MindsetStepProgress } from '@/components/mindset/mindset-step-progress';
import { V18_SPRING } from '@/components/v18/motion-presets';
import {
  CURRENT_MINDSET_INSTRUMENT,
  type MindsetDimension,
  type MindsetItem,
} from '@/lib/mindset/instrument';
import { cn } from '@/lib/utils';

/**
 * V1.5 — MindsetCheckWizard (SPEC §27.4). 6 steps = the 6 frozen dimensions
 * (§27.3), 2 Likert items each (~2-3 min, mobile-first iPhone SE/15).
 *
 * Mechanics are a faithful clone of `<TrainingDebriefWizard>` (`useActionState`
 * + localStorage draft + Framer `m.*` + `AnimatePresence mode="wait"` +
 * reduced-motion gating + hidden-input "submit everything" + APG focus-on-step
 * + sticky safe-area CTA). DS-v3 (J3): the step-region is a frosted
 * `.glass-panel` over the page ambient mesh with a calm focal glow on the step
 * icon (app-wide `:root` blue — `--acc`). NEVER the cyan `--cy` family (§21.7
 * training-only), NEVER `.v18-theme` (REFLECT's deeper scope — mindset rides
 * the `:root` blue). `weekStart` is server-derived (`currentParisWeekStart`,
 * §27.7), never computed client-side. The instrument is the SoT — items/labels
 * come from `CURRENT_MINDSET_INSTRUMENT` (frozen, versioned).
 *
 * Posture §27/§2: NO free-text (closed Likert → zero crisis/injection
 * surface), zero gamification (no streak/XP/score-shaming), "pas de bonne ni
 * de mauvaise réponse" framed persistently. The server is the only authority
 * (Zod re-validates the whole payload).
 */

const INSTRUMENT = CURRENT_MINDSET_INSTRUMENT;
const DIMENSIONS = INSTRUMENT.dimensions;
const LIKERT = INSTRUMENT.likertScale;
const STEP_LABELS: readonly string[] = DIMENSIONS.map((d) => d.label);

function itemsOf(dimensionId: string): readonly MindsetItem[] {
  return INSTRUMENT.items.filter((it) => it.dimensionId === dimensionId);
}

interface DraftState {
  weekStart: string;
  instrumentVersion: number;
  responses: Record<string, number>;
}

export interface MindsetCheckPrefill {
  instrumentVersion: number;
  responses: Record<string, number>;
}

const DRAFT_STORAGE_KEY = 'fxmily:mindset-check:draft:v1';

function emptyDraft(weekStart: string, prefill?: MindsetCheckPrefill): DraftState {
  // Prefill only counts if it was answered against the CURRENT instrument
  // version (longitudinal integrity §27.7 — item ids differ across versions).
  const usePrefill = prefill && prefill.instrumentVersion === INSTRUMENT.version;
  return {
    weekStart,
    instrumentVersion: INSTRUMENT.version,
    responses: usePrefill ? { ...prefill.responses } : {},
  };
}

function loadDraft(weekStart: string, prefill?: MindsetCheckPrefill): DraftState {
  const base = emptyDraft(weekStart, prefill);
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    // Discard a draft from another week OR another instrument version
    // (stale item ids would not map — server Zod would reject anyway).
    if (parsed.weekStart && parsed.weekStart !== weekStart) return base;
    if (parsed.instrumentVersion && parsed.instrumentVersion !== INSTRUMENT.version) return base;
    const responses =
      parsed.responses && typeof parsed.responses === 'object'
        ? (parsed.responses as Record<string, number>)
        : {};
    return { ...base, responses: { ...base.responses, ...responses }, weekStart };
  } catch {
    return base;
  }
}

function isStepValid(stepDim: MindsetDimension, draft: DraftState): boolean {
  return itemsOf(stepDim.id).every((it) => {
    const v = draft.responses[it.id];
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
  });
}

interface MindsetCheckWizardProps {
  /** Server-derived Monday (Europe/Paris) of the current week — §27.7. */
  weekStart: string;
  /** Existing check for this week → editing (upsert). */
  prefill?: MindsetCheckPrefill;
}

export function MindsetCheckWizard({ weekStart, prefill }: MindsetCheckWizardProps) {
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(weekStart, prefill));
  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState(submitMindsetCheckAction, null);

  // Hydrate from localStorage post-mount (SSR-safe — carbon J5/REFLECT).
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
  // read the progress chrome first (REFLECT BUG-2 canon).
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const safeStep = Math.max(0, Math.min(step, DIMENSIONS.length - 1));
  const dim = DIMENSIONS[safeStep]!;
  const errors = (state as MindsetCheckActionState | null)?.fieldErrors;
  const formError = (state as MindsetCheckActionState | null)?.error;
  const stepValid = isStepValid(dim, draft);
  const allValid = DIMENSIONS.every((d) => isStepValid(d, draft));

  function setAnswer(itemId: string, value: number) {
    setDraft((d) => ({ ...d, responses: { ...d.responses, [itemId]: value } }));
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="mindset-wizard"
      aria-labelledby="mcw-heading"
    >
      {/* Hidden payload — server is the authority, every item always sent. */}
      <input type="hidden" name="weekStart" value={draft.weekStart} />
      <input type="hidden" name="instrumentVersion" value={draft.instrumentVersion} />
      {INSTRUMENT.items.map((it) => (
        <input key={it.id} type="hidden" name={it.id} value={draft.responses[it.id] ?? ''} />
      ))}

      <p className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--t-2)]">
        {INSTRUMENT.preamble}
      </p>

      <MindsetStepProgress current={safeStep + 1} total={DIMENSIONS.length} labels={STEP_LABELS} />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      {/* DS-v3 (J3) glass step-region — frosted panel over the ambient mesh.
          NO `overflow-hidden` (carbone REFLECT audit polish: it would clip the
          icon halo + is unneeded — the x:±24 slide rides the child `m.div` in
          `mode="wait"`, verified 0 scroll-X @375/@1280). The blur comes from the
          Tailwind backdrop utilities at the call site, never a raw rule (Lightning
          CSS strips raw `backdrop-filter`). Slide stays on the child = J3 invariant
          (backdrop-filter on the static parent, transform on the child). */}
      <div className="glass-panel border-edge-top rounded-card-lg relative min-h-[320px] p-5 backdrop-blur-[16px] backdrop-saturate-150 sm:p-6">
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
                  // DS-v3 focal glow — calm blue halo on the step's icon (the
                  // premium focal point, anti Black-Hat: a soft halo, no pulse).
                  boxShadow: 'var(--acc-glow)',
                }}
              >
                <Compass size={18} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="t-eyebrow-lg text-[var(--t-3)]">
                  Étape {safeStep + 1} sur {DIMENSIONS.length}
                </p>
                <h2
                  id="mcw-heading"
                  ref={headingRef}
                  tabIndex={-1}
                  className="t-h1 mt-1 text-[var(--t-1)]"
                >
                  {dim.label}
                </h2>
                <p className="t-cap mt-1 text-[var(--t-3)]">{dim.description}</p>
              </div>
            </header>

            <div className="flex flex-col gap-6">
              {itemsOf(dim.id).map((item) => (
                <LikertItem
                  key={item.id}
                  item={item}
                  value={draft.responses[item.id]}
                  onChange={(v) => setAnswer(item.id, v)}
                  error={errors?.[`responses.${item.id}`]}
                />
              ))}
            </div>
          </m.div>
        </AnimatePresence>
      </div>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (anti
          Black-Hat): keyboard/SR users learn WHY "Suivant"/"Enregistrer" is
          disabled instead of meeting a silent dead control (a11y WCAG 3.3.1).
          Always in the DOM; the text changes → politely announced. */}
      <p className="sr-only" role="status" aria-live="polite">
        {safeStep < DIMENSIONS.length - 1
          ? stepValid
            ? ''
            : 'Réponds aux deux questions de cette étape pour passer à la suivante.'
          : allValid
            ? ''
            : 'Réponds à toutes les questions pour enregistrer ton auto-évaluation.'}
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

        {safeStep < DIMENSIONS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(safeStep + 1)}
            disabled={!stepValid}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
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
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Envoi…' : 'Enregistrer mon auto-évaluation'}
            <Check size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Likert item — WAI-ARIA APG radiogroup (arrow-key roving, not color-only)
// ---------------------------------------------------------------------------

interface LikertItemProps {
  item: MindsetItem;
  value: number | undefined;
  onChange: (value: number) => void;
  error?: string | undefined;
}

function LikertItem({ item, value, onChange, error }: LikertItemProps) {
  const labelId = useId();
  const errorId = useId();
  const selectedIndex = LIKERT.findIndex((a) => a.value === value);
  // Roving tabindex: the selected radio is the single tab stop; if none is
  // selected the first radio is reachable so the group is never tab-trapped.
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(delta: number) {
    // APG radio: from an empty group the first arrow selects the FOCUSED
    // (first) radio, not its neighbour — else value 1 is unreachable via
    // ArrowRight from the empty state (a11y WCAG 2.1.1).
    if (selectedIndex < 0) {
      onChange(LIKERT[0]!.value);
      return;
    }
    const next = (selectedIndex + delta + LIKERT.length) % LIKERT.length;
    const anchor = LIKERT[next];
    if (anchor) onChange(anchor.value);
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
      case 'Home':
        e.preventDefault();
        onChange(LIKERT[0]!.value);
        break;
      case 'End':
        e.preventDefault();
        onChange(LIKERT[LIKERT.length - 1]!.value);
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId} className="t-body text-[var(--t-1)]">
        {item.label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onKeyDown}
        className="grid grid-cols-5 gap-1.5"
      >
        {LIKERT.map((anchor, i) => {
          const checked = anchor.value === value;
          return (
            <button
              key={anchor.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${anchor.value} sur 5 — ${anchor.label}`}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(anchor.value)}
              className={cn(
                'rounded-control flex min-h-12 flex-col items-center justify-center gap-0.5 border px-1 py-2 text-center transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]'
                  : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
              )}
            >
              {/* Not color-only: the checked radio also shows a Check glyph +
                  bolder weight; aria-checked is the SR signal (WCAG 1.4.1). */}
              <span className="flex h-3.5 items-center" aria-hidden="true">
                {checked ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : (
                  <span className="font-mono text-[13px] font-semibold">{anchor.value}</span>
                )}
              </span>
              <span className="text-[10px] leading-tight font-medium">{anchor.label}</span>
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
