'use client';

import { Check, ShieldCheck } from 'lucide-react';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import { submitTrackingInstrumentAction } from '@/app/tracking/[instrument]/actions';
import { Alert } from '@/components/alert';
import type {
  MultiTagQuestion,
  NumericQuestion,
  TrackingInstrument,
  TrackingQuestion,
} from '@/lib/tracking/types';
import { cn } from '@/lib/utils';

/**
 * Minimal prefill shape (client-defined, mirror `MindsetCheckPrefill`). Decoupled
 * from the server-only `SerializedTrackingEntry` so this client module never
 * pulls a `server-only` import into the browser bundle. A `SerializedTrackingEntry`
 * is structurally assignable to it, so the RSC page passes its read straight in.
 */
export interface TrackingPrefill {
  instrumentVersion: string;
  responses: Record<string, unknown>;
  confidenceLevel: number | null;
}

/**
 * V2 S2 — Universal tracking capture wizard (member-facing). Renders ANY frozen
 * instrument as a single calm panel: one closed question after another, an
 * optional D3 confidence scale, a sticky submit. Mechanics mirror
 * `<MindsetCheckWizard>` (useActionState + localStorage draft + hidden-input
 * "submit everything" + APG radiogroups + sticky safe-area CTA), simplified to a
 * single page since a process instrument is short and ungrouped.
 *
 * Server is the authority — every answer rides a hidden input; the action
 * rebuilds `responses` from the instrument's ids and re-validates. Posture §2 /
 * §31.2: the instrument is closed (no free-text), framed as a calm repère, a
 * « non » is never a verdict; zero streak / score / XP.
 *
 * D2 reliability: `responseLatencyMs` (mount → submit) is measured client-side
 * and injected into the FormData by the action wrapper; the capture context
 * (cold retrospective) is defaulted server-side from the instrument.
 */

/** A normalised single-pick option (boolean / likert / scale / single_choice). */
interface Choice {
  value: string;
  label: string;
  /** Optional small caption shown under the label (likert anchor sub-text). */
  sub?: string;
}

/** Normalise a question to its single-pick choices, or null for non-pick kinds. */
function choicesFor(q: TrackingQuestion): Choice[] | null {
  switch (q.kind) {
    case 'boolean':
      return [
        { value: 'true', label: 'Oui' },
        { value: 'false', label: 'Non' },
      ];
    case 'likert':
      return q.anchors.map((a) => ({
        value: String(a.value),
        label: String(a.value),
        sub: a.label,
      }));
    case 'scale': {
      const out: Choice[] = [];
      for (let v = q.min; v <= q.max; v++) {
        const sub = v === q.min ? q.minLabel : v === q.max ? q.maxLabel : undefined;
        out.push({ value: String(v), label: String(v), ...(sub ? { sub } : {}) });
      }
      return out;
    }
    case 'single_choice':
      return q.options.map((o) => ({ value: o.value, label: o.label }));
    default:
      return null; // multi_tag / numeric are rendered upstream by QuestionField
  }
}

const CONFIDENCE_CHOICES: readonly Choice[] = [
  { value: '1', label: '1', sub: 'Pas du tout' },
  { value: '2', label: '2' },
  { value: '3', label: '3', sub: 'Moyenne' },
  { value: '4', label: '4' },
  { value: '5', label: '5', sub: 'Totale' },
] as const;

interface DraftState {
  instrumentVersion: string;
  responses: Record<string, string>;
  confidence: string;
}

function emptyDraft(instrument: TrackingInstrument, prefill?: TrackingPrefill): DraftState {
  const usePrefill = prefill && prefill.instrumentVersion === instrument.version;
  const responses: Record<string, string> = {};
  if (usePrefill) {
    for (const [k, v] of Object.entries(prefill.responses)) {
      if (typeof v === 'boolean') responses[k] = v ? 'true' : 'false';
      // multi_tag answers persist as a string[]; the draft holds them as a JSON
      // string so a single hidden input round-trips them (the action JSON.parses
      // it back). An empty selection is stored as '' so completeness reads it as
      // unanswered, never as the literal "[]".
      else if (Array.isArray(v)) responses[k] = v.length ? JSON.stringify(v) : '';
      else if (typeof v === 'number' || typeof v === 'string') responses[k] = String(v);
    }
  }
  return {
    instrumentVersion: instrument.version,
    responses,
    confidence:
      usePrefill && prefill.confidenceLevel != null ? String(prefill.confidenceLevel) : '',
  };
}

function draftKey(instrument: TrackingInstrument): string {
  return `fxmily:tracking:${instrument.key}:draft:v1`;
}

function loadDraft(instrument: TrackingInstrument, prefill?: TrackingPrefill): DraftState {
  const base = emptyDraft(instrument, prefill);
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(draftKey(instrument));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    // Discard a draft from a different instrument version (stale ids).
    if (parsed.instrumentVersion && parsed.instrumentVersion !== instrument.version) return base;
    const responses =
      parsed.responses && typeof parsed.responses === 'object'
        ? (parsed.responses as Record<string, string>)
        : {};
    return {
      ...base,
      responses: { ...base.responses, ...responses },
      confidence: typeof parsed.confidence === 'string' ? parsed.confidence : base.confidence,
    };
  } catch {
    return base;
  }
}

function isComplete(instrument: TrackingInstrument, draft: DraftState): boolean {
  const allRequiredAnswered = instrument.questions.every((q) => {
    if (q.required === false) return true;
    const v = draft.responses[q.id];
    return typeof v === 'string' && v.trim() !== '';
  });
  const confidenceOk = !instrument.capturesConfidence || draft.confidence.trim() !== '';
  return allRequiredAnswered && confidenceOk;
}

interface TrackingWizardProps {
  instrument: TrackingInstrument;
  /** Server-derived occurrence slot for the current cadence period. */
  occurrenceKey: string;
  /** Existing capture for this occurrence → editing (upsert). */
  prefill?: TrackingPrefill;
}

export function TrackingWizard({ instrument, occurrenceKey, prefill }: TrackingWizardProps) {
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(instrument, prefill));
  const [hydrated, setHydrated] = useState(false);
  const startedAt = useRef<number>(0);
  const [state, formAction, isPending] = useActionState(submitTrackingInstrumentAction, null);

  // Hydrate draft + start the latency timer post-mount (SSR-safe).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(instrument, prefill));
    setHydrated(true);
    startedAt.current = Date.now();
    // `prefill`/`instrument` are stable server props for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(draftKey(instrument), JSON.stringify(draft));
    } catch {
      /* quota / private-mode — ignore */
    }
  }, [draft, hydrated, instrument]);

  const errors = state?.fieldErrors;
  const formError = state?.error;
  const complete = isComplete(instrument, draft);

  function setAnswer(id: string, value: string) {
    setDraft((d) => ({ ...d, responses: { ...d.responses, [id]: value } }));
  }

  return (
    <form
      action={(formData) => {
        // D2 — inject the measured response latency right before submit.
        const elapsed = startedAt.current > 0 ? Date.now() - startedAt.current : 0;
        formData.set('responseLatencyMs', String(Math.max(0, elapsed)));
        formAction(formData);
      }}
      className="flex flex-col gap-6"
      data-slot="tracking-wizard"
      aria-labelledby="tw-heading"
    >
      {/* Hidden payload — server is the authority, every answer always sent. */}
      <input type="hidden" name="instrumentKey" value={instrument.key} />
      <input type="hidden" name="instrumentVersion" value={draft.instrumentVersion} />
      <input type="hidden" name="occurrenceKey" value={occurrenceKey} />
      {instrument.questions.map((q) => (
        <input key={q.id} type="hidden" name={q.id} value={draft.responses[q.id] ?? ''} />
      ))}
      {instrument.capturesConfidence ? (
        <input type="hidden" name="confidenceLevel" value={draft.confidence} />
      ) : null}

      <p className="rounded-control border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2.5 text-[12px] leading-[1.5] text-[var(--t-2)]">
        {instrument.preamble}
      </p>

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour enregistrer.</Alert>
      ) : null}
      {formError === 'unknown' || formError === 'unknown_instrument' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      <div className="glass-panel border-edge-top rounded-card-lg relative flex flex-col gap-7 p-5 backdrop-blur-[16px] backdrop-saturate-150 sm:p-6">
        <header className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="rounded-pill mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border"
            style={{
              background: 'var(--acc-dim)',
              borderColor: 'var(--b-acc)',
              color: 'var(--acc)',
              boxShadow: 'var(--acc-glow)',
            }}
          >
            <ShieldCheck size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-eyebrow-lg text-[var(--t-3)]">Suivi · Fidélité au cadre</p>
            <h2 id="tw-heading" className="t-h1 mt-1 text-[var(--t-1)]">
              {instrument.title}
            </h2>
          </div>
        </header>

        {instrument.questions.map((q, i) => (
          <QuestionField
            key={q.id}
            index={i + 1}
            question={q}
            value={draft.responses[q.id]}
            onChange={(v) => setAnswer(q.id, v)}
            error={errors?.[`responses.${q.id}`]}
          />
        ))}

        {instrument.capturesConfidence ? (
          <ChoiceField
            label="À quel point te sens-tu confiant·e dans ta gestion cette semaine ?"
            help="Une simple échelle, sans bonne ni mauvaise réponse."
            choices={CONFIDENCE_CHOICES}
            value={draft.confidence}
            onChange={(v) => setDraft((d) => ({ ...d, confidence: v }))}
            columns={5}
          />
        ) : null}
      </div>

      {/* SR-only reason the CTA is inert — calm, non-judgmental (WCAG 3.3.1). */}
      <p className="sr-only" role="status" aria-live="polite">
        {complete ? '' : 'Réponds à chaque question obligatoire pour enregistrer ton suivi.'}
      </p>

      <div
        className="sticky bottom-0 z-10 -mx-4 mt-1 flex items-center gap-3 border-t border-[var(--b-default)] bg-[var(--bg)]/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <p className="t-cap flex-1 text-[var(--t-3)]">
          Un « non » n&apos;est pas un échec, juste un repère pour toi.
        </p>
        <button
          type="submit"
          disabled={!complete || isPending}
          className={cn(
            'rounded-control inline-flex h-11 items-center gap-1.5 px-5 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
            complete && !isPending
              ? 'bg-[var(--acc-btn)] hover:bg-[var(--acc-btn-hover)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)] motion-safe:hover:-translate-y-px'
              : 'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
          )}
          aria-busy={isPending || undefined}
        >
          {isPending ? 'Enregistrement…' : 'Enregistrer mon suivi'}
          <Check size={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Per-question field
// ---------------------------------------------------------------------------

interface QuestionFieldProps {
  index: number;
  question: TrackingQuestion;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
}

function QuestionField({ index, question, value, onChange, error }: QuestionFieldProps) {
  const optional = question.required === false;

  const label = (
    <span className="t-body text-[var(--t-1)]">
      <span className="mr-1.5 font-mono text-[12px] text-[var(--t-3)] tabular-nums">{index}.</span>
      {question.label}
      {optional ? <span className="ml-1.5 text-[12px] text-[var(--t-3)]">(facultatif)</span> : null}
    </span>
  );

  // Multi-select tags (e.g. "coche tout ce qui s'applique") — a group of
  // independently-toggleable buttons (APG toggle-button pattern), distinct from
  // the single-pick radiogroup below.
  if (question.kind === 'multi_tag') {
    return (
      <MultiTagField
        label={label}
        help={question.help}
        question={question}
        value={value}
        onChange={onChange}
        error={error}
      />
    );
  }

  // Bounded number (e.g. "combien de trades cette semaine ?").
  if (question.kind === 'numeric') {
    return (
      <NumericField
        label={label}
        help={question.help}
        question={question}
        value={value}
        onChange={onChange}
        error={error}
      />
    );
  }

  const choices = choicesFor(question);
  if (!choices) {
    // Truly defensive: every TrackingQuestion kind is now handled above. This
    // only ever fires if a new kind is added without a renderer — surface it
    // clearly rather than render a silent dead field.
    return (
      <div className="flex flex-col gap-2">
        {label}
        <p className="t-cap text-[var(--t-3)]">Type de question non pris en charge.</p>
      </div>
    );
  }

  const columns = question.kind === 'single_choice' ? 1 : choices.length;

  return (
    <ChoiceField
      label={label}
      help={question.help}
      choices={choices}
      value={value}
      onChange={onChange}
      error={error}
      columns={columns}
    />
  );
}

// ---------------------------------------------------------------------------
// Choice field — WAI-ARIA APG radiogroup (arrow-key roving, not color-only)
// ---------------------------------------------------------------------------

interface ChoiceFieldProps {
  label: React.ReactNode;
  help?: string | undefined;
  choices: readonly Choice[];
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
  /** Grid columns: 1 = vertical list (single_choice), N = compact row (likert). */
  columns: number;
}

function ChoiceField({ label, help, choices, value, onChange, error, columns }: ChoiceFieldProps) {
  const labelId = useId();
  const helpId = useId();
  const errorId = useId();
  const selectedIndex = choices.findIndex((c) => c.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const vertical = columns === 1;

  function move(delta: number) {
    if (selectedIndex < 0) {
      onChange(choices[0]!.value);
      return;
    }
    const next = (selectedIndex + delta + choices.length) % choices.length;
    onChange(choices[next]!.value);
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
        onChange(choices[0]!.value);
        break;
      case 'End':
        e.preventDefault();
        onChange(choices[choices.length - 1]!.value);
        break;
      default:
        break;
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId}>{label}</p>
      {help ? (
        <p id={helpId} className="t-cap -mt-1 text-[var(--t-3)]">
          {help}
        </p>
      ) : null}
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={cn(help ? helpId : undefined, error ? errorId : undefined) || undefined}
        onKeyDown={onKeyDown}
        className={cn(vertical ? 'flex flex-col gap-1.5' : 'grid gap-1.5')}
        style={vertical ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {choices.map((choice, i) => {
          const checked = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={choice.sub ? `${choice.label} · ${choice.sub}` : choice.label}
              tabIndex={i === tabbableIndex ? 0 : -1}
              onClick={() => onChange(choice.value)}
              className={cn(
                'rounded-control border transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                vertical
                  ? 'flex min-h-11 items-center gap-2 px-3 py-2 text-left text-[13px]'
                  : 'flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 py-2 text-center',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-btn)] text-[var(--acc-fg)]'
                  : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
              )}
            >
              {vertical ? (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      checked ? 'border-[var(--acc-fg)]' : 'border-[var(--b-strong)]',
                    )}
                  >
                    {checked ? <Check size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className="font-medium">{choice.label}</span>
                </>
              ) : (
                <>
                  <span className="flex h-3.5 items-center" aria-hidden="true">
                    {checked ? (
                      <Check size={14} strokeWidth={2.5} />
                    ) : (
                      <span className="font-mono text-[13px] font-semibold">{choice.label}</span>
                    )}
                  </span>
                  {choice.sub ? (
                    <span className="text-[10px] leading-tight font-medium">{choice.sub}</span>
                  ) : null}
                </>
              )}
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
// Multi-tag field — APG toggle-button group (independent multi-select)
// ---------------------------------------------------------------------------

interface MultiTagFieldProps {
  label: React.ReactNode;
  help?: string | undefined;
  question: MultiTagQuestion;
  /** JSON string of the selected `value[]`, or '' when none (so completeness
   *  reads an empty selection as unanswered, never the literal "[]"). */
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
}

/** Parse the draft's JSON-string tag list back to a string[] (never throws). */
function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const arr: unknown = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function MultiTagField({ label, help, question, value, onChange, error }: MultiTagFieldProps) {
  const labelId = useId();
  const helpId = useId();
  const errorId = useId();
  const selected = parseTags(value);
  const cap = question.maxSelected;
  const atCap = typeof cap === 'number' && selected.length >= cap;

  function toggle(v: string) {
    const has = selected.includes(v);
    // At cap, an unselected tag is aria-disabled (still focusable, APG) and a
    // toggle is a no-op — the member must deselect one first.
    if (!has && atCap) return;
    const next = has ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next.length ? JSON.stringify(next) : '');
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p id={labelId}>{label}</p>
      {help ? (
        <p id={helpId} className="t-cap -mt-1 text-[var(--t-3)]">
          {help}
        </p>
      ) : null}
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={cn(help ? helpId : undefined, error ? errorId : undefined) || undefined}
        className="flex flex-wrap gap-1.5"
      >
        {question.options.map((opt) => {
          const checked = selected.includes(opt.value);
          const blocked = !checked && atCap;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={checked}
              aria-disabled={blocked || undefined}
              onClick={() => toggle(opt.value)}
              className={cn(
                'rounded-control inline-flex min-h-11 items-center gap-1.5 border px-3 py-2 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
                checked
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-btn)] text-[var(--acc-fg)]'
                  : blocked
                    ? // Cap reached: aria-disabled but still focusable (APG), so this
                      // is NOT an "inactive" component — its label must stay AA-legible
                      // (no opacity dimming, which would drop --t-3 to ~2.5:1). The
                      // blocked status reads from aria-disabled + the muted border +
                      // cursor, not from a contrast-killing fade.
                      'cursor-not-allowed border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]'
                    : 'border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)] hover:border-[var(--b-acc)] hover:text-[var(--t-1)]',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border',
                  checked ? 'border-[var(--acc-fg)]' : 'border-[var(--b-strong)]',
                )}
              >
                {checked ? <Check size={11} strokeWidth={3} /> : null}
              </span>
              {opt.label}
            </button>
          );
        })}
      </div>
      {typeof cap === 'number' ? (
        <p className="t-cap text-[var(--t-3)]" role="status" aria-live="polite">
          {selected.length}/{cap} sélectionné{selected.length > 1 ? 's' : ''}
          {atCap ? ' · maximum atteint' : ''}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numeric field — bounded number input
// ---------------------------------------------------------------------------

interface NumericFieldProps {
  label: React.ReactNode;
  help?: string | undefined;
  question: NumericQuestion;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string | undefined;
}

function NumericField({ label, help, question, value, onChange, error }: NumericFieldProps) {
  const labelId = useId();
  const helpId = useId();
  const errorId = useId();
  const unitId = useId();
  const inputId = useId();

  return (
    <div className="flex flex-col gap-2.5">
      <label id={labelId} htmlFor={inputId}>
        {label}
      </label>
      {help ? (
        <p id={helpId} className="t-cap -mt-1 text-[var(--t-3)]">
          {help}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="number"
          inputMode={question.integer ? 'numeric' : 'decimal'}
          min={question.min}
          max={question.max}
          step={question.integer ? 1 : 'any'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={
            cn(
              help ? helpId : undefined,
              question.unit ? unitId : undefined,
              error ? errorId : undefined,
            ) || undefined
          }
          aria-invalid={error ? true : undefined}
          className={cn(
            'rounded-control h-11 w-28 border bg-[var(--bg-2)] px-3 text-[14px] text-[var(--t-1)] tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none',
            error ? 'border-[var(--bad)]' : 'border-[var(--b-strong)] hover:border-[var(--b-acc)]',
          )}
        />
        {question.unit ? (
          <span id={unitId} className="t-body text-[var(--t-3)]">
            {question.unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
