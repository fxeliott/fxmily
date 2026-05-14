'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  HeartPulse,
  MessageCircleQuestion,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { createReflectionEntryAction, type ReflectActionState } from '@/app/reflect/actions';
import { Alert } from '@/components/alert';
import { V18StepProgress } from '@/components/v18/step-progress';
import { REFLECTION_TEXT_MAX_CHARS, REFLECTION_TEXT_MIN_CHARS } from '@/lib/schemas/reflection';
import { cn } from '@/lib/utils';

/**
 * V1.8 REFLECT — ReflectionWizard (4-step CBT Ellis ABCD).
 *
 * Steps :
 *   A — Activating event   (factual trigger, what happened)
 *   B — Belief             (the thought that fired automatically)
 *   C — Consequence        (emotion observed + behaviour)
 *   D — Disputation        (alternative belief / reframe)
 *
 * Clinical-honest disclaimer banner above wizard mandatory (see
 * `<V18CbtDisclaimerBanner>`). Same chrome as `<WeeklyReviewWizard>` —
 * V1.8 visual coherence is critical for the REFLECT module identity.
 *
 * Date is auto-set to today (local clock). Server re-validates the window
 * `[-14d, +1d]` via Zod so a stale draft tab can't bypass the rule.
 */

interface StepDef {
  letter: 'A' | 'B' | 'C' | 'D';
  title: string;
  icon: LucideIcon;
  field: 'triggerEvent' | 'beliefAuto' | 'consequence' | 'disputation';
  label: string;
  hint: string;
  placeholder: string;
}

const STEP_DEFS: readonly StepDef[] = [
  {
    letter: 'A',
    title: `L'événement déclencheur`,
    icon: Zap,
    field: 'triggerEvent',
    label: `Que s'est-il passé ? (Faits seulement)`,
    hint: 'Décris le moment factuel — heure, marché, contexte. Pas encore tes pensées.',
    placeholder: `Ex : "13h30 GMT, NFP miss -50k. Ai vu le prix sauter pendant ma pause."`,
  },
  {
    letter: 'B',
    title: 'La pensée automatique',
    icon: MessageCircleQuestion,
    field: 'beliefAuto',
    label: `Quelle pensée a fusé dans ta tête ?`,
    hint: 'La voix intérieure brute — pas filtrée. "Je dois entrer maintenant", "je vais tout perdre"…',
    placeholder: `Ex : "Si je rate ce move, je vais m'en vouloir toute la semaine."`,
  },
  {
    letter: 'C',
    title: 'Émotion + comportement',
    icon: HeartPulse,
    field: 'consequence',
    label: `Qu'as-tu ressenti — et qu'as-tu fait ?`,
    hint: `L'émotion + le passage à l'acte (ou la non-action). Sois précis, sans jugement.`,
    placeholder: `Ex : "FOMO 8/10. Ai violé ma règle 'pas de NFP 5 premières min', entré au marché."`,
  },
  {
    letter: 'D',
    title: 'Le reframe (Disputation)',
    icon: Sparkles,
    field: 'disputation',
    label: `Quelle pensée alternative — plus juste, plus utile — pourrait remplacer la première ?`,
    hint: 'Process > outcome. Mark Douglas : chaque trade est unique, mon edge est probabiliste.',
    placeholder: `Ex : "Le plan existe précisément pour les moments volatils. Skipper un trade coûte rien ; chasser peut coûter ma semaine."`,
  },
];

const STEP_LABELS = STEP_DEFS.map((s) => `${s.letter} — ${s.title}`);

type StepIndex = 0 | 1 | 2 | 3;

interface DraftState {
  date: string;
  triggerEvent: string;
  beliefAuto: string;
  consequence: string;
  disputation: string;
}

const DRAFT_STORAGE_KEY = 'fxmily:reflection:draft:v1';

function todayUTC(): string {
  // Use UTC consistently (cf. BUG-1 fix in weekly-review-wizard). The
  // Zod refine for `reflectionEntrySchema.date` validates `[-14d, +1d]`
  // against UTC midnight, so we anchor here too. The window is wide
  // enough to absorb any sub-day TZ drift for FR users.
  return new Date().toISOString().slice(0, 10);
}

function emptyDraft(date: string): DraftState {
  return {
    date,
    triggerEvent: '',
    beliefAuto: '',
    consequence: '',
    disputation: '',
  };
}

function loadDraft(date: string): DraftState {
  if (typeof window === 'undefined') return emptyDraft(date);
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft(date);
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    return { ...emptyDraft(date), ...parsed, date };
  } catch {
    return emptyDraft(date);
  }
}

function isStepValid(step: StepIndex, draft: DraftState): boolean {
  const min = REFLECTION_TEXT_MIN_CHARS;
  const max = REFLECTION_TEXT_MAX_CHARS;
  const def = STEP_DEFS[step];
  if (!def) return true;
  const value = draft[def.field];
  return value.trim().length >= min && value.length <= max;
}

export function ReflectionWizard() {
  const reduceMotion = useReducedMotion();
  const initialDate = useMemo(() => todayUTC(), []);
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(initialDate));
  const [step, setStep] = useState<StepIndex>(0);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // BUG-2 fix — skip focus jump at initial mount (cf. weekly-review-wizard).
  const firstMount = useRef(true);
  const [state, formAction, isPending] = useActionState(createReflectionEntryAction, null);

  // Hydrate draft from localStorage post-mount (SSR-safe). See
  // `weekly-review-wizard.tsx` for the lint-suppression rationale.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft(initialDate));
    setHydrated(true);
  }, [initialDate]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft, hydrated]);

  // Focus the step heading on user-initiated step change ; skip initial
  // mount so the SR-flow reads the progress chrome first (WCAG 2.4.3).
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const errors = (state as ReflectActionState | null)?.fieldErrors;
  const formError = (state as ReflectActionState | null)?.error;
  const stepValid = isStepValid(step, draft);

  function update<K extends keyof DraftState>(key: K, value: DraftState[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const def = STEP_DEFS[step];
  if (!def) return null;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-6"
      data-slot="reflection-wizard"
      aria-labelledby="refw-heading"
    >
      <input type="hidden" name="date" value={draft.date} />
      <input type="hidden" name="triggerEvent" value={draft.triggerEvent} />
      <input type="hidden" name="beliefAuto" value={draft.beliefAuto} />
      <input type="hidden" name="consequence" value={draft.consequence} />
      <input type="hidden" name="disputation" value={draft.disputation} />

      <V18StepProgress current={step + 1} total={STEP_DEFS.length} labels={STEP_LABELS} />

      {formError === 'unauthorized' ? (
        <Alert tone="danger">Ta session a expiré. Reconnecte-toi pour soumettre.</Alert>
      ) : null}
      {formError === 'unknown' ? (
        <Alert tone="danger">
          {`Quelque chose s'est mal passé côté serveur. Réessaie dans un instant.`}
        </Alert>
      ) : null}

      <div className="relative min-h-[340px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={reduceMotion ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 220, damping: 28, mass: 0.7 }}
            className="flex flex-col gap-5"
          >
            <ABCDHeader def={def} headingRef={headingRef} />
            <FreeTextField
              id={def.field}
              label={def.label}
              hint={def.hint}
              value={draft[def.field]}
              onChange={(v) => update(def.field, v)}
              error={errors?.[def.field]}
              placeholder={def.placeholder}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sticky bottom CTA */}
      <div
        className="v18-glass sticky bottom-0 z-10 -mx-4 mt-2 flex items-center gap-3 border-t border-[var(--b-default)] px-4 py-3 sm:-mx-6 sm:px-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as StepIndex)}
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

        {step < STEP_DEFS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((step + 1) as StepIndex)}
            disabled={!stepValid}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : // a11y B1 fix (WCAG 1.4.3) — `--t-2` for disabled CTA
                  // contrast ≥ 4.5:1, see weekly-review-wizard same fix.
                  'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
          >
            Suivant
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!stepValid || isPending}
            className={cn(
              'rounded-control inline-flex h-11 items-center gap-1.5 px-5 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow,transform] duration-150',
              stepValid && !isPending
                ? 'bg-[var(--acc)] hover:-translate-y-px hover:bg-[var(--acc-hi)] hover:shadow-[var(--sh-btn-pri-hover)] active:translate-y-0 active:shadow-[var(--sh-btn-pri)]'
                : // a11y B1 fix (WCAG 1.4.3) — `--t-2` for disabled CTA
                  // contrast ≥ 4.5:1, see weekly-review-wizard same fix.
                  'cursor-not-allowed bg-[var(--bg-2)] text-[var(--t-2)] shadow-none',
            )}
            aria-busy={isPending || undefined}
          >
            {isPending ? 'Envoi…' : 'Enregistrer cette réflexion'}
            <Check size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function ABCDHeader({
  def,
  headingRef,
}: {
  def: StepDef;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const Icon = def.icon;
  // Color progression A→B→C→D (deep→light) matching ABCDHero
  const colorByLetter: Record<StepDef['letter'], string> = {
    A: 'oklch(0.46 0.21 263)',
    B: 'oklch(0.53 0.21 259)',
    C: 'oklch(0.62 0.19 254)',
    D: 'oklch(0.82 0.115 247)',
  };
  return (
    <header className="flex items-start gap-3">
      <div
        aria-hidden="true"
        className="rounded-pill mt-1 flex h-12 w-12 shrink-0 items-center justify-center border"
        style={{
          background: 'oklch(0.18 0.03 254 / 0.85)',
          borderColor: colorByLetter[def.letter],
          color: colorByLetter[def.letter],
        }}
      >
        <span className="font-display text-[18px] font-bold leading-none">{def.letter}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="t-eyebrow flex items-center gap-1.5 text-[var(--t-3)]">
          <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
          Étape {def.letter}
        </p>
        {/* V1.9 TIER A H3 : `outline-none` retiré (WCAG 2.4.7 focus visible —
            cf. notes weekly-review-wizard pour rationale). */}
        <h2
          id="refw-heading"
          ref={headingRef}
          tabIndex={-1}
          className="t-h1 mt-1 text-[var(--t-1)]"
        >
          {def.title}
        </h2>
      </div>
    </header>
  );
}

interface FreeTextFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  placeholder: string;
}

function FreeTextField(props: FreeTextFieldProps) {
  const { id, label, hint, value, onChange, error, placeholder } = props;
  const charCount = value.length;
  const isOverMax = charCount > REFLECTION_TEXT_MAX_CHARS;
  const isUnderMin = charCount > 0 && value.trim().length < REFLECTION_TEXT_MIN_CHARS;
  // V1.9 TIER A H1 : counter default tone `--t-2` (WCAG 1.4.3 contrast).
  const counterTone = isOverMax
    ? 'text-[var(--bad)]'
    : isUnderMin
      ? 'text-[var(--warn)]'
      : 'text-[var(--t-2)]';
  const describedBy = `${id}-counter${error ? ` ${id}-error` : ''}`;
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="flex flex-col gap-1.5">
        <span className="t-h3 text-[var(--t-1)]">{label}</span>
        <span className="t-cap text-[var(--t-3)]">{hint}</span>
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={REFLECTION_TEXT_MAX_CHARS + 100}
        rows={6}
        className="rounded-input w-full resize-y border bg-[var(--bg-2)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus:border-[var(--b-acc-strong)] focus:shadow-[0_0_0_3px_oklch(0.62_0.19_254_/_0.16)] focus:outline-none"
        style={{
          borderColor: error ? 'oklch(0.7 0.165 22 / 0.55)' : 'var(--b-strong)',
          minHeight: '180px',
        }}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      />
      <div className="flex items-baseline justify-between gap-3">
        {/* V1.9 TIER A H5 : `aria-live="polite"` + `aria-atomic` pour
            l'annonce SR du compteur (browser-throttled). */}
        <p
          id={`${id}-counter`}
          aria-live="polite"
          aria-atomic="true"
          className={cn('t-cap font-mono tabular-nums', counterTone)}
        >
          {charCount} / {REFLECTION_TEXT_MAX_CHARS}
          {charCount > 0 && charCount < REFLECTION_TEXT_MIN_CHARS ? (
            <span className="ml-2">
              ({REFLECTION_TEXT_MIN_CHARS - charCount} caractères de plus pour valider)
            </span>
          ) : null}
        </p>
        <p className="t-cap text-[var(--t-3)]">Min. {REFLECTION_TEXT_MIN_CHARS} caractères</p>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="t-cap text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
