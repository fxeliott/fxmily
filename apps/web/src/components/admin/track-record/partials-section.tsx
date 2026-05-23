'use client';

import { Plus, Trash2 } from 'lucide-react';
import {
  cloneElement,
  isValidElement,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactElement,
} from 'react';

import {
  createPartialAction,
  deletePartialAction,
  type AdminTrackRecordActionState,
} from '@/app/admin/track-record/actions';
import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedPublicTradePartial } from '@/lib/admin/public-trade-service';
import { cn } from '@/lib/utils';

interface PartialsSectionProps {
  publicTradeId: string;
  initialPartials: SerializedPublicTradePartial[];
}

const initialState: AdminTrackRecordActionState = { ok: false };

/**
 * Sub-section dans la page edit pour gerer les legs partielles (TP1/TP2/…).
 * Server Component parent fetche les partials initiaux ; ce client component
 * affiche la list + permet add inline + delete avec double-confirm.
 *
 * Note : pas de re-fetch optimiste — on s'appuie sur `revalidatePath` des
 * Server Actions pour rafraichir la page. Pour V1 c'est suffisant ; pour
 * V2+ on pourrait ajouter une mutation locale optimistic en parallel.
 */
export function PartialsSection({ publicTradeId, initialPartials }: PartialsSectionProps) {
  const [state, formAction, pending] = useActionState(createPartialAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok, state.id]);

  const fieldErrors = state.fieldErrors ?? {};

  return (
    <section aria-labelledby="partials-heading" className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2
          id="partials-heading"
          className="text-base font-semibold tracking-tight text-[var(--t-1)]"
        >
          Legs partielles
        </h2>
        <span className="text-[11px] text-[var(--t-3)]">
          {initialPartials.length} leg{initialPartials.length > 1 ? 's' : ''}
        </span>
      </header>

      {initialPartials.length === 0 ? (
        <Card className="p-4" edge={false}>
          <p className="text-sm text-[var(--t-3)]">
            Aucune leg partielle. Utilise le formulaire ci-dessous pour ajouter une clôture
            progressive (TP1 à +1R, TP2 à +2R, etc.).
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {initialPartials.map((p, i) => (
            <li key={p.id}>
              <PartialRow publicTradeId={publicTradeId} partial={p} legIndex={i + 1} />
            </li>
          ))}
        </ul>
      )}

      {/* Add form */}
      <Card className="p-4" edge={false}>
        <h3 className="t-eyebrow-lg mb-3 text-[var(--t-3)]">Ajouter une leg</h3>
        <form
          ref={formRef}
          action={formAction}
          className="flex flex-col gap-3 md:flex-row md:items-end md:gap-3"
          noValidate
        >
          <input type="hidden" name="publicTradeId" value={publicTradeId} />

          <SubField
            label="R fermé"
            htmlFor="partial-closedAtR"
            error={fieldErrors.closedAtR}
            hint="ex. 1.5 pour TP1 à +1.5R"
            required
          >
            <input
              id="partial-closedAtR"
              name="closedAtR"
              type="number"
              required
              min={-100}
              max={100}
              step={0.01}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.closedAtR) || undefined}
              inputMode="decimal"
              className={inputCls(Boolean(fieldErrors.closedAtR))}
            />
          </SubField>

          <SubField
            label="% fermé"
            htmlFor="partial-closedPercent"
            error={fieldErrors.closedPercent}
            hint="0.01..100"
            required
          >
            <input
              id="partial-closedPercent"
              name="closedPercent"
              type="number"
              required
              min={0.01}
              max={100}
              step={0.01}
              defaultValue="50"
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.closedPercent) || undefined}
              inputMode="decimal"
              className={inputCls(Boolean(fieldErrors.closedPercent))}
            />
          </SubField>

          <SubField label="Date" htmlFor="partial-closedAt" error={fieldErrors.closedAt} required>
            <input
              id="partial-closedAt"
              name="closedAt"
              type="datetime-local"
              required
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.closedAt) || undefined}
              className={inputCls(Boolean(fieldErrors.closedAt))}
            />
          </SubField>

          <div className="md:pb-[2px]">
            <Btn type="submit" kind="primary" size="m" loading={pending}>
              <Plus className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
              Ajouter
            </Btn>
          </div>
        </form>

        {!state.ok && state.error && state.error !== 'validation' ? (
          <div className="mt-3">
            <Alert tone="danger" role="alert">
              Erreur — réessaye ({state.error}).
            </Alert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="mt-3">
            <Alert tone="success" role="status">
              {state.message}
            </Alert>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

// =============================================================================
// Partial row + delete button
// =============================================================================

interface PartialRowProps {
  publicTradeId: string;
  partial: SerializedPublicTradePartial;
  legIndex: number;
}

function PartialRow({ publicTradeId, partial, legIndex }: PartialRowProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');
  // UI N4-3 fix : cleanup du setTimeout `announce` (parité avec actions-row,
  // anti setState-on-unmount sous React strict mode).
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);

  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 1500);
  }

  const rLabel = Number(partial.closedAtR).toFixed(2);
  const pctLabel = Number(partial.closedPercent).toFixed(2);
  const dateLabel = formatDateTime(partial.closedAt);

  function onDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      announceFor(
        `Confirmation requise pour supprimer la leg ${legIndex}. Clique à nouveau dans 4 secondes.`,
      );
      return;
    }
    startTransition(async () => {
      const r = await deletePartialAction(publicTradeId, partial.id);
      if (!r.ok) {
        setConfirmingDelete(false);
        announceFor('Échec de la suppression');
      } else {
        announceFor('Leg supprimée');
      }
    });
  }

  return (
    <Card className="p-3" edge={false}>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="acc">Leg {legIndex}</Pill>
        <span className="text-sm font-semibold text-[var(--t-1)] tabular-nums">{rLabel} R</span>
        <span className="text-xs text-[var(--t-3)] tabular-nums">{pctLabel} %</span>
        <span className="text-[11px] text-[var(--t-4)] tabular-nums">{dateLabel}</span>
        {partial.notes ? (
          <span className="text-[11px] text-[var(--t-3)] italic">
            « {partial.notes.slice(0, 80)}
            {partial.notes.length > 80 ? '…' : ''} »
          </span>
        ) : null}
        <div className="ml-auto">
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={`Supprimer la leg ${legIndex}`}
            className={cn(
              'rounded-pill inline-flex h-11 items-center gap-1.5 border px-3 text-xs font-medium transition-all',
              confirmingDelete
                ? 'border-[var(--bad)] bg-[var(--bad-dim)] text-[var(--bad)]'
                : 'border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--t-3)] hover:border-[oklch(0.7_0.165_22_/_0.35)] hover:text-[var(--bad)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--bad)]',
              'disabled:opacity-50',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
            <span>{confirmingDelete ? 'Confirmer ?' : 'Supprimer'}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

// =============================================================================
// Helpers (locales)
// =============================================================================

interface SubFieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  /**
   * T5 audit Phase H — a11y-reviewer T1#3 : parité avec `Field` de
   * `public-trade-form.tsx`. Marque le champ comme requis pour les voyants
   * via astérisque visuel (sr-hidden — le `required` natif HTML est lu par
   * les AT). Sans cette prop, les inputs `<input required>` annonçaient
   * "requis" au SR mais aucun signal visuel pour les voyants. Asymétrie
   * d'info entre voyants et SR (WCAG 1.3.3 + 4.1.2).
   */
  required?: boolean | undefined;
  children: React.ReactNode;
}

function SubField({ label, htmlFor, error, hint, required, children }: SubFieldProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  // a11y H2-3 fix : injecte `aria-describedby` sur l'input (parité avec Field
  // de public-trade-form.tsx). cloneElement assume un seul child input.
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const child =
    describedBy && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': describedBy,
        })
      : children;
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="t-eyebrow-lg text-[var(--t-3)]">
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-[var(--bad)]">
            *
          </span>
        ) : null}
      </label>
      {child}
      {hint && !error ? (
        <p id={hintId} className="text-[11px] text-[var(--t-3)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return cn(
    'rounded-input h-11 w-full border bg-[var(--bg-1)] px-3 py-2 text-[14px] text-[var(--t-1)] transition-[border-color,box-shadow] duration-150 outline-none',
    'placeholder:text-[var(--t-4)]',
    hasError
      ? 'border-[var(--b-danger)] focus-visible:border-[var(--bad)]'
      : 'border-[var(--b-default)] hover:border-[var(--b-strong)] focus-visible:border-[var(--acc)]',
    'focus-visible:ring-2 focus-visible:ring-[var(--acc-dim)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
  );
}

// Phase H+8 — hoist `Intl.DateTimeFormat` au module level (pattern Phase H+6
// carbone `public-trade-row.tsx`) ET ajout `timeZone: 'Europe/Paris'` explicite
// (vs runtime-local TZ qui produirait UTC display sur Hetzner prod → display
// "22/05/2026 22:00" pour un partial closed Paris 00:00 May 23). Cohérent
// SPEC §16 + closes le gap raté lors de Phase H+6 perf hoisting / H+8 TZ fix.
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDateTime(iso: string): string {
  try {
    return DATETIME_FMT.format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}
