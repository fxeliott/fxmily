'use client';

import { CalendarCheck, CalendarClock, CalendarX, RefreshCw } from 'lucide-react';
import { useActionState, useId, useState } from 'react';

import {
  declareSeanceGoNoGoAction,
  regenerateSeanceAction,
  type SeanceGoNoGoActionState,
  type SeanceRegenerateActionState,
} from '@/app/admin/seances/actions';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { AdminSeanceCell } from '@/lib/seances/admin-service';
import {
  formatSyncedAtLabel,
  seanceTimeToInputValue,
  type PipelineBadge,
  type PipelineStepState,
} from '@/lib/seances/admin-derive';
import type { SeanceStatus } from '@/lib/seances/derive';
import { cn } from '@/lib/utils';

/**
 * Réunion hub (séances) — one `(date, slot)` admin go/no-go cell (J3, Client
 * Component). Mirrors `AdminMeetingRow`: a compact card carrying the go/no-go
 * form (`useActionState`), the read-only pipeline panel, and — on a held session
 * — the "régénérer" control. The Server Action re-validates + re-checks
 * `role === 'admin'`; client gating is best-effort UX.
 *
 * Posture §2 / Règle n°1: the admin declares WHETHER a session was held + its
 * real time + a cancel note — never authors the analysis. 0 emoji (all icons are
 * lucide SVG), 0 IA/model mention.
 */

const SLOT_LABEL: Record<'analyse' | 'debrief', string> = {
  analyse: 'Analyse',
  debrief: 'Débrief',
};

const STATUS_CHOICES: ReadonlyArray<{ value: SeanceStatus; label: string; hint: string }> = [
  { value: 'scheduled', label: 'Prévue', hint: 'Annoncée, pas encore tenue' },
  { value: 'done', label: 'Tenue', hint: 'Séance tenue → publiée' },
  { value: 'cancelled', label: 'Annulée', hint: 'Pas de séance ce créneau' },
];

const BADGE_META: Record<
  PipelineBadge,
  { tone: 'mute' | 'acc' | 'ok' | 'bad' | 'warn'; label: string }
> = {
  cancelled: { tone: 'warn', label: 'Annulée' },
  relancer: { tone: 'bad', label: 'À relancer' },
  regenerer: { tone: 'warn', label: 'À régénérer' },
  publie: { tone: 'ok', label: 'Publié' },
  encours: { tone: 'acc', label: 'En cours' },
  attente: { tone: 'mute', label: 'En attente' },
};

const STEP_STATE_META: Record<PipelineStepState, { tone: string; label: string }> = {
  done: { tone: 'text-[var(--ok)]', label: 'fait' },
  active: { tone: 'text-[var(--acc-hi)]', label: 'en cours' },
  pending: { tone: 'text-[var(--t-3)]', label: 'en attente' },
  failed: { tone: 'text-[var(--bad)]', label: 'échec' },
  idle: { tone: 'text-[var(--t-4)]', label: '—' },
};

function goNoGoMessage(state: SeanceGoNoGoActionState | null): string | null {
  if (!state || state.ok) return null;
  switch (state.error) {
    case 'backfill':
      return 'Impossible de déclarer une séance dans le passé (pas de date antérieure à aujourd’hui).';
    case 'no_rewind':
      return 'Une séance déjà tenue ne peut pas revenir à « prévue ». Tu peux l’annuler.';
    case 'invalid_input':
      return 'Saisie invalide, vérifie la date, le créneau et l’heure.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    default:
      return 'Une erreur est survenue. Réessaie dans un instant.';
  }
}

function regenMessage(state: SeanceRegenerateActionState | null): string | null {
  if (!state) return null;
  if (state.ok) return 'Régénération demandée, le pipeline reprendra la rédaction.';
  switch (state.error) {
    case 'not_done':
      return 'Seule une séance tenue peut être régénérée.';
    case 'not_found':
      return 'Séance introuvable.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    default:
      return 'Une erreur est survenue. Réessaie dans un instant.';
  }
}

export function SeanceAdminCell({ cell }: { cell: AdminSeanceCell }) {
  const [state, formAction, pending] = useActionState<SeanceGoNoGoActionState | null, FormData>(
    declareSeanceGoNoGoAction,
    null,
  );
  const [regenState, regenAction, regenPending] = useActionState<
    SeanceRegenerateActionState | null,
    FormData
  >(regenerateSeanceAction, null);

  // Selected status drives the conditional reason field. Defaults to the cell's
  // current status; an undeclared cell starts on "scheduled" (the safe default).
  const initialStatus: SeanceStatus = cell.exists ? (cell.status as SeanceStatus) : 'scheduled';
  const [selected, setSelected] = useState<SeanceStatus>(initialStatus);

  const groupId = useId();
  const reasonId = useId();
  const timeId = useId();

  const badge = BADGE_META[cell.pipeline.badge];
  const message = goNoGoMessage(state);
  const regenInfo = regenMessage(regenState);
  const noRewindLocked = !cell.canRevertToScheduled; // status === 'done'
  // J4 sync freshness (pure, null-safe) — derived once, used as guard + label.
  const syncedLabel = formatSyncedAtLabel(cell.pipeline.syncedAt);

  return (
    <Card
      className={cn(
        'flex flex-col gap-3 p-4',
        // De-emphasis of a cancelled cell is carried by the warn "Annulée" badge
        // + the muted copy — NEVER by `opacity`, which would drag the tertiary
        // text under 4.5:1 (WCAG 1.4.3, mirror seance-card.tsx canon).
        !cell.exists && 'border-dashed',
      )}
    >
      {/* Header: slot + time + status badges */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h4 className="t-body inline-flex items-center gap-1.5 font-medium text-[var(--t-1)]">
            <CalendarClock
              className="h-3.5 w-3.5 text-[var(--t-4)]"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            {SLOT_LABEL[cell.slot]} · {cell.time}
          </h4>
          <p className="t-cap text-[var(--t-3)]">{cell.title}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {cell.isPast ? <Pill tone="mute">Passée</Pill> : <Pill tone="acc">À venir</Pill>}
          {cell.exists ? (
            <Pill tone={badge.tone}>{badge.label}</Pill>
          ) : (
            <Pill tone="mute">Non déclarée</Pill>
          )}
        </div>
      </div>

      {/* Go/No-Go form */}
      <form
        action={formAction}
        className="flex flex-col gap-3 border-t border-[var(--b-default)] pt-3"
      >
        <input type="hidden" name="date" value={cell.date} />
        <input type="hidden" name="slot" value={cell.slot} />

        <fieldset className="flex flex-col gap-2">
          <legend className="t-eyebrow text-[var(--t-3)]">Go / No-Go</legend>
          <div role="radiogroup" aria-label="Statut de la séance" className="flex flex-wrap gap-2">
            {STATUS_CHOICES.map((choice) => {
              const disabled = choice.value === 'scheduled' && noRewindLocked;
              const checked = selected === choice.value;
              return (
                <label
                  key={choice.value}
                  title={
                    disabled ? 'Une séance tenue ne peut pas revenir à « prévue ».' : choice.hint
                  }
                  className={cn(
                    'rounded-control inline-flex cursor-pointer items-center gap-1.5 border px-3 py-1.5 text-[12px] transition-colors',
                    checked
                      ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] font-semibold text-[var(--acc-hi)]'
                      : 'border-[var(--b-default)] text-[var(--t-2)] hover:bg-[var(--bg-2)]',
                    disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    value={choice.value}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => setSelected(choice.value)}
                    className="sr-only"
                  />
                  {choice.value === 'done' ? (
                    <CalendarCheck className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  ) : choice.value === 'cancelled' ? (
                    <CalendarX className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
                  )}
                  {choice.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Real time input (admin owns the `time` field) */}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${timeId}-time`} className="t-cap text-[var(--t-3)]">
            Heure réelle
          </label>
          <input
            id={`${timeId}-time`}
            type="time"
            name="time"
            defaultValue={seanceTimeToInputValue(cell.exists ? cell.time : null)}
            className="rounded-control border border-[var(--b-default)] bg-[var(--bg-1)] px-2 py-1 text-[12px] text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
          />
        </div>

        {/* Cancel reason — only when "Annulée" is selected */}
        {selected === 'cancelled' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${reasonId}-reason`} className="t-cap text-[var(--t-3)]">
              Motif d’annulation (affiché aux membres)
            </label>
            <textarea
              id={`${reasonId}-reason`}
              name="reason"
              rows={2}
              maxLength={280}
              defaultValue={cell.cancelReason ?? ''}
              placeholder="Pas de séance ce créneau, indisponibilité."
              className="rounded-control border border-[var(--b-default)] bg-[var(--bg-1)] px-2 py-1.5 text-[12px] text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            />
          </div>
        ) : null}

        {message ? (
          <p role="alert" id={groupId} className="t-cap text-[var(--bad)]">
            {message}
          </p>
        ) : null}
        {state?.ok ? <p className="t-cap text-[var(--ok)]">Enregistré.</p> : null}

        <Btn type="submit" kind="primary" size="s" loading={pending} className="self-start">
          Enregistrer
        </Btn>
      </form>

      {/* Pipeline panel (read-only; the J4 pipeline fills the checkpoints) */}
      {cell.exists && cell.status === 'done' ? (
        <div className="flex flex-col gap-2 border-t border-[var(--b-default)] pt-3">
          <p className="t-eyebrow text-[var(--t-3)]">Pipeline</p>
          <ul className="flex flex-col gap-1">
            {cell.pipeline.steps.map((step) => {
              const meta = STEP_STATE_META[step.state];
              return (
                <li
                  key={step.key}
                  aria-current={step.current ? 'step' : undefined}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="text-[var(--t-2)]">{step.label}</span>
                  <span className={cn('f-mono tabular-nums', meta.tone)}>{meta.label}</span>
                </li>
              );
            })}
          </ul>
          {cell.pipeline.failedStep && cell.pipeline.failedError ? (
            <p role="alert" className="t-cap text-[var(--bad)]">
              Échec « {cell.pipeline.failedStep} » : {cell.pipeline.failedError}
            </p>
          ) : null}
          {syncedLabel ? (
            <p className="t-cap text-[var(--t-3)]">Synchronisé {syncedLabel}</p>
          ) : null}

          {/* Régénérer — re-arm the AI step (J4 reruns the writing) */}
          <form action={regenAction} className="flex flex-col gap-1.5">
            <input type="hidden" name="date" value={cell.date} />
            <input type="hidden" name="slot" value={cell.slot} />
            {regenInfo ? (
              <p
                role={regenState?.ok ? undefined : 'alert'}
                className={cn('t-cap', regenState?.ok ? 'text-[var(--ok)]' : 'text-[var(--bad)]')}
              >
                {regenInfo}
              </p>
            ) : null}
            <Btn type="submit" kind="ghost" size="s" loading={regenPending} className="self-start">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
              Régénérer la rédaction
            </Btn>
          </form>
        </div>
      ) : null}
    </Card>
  );
}
