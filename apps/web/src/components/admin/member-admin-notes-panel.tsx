'use client';

import { Lock, NotebookPen, Send, Trash2 } from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';

import {
  createAdminNoteAction,
  deleteAdminNoteAction,
  type CreateAdminNoteActionState,
} from '@/app/admin/members/[id]/notes/actions';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { ADMIN_NOTE_BODY_MAX } from '@/lib/schemas/admin-note';
import type { SerializedAdminNote } from '@/lib/admin/admin-notes-service';

/**
 * Admin "Notes admin" tab panel (V2.1, SPEC §7.7).
 *
 * Eliot's private coaching memory about a member — an add form on top, a
 * newest-first timeline below. **The member never sees this** (the panel
 * is rendered only inside the admin member-detail page, the service is
 * `server-only` admin-scoped, and the Server Action re-checks
 * `role === 'admin'`). The lock affordance reinforces that for the admin.
 *
 * DS-v2 (lime / deep-space) — NOT the `.v18-theme` overlay (that scope is
 * REFLECT V1.8 only). Posture Mark Douglas: calm, neutral chrome; the
 * note content itself is free text (these are Eliot's own observations).
 *
 * Patterns carbone:
 *   - add form  → `annotate-trade-button` (useActionState + submit-with-
 *     reset wrapper, no `useEffect` setState).
 *   - delete    → `card-actions-row` (double-confirm + `useTransition` +
 *     sr-only `aria-live`, auto-cancel via `useEffect` cleanup).
 */

interface MemberAdminNotesPanelProps {
  memberId: string;
  notes: SerializedAdminNote[];
}

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

const initialState: CreateAdminNoteActionState | null = null;

export function MemberAdminNotesPanel({ memberId, notes }: MemberAdminNotesPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState('');

  // Wrap the Server Action so the textarea clears on success without a
  // `useEffect` setState (React 19 + react-hooks/set-state-in-effect).
  // `revalidatePath` in the action refreshes the parent Server Component
  // so the new note appears inline in the timeline below.
  const submitWithReset = async (
    prev: CreateAdminNoteActionState | null,
    formData: FormData,
  ): Promise<CreateAdminNoteActionState> => {
    const result = await createAdminNoteAction(memberId, prev, formData);
    if (result.ok) {
      setBody('');
      formRef.current?.reset();
    }
    return result;
  };
  const [state, formAction, isPending] = useActionState(submitWithReset, initialState);

  const remaining = ADMIN_NOTE_BODY_MAX - body.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Privacy affordance — reinforces SPEC §7.7 for the admin. */}
      <div className="rounded-control flex items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] px-3 py-2">
        <Lock className="h-3.5 w-3.5 text-[var(--t-4)]" strokeWidth={1.75} aria-hidden />
        <p className="t-cap text-[var(--t-2)]">Privé — le membre ne voit jamais ces notes.</p>
      </div>

      {/* Add note */}
      <Card className="p-0">
        <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
          <NotebookPen className="h-4 w-4 text-[var(--acc)]" aria-hidden />
          <h2 className="t-h2 text-[15px]">Nouvelle note</h2>
        </header>
        <form ref={formRef} action={formAction} className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="admin-note-body" className="t-eyebrow-lg text-[var(--t-3)]">
                Note
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
              id="admin-note-body"
              name="body"
              required
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={ADMIN_NOTE_BODY_MAX + 256 /* let the server enforce the hard cap */}
              placeholder="Ex. Tendance à doubler le sizing après 2 wins — surveiller l'over-confidence. À recadrer au prochain échange."
              className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-invalid={state?.fieldErrors?.body ? 'true' : undefined}
              aria-describedby={state?.fieldErrors?.body ? 'admin-note-body-error' : undefined}
            />
            {state?.fieldErrors?.body ? (
              <p id="admin-note-body-error" role="alert" className="text-[11px] text-[var(--bad)]">
                {state.fieldErrors.body}
              </p>
            ) : null}
          </div>

          {state?.error && state.error !== 'invalid_input' ? (
            <p role="alert" className="text-[12px] text-[var(--bad)]">
              {errorMessage(state.error)}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Btn
              type="submit"
              kind="primary"
              size="m"
              loading={isPending}
              disabled={isPending || body.trim().length === 0}
            >
              <Send className="h-4 w-4" strokeWidth={1.75} />
              Enregistrer la note
            </Btn>
          </div>
        </form>
      </Card>

      {/* Timeline */}
      {notes.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={NotebookPen}
            headline="Aucune note pour l'instant"
            lead="Garde ici tes observations privées sur ce membre : patterns récurrents, points à recadrer, progrès remarqués. Lui ne les verra jamais."
            tip="Une note courte écrite à chaud vaut mieux qu'un long bilan différé."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <header className="flex items-center gap-2 border-b border-[var(--b-default)] px-5 py-4">
            <h2 className="t-h2 text-[15px]">Notes</h2>
            <Pill tone="mute">{notes.length}</Pill>
          </header>
          <ul className="flex flex-col">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex flex-col gap-2 border-b border-[var(--b-default)] px-5 py-4 last:border-b-0"
              >
                <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-[var(--t-1)]">
                  {note.body}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <span className="t-cap font-mono text-[var(--t-4)] tabular-nums">
                    {DT.format(new Date(note.createdAt))}
                  </span>
                  <NoteDeleteButton noteId={note.id} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Per-note delete with a 4 s double-confirm + sr-only live region
 * (carbone `card-actions-row`). On success, `revalidatePath` in the
 * action drops the row from the re-rendered Server Component list.
 */
function NoteDeleteButton({ noteId }: { noteId: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-cancel confirmation after 4s — cleanup on unmount.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

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

  function onDelete() {
    if (!confirming) {
      setConfirming(true);
      announceFor(
        'Confirmation requise pour supprimer cette note. Clique à nouveau dans 4 secondes.',
      );
      return;
    }
    startTransition(async () => {
      const r = await deleteAdminNoteAction(noteId);
      if (!r.ok) {
        setConfirming(false);
        announceFor('Échec de la suppression, essaie à nouveau.');
      } else {
        announceFor('Note supprimée.');
      }
    });
  }

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <Btn
        type="button"
        kind="danger"
        size="s"
        onClick={onDelete}
        disabled={pending}
        aria-label={confirming ? 'Confirmer la suppression de la note' : 'Supprimer la note'}
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        {confirming ? 'Confirmer ?' : 'Supprimer'}
      </Btn>
    </>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'member_not_found':
      return 'Membre introuvable — la page a peut-être expiré.';
    default:
      return 'Échec de l’enregistrement. Réessaie dans un instant.';
  }
}
