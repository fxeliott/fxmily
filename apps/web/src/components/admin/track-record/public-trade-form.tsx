'use client';

import { Check, Save, Send } from 'lucide-react';
import { cloneElement, isValidElement, useActionState, type ReactElement } from 'react';

import {
  createPublicTradeAction,
  updatePublicTradeAction,
  type AdminTrackRecordActionState,
} from '@/app/admin/track-record/actions';
import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import type { SerializedPublicTrade } from '@/lib/admin/public-trade-service';

import { toDatetimeLocal } from './datetime-paris';
import {
  PUBLIC_TRADE_SEGMENTS,
  PUBLIC_TRADE_STATUSES,
  TRADE_DIRECTIONS,
  TRADE_SESSIONS,
  TAGS_MAX,
  NOTES_MAX,
} from '@/lib/schemas/public-trade';
import { cn } from '@/lib/utils';

interface PublicTradeFormProps {
  /** Si fourni → mode edit ; sinon → mode create. */
  trade?: SerializedPublicTrade;
}

const initialState: AdminTrackRecordActionState = { ok: false };

const STATUS_LABEL: Record<(typeof PUBLIC_TRADE_STATUSES)[number], string> = {
  open: 'Ouvert',
  closed: 'Clôturé',
  break_even: 'Break-even',
};

const SEGMENT_LABEL: Record<(typeof PUBLIC_TRADE_SEGMENTS)[number], string> = {
  historical: 'Historique',
  live: 'Live',
};

const DIRECTION_LABEL: Record<(typeof TRADE_DIRECTIONS)[number], string> = {
  long: 'Long',
  short: 'Short',
};

const SESSION_LABEL: Record<(typeof TRADE_SESSIONS)[number], string> = {
  asia: 'Asia',
  london: 'London',
  overlap: 'Overlap',
  newyork: 'New York',
};

/**
 * Form admin shared create+edit pour `PublicTrade`. Server Action native
 * (`useActionState`) — fonctionne sans JS (progressive enhancement).
 *
 * Lifecycle invariants enforced server-side (Zod superRefine + service
 * `validateLifecycleInvariants`). Le client n'a aucune logique conditionnelle
 * sur status — on laisse l'admin envoyer librement et on affiche les
 * `fieldErrors` retournés.
 */
export function PublicTradeForm({ trade }: PublicTradeFormProps) {
  const isEdit = Boolean(trade);
  const action = isEdit ? updatePublicTradeAction : createPublicTradeAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  const fieldErrors = state.fieldErrors ?? {};
  const rootError =
    !state.ok && state.error !== 'validation' && state.error !== undefined
      ? rootErrorMessage(state.error)
      : (fieldErrors._root ?? null);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {isEdit && trade ? <input type="hidden" name="id" value={trade.id} /> : null}

      {/* Segment + Ordinal + Status */}
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="sr-only">Segment, ordinal, statut</legend>

        <Field label="Segment" htmlFor="segment" error={fieldErrors.segment} required>
          <select
            id="segment"
            name="segment"
            required
            defaultValue={trade?.segment ?? 'live'}
            disabled={pending}
            className={selectCls(Boolean(fieldErrors.segment))}
          >
            {PUBLIC_TRADE_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Ordinal"
          htmlFor="ordinal"
          error={fieldErrors.ordinal}
          hint={isEdit ? undefined : 'Vide = auto (MAX+1)'}
        >
          <input
            id="ordinal"
            name="ordinal"
            type="number"
            min={1}
            max={99999}
            step={1}
            defaultValue={trade?.ordinal ?? ''}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.ordinal) || undefined}
            placeholder="auto"
            className={inputCls(Boolean(fieldErrors.ordinal))}
          />
        </Field>

        <Field label="Statut" htmlFor="status" error={fieldErrors.status} required>
          <select
            id="status"
            name="status"
            required
            defaultValue={trade?.status ?? 'open'}
            disabled={pending}
            className={selectCls(Boolean(fieldErrors.status))}
          >
            {PUBLIC_TRADE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      {/* Instrument + Direction + Session */}
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="sr-only">Instrument, direction, session</legend>

        <Field
          label="Instrument"
          htmlFor="instrument"
          error={fieldErrors.instrument}
          required
          hint="EURUSD, XAUUSD, US30… (majuscules)"
        >
          <input
            id="instrument"
            name="instrument"
            type="text"
            required
            minLength={3}
            maxLength={10}
            defaultValue={trade?.instrument ?? ''}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.instrument) || undefined}
            placeholder="EURUSD"
            autoCapitalize="characters"
            className={inputCls(Boolean(fieldErrors.instrument))}
          />
        </Field>

        <Field label="Direction" htmlFor="direction" error={fieldErrors.direction}>
          <select
            id="direction"
            name="direction"
            defaultValue={trade?.direction ?? ''}
            disabled={pending}
            className={selectCls(Boolean(fieldErrors.direction))}
          >
            <option value="">—</option>
            {TRADE_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABEL[d]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Session" htmlFor="session" error={fieldErrors.session}>
          <select
            id="session"
            name="session"
            defaultValue={trade?.session ?? ''}
            disabled={pending}
            className={selectCls(Boolean(fieldErrors.session))}
          >
            <option value="">—</option>
            {TRADE_SESSIONS.map((s) => (
              <option key={s} value={s}>
                {SESSION_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      {/* Dates */}
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Dates</legend>

        <Field label="Entré le" htmlFor="enteredAt" error={fieldErrors.enteredAt} required>
          <input
            id="enteredAt"
            name="enteredAt"
            type="datetime-local"
            required
            defaultValue={toDatetimeLocal(trade?.enteredAt)}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.enteredAt) || undefined}
            className={inputCls(Boolean(fieldErrors.enteredAt))}
          />
        </Field>

        <Field
          label="Sorti le"
          htmlFor="exitedAt"
          error={fieldErrors.exitedAt}
          hint="requis si statut = clôturé ou BE"
        >
          <input
            id="exitedAt"
            name="exitedAt"
            type="datetime-local"
            defaultValue={toDatetimeLocal(trade?.exitedAt)}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.exitedAt) || undefined}
            className={inputCls(Boolean(fieldErrors.exitedAt))}
          />
        </Field>
      </fieldset>

      {/* Risk + R */}
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Risque et R</legend>

        <Field
          label="Risque %"
          htmlFor="riskPercent"
          error={fieldErrors.riskPercent}
          required
          hint="0.50, 1.00, 2.00… (% brut, max 99.99)"
        >
          <input
            id="riskPercent"
            name="riskPercent"
            type="number"
            required
            min={0.01}
            max={99.99}
            step={0.01}
            defaultValue={trade?.riskPercent ?? '1.00'}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.riskPercent) || undefined}
            inputMode="decimal"
            className={inputCls(Boolean(fieldErrors.riskPercent))}
          />
        </Field>

        <Field
          label="R atteint"
          htmlFor="resultR"
          error={fieldErrors.resultR}
          hint="-100…100 (signed). Vide = pas encore résolu."
        >
          <input
            id="resultR"
            name="resultR"
            type="number"
            min={-100}
            max={100}
            step={0.01}
            defaultValue={trade?.resultR ?? ''}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.resultR) || undefined}
            inputMode="decimal"
            className={inputCls(Boolean(fieldErrors.resultR))}
          />
        </Field>
      </fieldset>

      {/* Setup + Tags */}
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Setup et tags</legend>

        <Field
          label="Setup"
          htmlFor="setup"
          error={fieldErrors.setup}
          hint="ICT FVG, OB retest, breakout…"
        >
          <input
            id="setup"
            name="setup"
            type="text"
            maxLength={100}
            defaultValue={trade?.setup ?? ''}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.setup) || undefined}
            className={inputCls(Boolean(fieldErrors.setup))}
          />
        </Field>

        <Field
          label="Tags"
          htmlFor="tags"
          error={fieldErrors.tags}
          hint={`max ${TAGS_MAX} tags séparés par virgules (news, FOMC, CPI…)`}
        >
          <input
            id="tags"
            name="tags"
            type="text"
            defaultValue={trade?.tags?.join(', ') ?? ''}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.tags) || undefined}
            className={inputCls(Boolean(fieldErrors.tags))}
          />
        </Field>
      </fieldset>

      {/* Notes */}
      <Field
        label="Notes"
        htmlFor="notes"
        error={fieldErrors.notes}
        hint={`max ${NOTES_MAX} chars · texte brut (pas de markdown)`}
      >
        <textarea
          id="notes"
          name="notes"
          maxLength={NOTES_MAX}
          defaultValue={trade?.notes ?? ''}
          disabled={pending}
          rows={4}
          aria-invalid={Boolean(fieldErrors.notes) || undefined}
          className={cn(
            inputCls(Boolean(fieldErrors.notes)),
            'min-h-[100px] resize-y py-2 leading-[1.5]',
          )}
        />
      </Field>

      {/* Screenshot */}
      <Field
        label="Screenshot URL"
        htmlFor="screenshotUrl"
        error={fieldErrors.screenshotUrl}
        hint="URL externe ou clé R2 (storage key)"
      >
        <input
          id="screenshotUrl"
          name="screenshotUrl"
          type="text"
          maxLength={500}
          defaultValue={trade?.screenshotUrl ?? ''}
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.screenshotUrl) || undefined}
          placeholder="https://… ou public-trades/abc.png"
          className={inputCls(Boolean(fieldErrors.screenshotUrl))}
        />
      </Field>

      {/* Published toggle */}
      <label
        htmlFor="isPublished"
        className="inline-flex cursor-pointer items-center gap-3 select-none"
      >
        <input
          id="isPublished"
          name="isPublished"
          type="checkbox"
          defaultChecked={trade?.isPublished ?? true}
          disabled={pending}
          className="h-5 w-5 cursor-pointer accent-[var(--acc)]"
        />
        <span className="text-sm text-[var(--t-1)]">
          Publier (visible sur trackrecordfxmily.pages.dev après rebuild)
        </span>
      </label>

      {/* Form error banner */}
      {rootError ? (
        <Alert tone="danger" role="alert">
          {rootError}
        </Alert>
      ) : null}

      {state.ok && state.message ? (
        <Alert tone="success" role="status">
          <span className="inline-flex items-center gap-2">
            <Check className="h-4 w-4" aria-hidden strokeWidth={1.75} />
            {state.message}
          </span>
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Btn type="submit" kind="primary" size="m" loading={pending}>
          {isEdit ? (
            <>
              <Save className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
              {pending ? 'Mise à jour…' : 'Enregistrer'}
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
              {pending ? 'Création…' : 'Créer le trade'}
            </>
          )}
        </Btn>
      </div>
    </form>
  );
}

// =============================================================================
// Field wrapper
// =============================================================================

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean | undefined;
  children: React.ReactNode;
}

function Field({ label, htmlFor, error, hint, required, children }: FieldProps) {
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  // a11y H2-3 fix : injecte `aria-describedby` sur l'input pour que les SR
  // lisent hint/error en parité voyant. Carbone du pattern auth `invite-form.tsx`
  // mais via cloneElement (Field accepte un seul child input/select/textarea).
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const child =
    describedBy && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': describedBy,
        })
      : children;
  return (
    <div className="flex flex-col gap-1.5">
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

// =============================================================================
// Style helpers
// =============================================================================

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

function selectCls(hasError: boolean): string {
  return cn(inputCls(hasError), 'cursor-pointer pr-8');
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convertit un ISO string UTC en valeur `datetime-local` (YYYY-MM-DDTHH:mm).
 *
 * Phase H+8 — déléguée à `./datetime-paris` qui utilise `Intl.DateTimeFormat`
 * avec `timeZone: 'Europe/Paris'` explicite (vs `d.getTimezoneOffset()`
 * browser-dépendant). Fix le bug latent où un admin en TZ ≠ Paris (voyage,
 * SSR runtime UTC) produisait un wall-clock browser-local que le server
 * preprocess Phase H+5 interpretait comme Paris → drift cumulatif.
 *
 * Cohérent SPEC §16 "Fuseau Europe/Paris" — client + server alignés sur
 * Paris by construction.
 */

function rootErrorMessage(error: AdminTrackRecordActionState['error']): string {
  switch (error) {
    case 'unauthorized':
      return 'Accès refusé — admin requis.';
    case 'not_found':
      return 'Trade introuvable (déjà supprimé ?).';
    case 'ordinal_taken':
      return 'Ordinal déjà utilisé — choisis-en un autre.';
    case 'invalid_state':
      return 'État incohérent — vérifie les champs (sortie/R).';
    case 'unknown':
      return 'Erreur inattendue — réessaye.';
    default:
      return 'Erreur de validation.';
  }
}
