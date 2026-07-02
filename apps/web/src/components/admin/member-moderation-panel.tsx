'use client';

import { History, Info, ShieldCheck, ShieldX } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';

import {
  reinstateMemberAction,
  suspendMemberAction,
  type MemberModerationActionState,
} from '@/app/admin/members/[id]/moderation/actions';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import type { SerializedModerationEvent } from '@/lib/admin/member-moderation';
import { MEMBER_MODERATION_REASON_MAX } from '@/lib/schemas/member-moderation';

/**
 * Admin "Modération" tab panel (F5, overhaul 2026-06-30, SPEC §7.1).
 *
 * Lets the admin suspend (expel / retirer l'accès) or reinstate a member, with
 * an optional motif, and shows the append-only moderation history. **The member
 * never sees any of this** (admin-only tab + role-gated Server Actions). The
 * suspend control is a deliberate two-step confirm (carbone `NoteDeleteButton`)
 * because the action revokes access immediately; reinstate is a single step
 * (reversible, low-stakes).
 *
 * Success feedback: the parent Server Component re-renders on `revalidatePath`
 * and flips the status banner, BUT that flip also UNMOUNTS the form that held
 * the action's success `state` — so the success message would be lost and a
 * screen reader would never hear that the (destructive) action succeeded. We
 * therefore lift a `notice` to THIS panel (which survives the branch flip) and
 * render it in a persistent `role="status"` live region.
 */

interface MemberModerationPanelProps {
  memberId: string;
  memberName: string;
  status: 'active' | 'suspended' | 'deleted';
  role: 'member' | 'admin';
  /** True when the admin is viewing their own profile (cannot self-moderate). */
  isSelf: boolean;
  history: SerializedModerationEvent[];
}

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export function MemberModerationPanel({
  memberId,
  memberName,
  status,
  role,
  isSelf,
  history,
}: MemberModerationPanelProps) {
  // Latest suspension motif (for the suspended-state banner) — the newest
  // `suspended` event with a non-null reason.
  const latestSuspendReason =
    status === 'suspended' ? (history.find((e) => e.action === 'suspended')?.reason ?? null) : null;

  // Lifted here (not in the forms) so the success message survives the
  // suspend↔reinstate branch flip that the action's `revalidatePath` triggers.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {/* Persistent success live region — announces the outcome of the last
          destructive action even though the form that ran it has unmounted. */}
      <p role="status" aria-live="polite" className="sr-only">
        {notice ?? ''}
      </p>
      {notice ? (
        <div className="rounded-card flex items-start gap-2 border border-[var(--ok-edge)] bg-[var(--ok-dim)] px-4 py-3">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok)]"
            strokeWidth={2}
            aria-hidden
          />
          <p className="t-body text-[var(--t-1)]">{notice}</p>
        </div>
      ) : null}

      {/* Current status banner */}
      <StatusBanner status={status} latestSuspendReason={latestSuspendReason} />

      {/* Action card */}
      {role === 'admin' || isSelf ? (
        <Card className="flex items-start gap-3 p-5">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-4)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="t-body text-[var(--t-2)]">
            {isSelf
              ? 'Tu ne peux pas suspendre ton propre compte.'
              : 'Un compte administrateur ne peut pas être suspendu depuis cet espace.'}
          </p>
        </Card>
      ) : status === 'active' ? (
        <SuspendForm memberId={memberId} memberName={memberName} onSuccess={setNotice} />
      ) : status === 'suspended' ? (
        <ReinstateForm memberId={memberId} memberName={memberName} onSuccess={setNotice} />
      ) : (
        // Defense-in-depth only: `getMemberDetail` 404s a `deleted` member before
        // this page renders, so this branch is unreachable via the UI — kept in
        // case the panel is ever mounted from another surface.
        <Card className="flex items-start gap-3 p-5">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--t-4)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <p className="t-body text-[var(--t-2)]">
            Ce compte est supprimé (RGPD). La modération ne s’applique plus.
          </p>
        </Card>
      )}

      {/* Moderation history */}
      <ModerationHistory history={history} />
    </div>
  );
}

function StatusBanner({
  status,
  latestSuspendReason,
}: {
  status: 'active' | 'suspended' | 'deleted';
  latestSuspendReason: string | null;
}) {
  if (status === 'suspended') {
    return (
      <Card className="flex flex-col gap-2 border-[var(--warn-edge)] bg-[var(--warn-dim)] p-5">
        <div className="flex items-center gap-2">
          <ShieldX className="h-4 w-4 text-[var(--warn)]" strokeWidth={2} aria-hidden />
          <h2 className="t-h2 text-[15px] text-[var(--t-1)]">Membre suspendu</h2>
          <Pill tone="warn">Accès révoqué</Pill>
        </div>
        <p className="t-body text-[var(--t-2)]">
          Ce membre est déconnecté et ne peut plus se connecter tant qu’il n’est pas réintégré.
        </p>
        {latestSuspendReason ? (
          <p className="rounded-control border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[var(--t-2)]">
            <span className="t-eyebrow mb-1 block text-[var(--t-4)]">Motif</span>
            {latestSuspendReason}
          </p>
        ) : (
          <p className="t-cap text-[var(--t-4)]">Aucun motif renseigné.</p>
        )}
      </Card>
    );
  }
  return (
    <Card className="flex items-center gap-2 p-5">
      <ShieldCheck className="h-4 w-4 text-[var(--ok)]" strokeWidth={2} aria-hidden />
      <h2 className="t-h2 text-[15px] text-[var(--t-1)]">Membre actif</h2>
      <Pill tone="ok">Accès normal</Pill>
    </Card>
  );
}

function SuspendForm({
  memberId,
  memberName,
  onSuccess,
}: {
  memberId: string;
  memberName: string;
  onSuccess: (message: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState('');

  const runAction = async (
    prev: MemberModerationActionState | null,
    formData: FormData,
  ): Promise<MemberModerationActionState> => {
    const result = await suspendMemberAction(memberId, prev, formData);
    if (result.ok) {
      setReason('');
      setConfirming(false);
      formRef.current?.reset();
      // Lift the success message to the panel before `revalidatePath` unmounts
      // this form (the branch flips to ReinstateForm).
      onSuccess(result.message ?? 'Membre suspendu, accès révoqué immédiatement.');
    }
    return result;
  };
  const [state, formAction, isPending] = useActionState(runAction, null);

  // Auto-cancel the confirmation step after 5s — cleanup on unmount.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(id);
  }, [confirming]);

  const remaining = MEMBER_MODERATION_REASON_MAX - reason.length;

  return (
    <Card className="p-0">
      <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
        <ShieldX className="h-4 w-4 text-[var(--bad)]" strokeWidth={1.75} aria-hidden />
        <h2 className="t-h2 text-[15px]">Suspendre {memberName}</h2>
      </header>
      <form ref={formRef} action={formAction} className="flex flex-col gap-3 p-5">
        <p className="t-body text-[var(--t-2)]">
          Le membre sera <strong className="text-[var(--t-1)]">déconnecté immédiatement</strong> et
          ne pourra plus se connecter. Ses données sont conservées, tu pourras le réintégrer à tout
          moment.
        </p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="suspend-reason" className="t-eyebrow-lg text-[var(--t-3)]">
              Motif (optionnel)
            </label>
            <span
              className={`t-cap tabular-nums ${
                remaining < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-4)]'
              }`}
            >
              {remaining}
            </span>
          </div>
          <textarea
            id="suspend-reason"
            name="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MEMBER_MODERATION_REASON_MAX + 256 /* server enforces the hard cap */}
            placeholder="Ex. Non-renouvellement de l'abonnement. Visible uniquement par toi."
            className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-invalid={state?.fieldErrors?.reason ? 'true' : undefined}
            aria-describedby={state?.fieldErrors?.reason ? 'suspend-reason-error' : undefined}
          />
          {state?.fieldErrors?.reason ? (
            <p id="suspend-reason-error" role="alert" className="text-[11px] text-[var(--bad)]">
              {state.fieldErrors.reason}
            </p>
          ) : null}
        </div>

        {state && !state.ok && state.error !== 'invalid_input' ? (
          <p role="alert" className="text-[12px] text-[var(--bad)]">
            {state.message ?? 'Échec de la suspension. Réessaie.'}
          </p>
        ) : null}

        <span role="status" aria-live="polite" className="sr-only">
          {announce}
        </span>

        <div className="flex flex-wrap justify-end gap-2">
          {!confirming ? (
            <Btn
              type="button"
              kind="danger"
              size="m"
              onClick={() => {
                setConfirming(true);
                setAnnounce('Confirmation requise. Clique sur « Confirmer » dans les 5 secondes.');
              }}
            >
              <ShieldX className="h-4 w-4" strokeWidth={1.75} />
              Suspendre le membre
            </Btn>
          ) : (
            <>
              <Btn
                type="button"
                kind="ghost"
                size="m"
                disabled={isPending}
                onClick={() => setConfirming(false)}
              >
                Annuler
              </Btn>
              <Btn type="submit" kind="danger" size="m" loading={isPending}>
                <ShieldX className="h-4 w-4" strokeWidth={1.75} />
                Confirmer la suspension
              </Btn>
            </>
          )}
        </div>
      </form>
    </Card>
  );
}

function ReinstateForm({
  memberId,
  memberName,
  onSuccess,
}: {
  memberId: string;
  memberName: string;
  onSuccess: (message: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState('');

  const runAction = async (
    prev: MemberModerationActionState | null,
    formData: FormData,
  ): Promise<MemberModerationActionState> => {
    const result = await reinstateMemberAction(memberId, prev, formData);
    if (result.ok) {
      setReason('');
      formRef.current?.reset();
      onSuccess(result.message ?? 'Membre réintégré, il peut de nouveau se connecter.');
    }
    return result;
  };
  const [state, formAction, isPending] = useActionState(runAction, null);

  const remaining = MEMBER_MODERATION_REASON_MAX - reason.length;

  return (
    <Card className="p-0">
      <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
        <ShieldCheck className="h-4 w-4 text-[var(--acc)]" strokeWidth={1.75} aria-hidden />
        <h2 className="t-h2 text-[15px]">Réintégrer {memberName}</h2>
      </header>
      <form ref={formRef} action={formAction} className="flex flex-col gap-3 p-5">
        <p className="t-body text-[var(--t-2)]">
          Le membre pourra de nouveau se connecter dès la réintégration. Toutes ses données sont
          restées intactes pendant la suspension.
        </p>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="reinstate-reason" className="t-eyebrow-lg text-[var(--t-3)]">
              Motif (optionnel)
            </label>
            <span
              className={`t-cap tabular-nums ${
                remaining < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-4)]'
              }`}
            >
              {remaining}
            </span>
          </div>
          <textarea
            id="reinstate-reason"
            name="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MEMBER_MODERATION_REASON_MAX + 256}
            placeholder="Ex. Reprise de l'abonnement. Visible uniquement par toi."
            className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            aria-invalid={state?.fieldErrors?.reason ? 'true' : undefined}
            aria-describedby={state?.fieldErrors?.reason ? 'reinstate-reason-error' : undefined}
          />
          {state?.fieldErrors?.reason ? (
            <p id="reinstate-reason-error" role="alert" className="text-[11px] text-[var(--bad)]">
              {state.fieldErrors.reason}
            </p>
          ) : null}
        </div>

        {state && !state.ok && state.error !== 'invalid_input' ? (
          <p role="alert" className="text-[12px] text-[var(--bad)]">
            {state.message ?? 'Échec de la réintégration. Réessaie.'}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Btn type="submit" kind="primary" size="m" loading={isPending}>
            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
            Réintégrer le membre
          </Btn>
        </div>
      </form>
    </Card>
  );
}

function ModerationHistory({ history }: { history: SerializedModerationEvent[] }) {
  if (history.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={History}
          headline="Aucun historique de modération"
          lead="Les suspensions et réintégrations de ce membre apparaîtront ici, avec leur date et leur motif."
        />
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
        <History className="h-4 w-4 text-[var(--t-3)]" strokeWidth={1.75} aria-hidden />
        <h2 className="t-h2 text-[15px]">Historique</h2>
        <Pill tone="mute">{history.length}</Pill>
      </header>
      <ul className="flex flex-col">
        {history.map((event) => (
          <li
            key={event.id}
            className="flex flex-col gap-1.5 border-b border-[var(--b-default)] px-5 py-4 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-3">
              {event.action === 'suspended' ? (
                <Pill tone="warn">
                  <ShieldX className="h-2.5 w-2.5" strokeWidth={2} />
                  Suspendu
                </Pill>
              ) : (
                <Pill tone="ok">
                  <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2} />
                  Réintégré
                </Pill>
              )}
              <span className="t-cap font-mono text-[var(--t-4)] tabular-nums">
                {DT.format(new Date(event.createdAt))}
              </span>
            </div>
            {event.reason ? (
              <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[var(--t-2)]">
                {event.reason}
              </p>
            ) : (
              <p className="t-cap text-[var(--t-4)]">Sans motif.</p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
