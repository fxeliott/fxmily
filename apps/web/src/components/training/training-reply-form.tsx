'use client';

import { MessageSquareReply, Send } from 'lucide-react';
import { useActionState, useId, useState } from 'react';

import {
  replyToTrainingAnnotationAction,
  type ReplyTrainingAnnotationActionState,
} from '@/app/training/actions';
import { Btn } from '@/components/ui/btn';
import { TRAINING_REPLY_MAX } from '@/lib/schemas/training-annotation';
import { TRAINING_UI_COPY } from '@/lib/training/training-ui-copy';

/**
 * Member reply to a backtest correction (S8 V2 §32-4 — « le membre les voit et
 * peut y répondre »). Inline client island under each correction on
 * `/training/[trainingTradeId]`.
 *
 * Collapsed by default (a toggle reveals the textarea) so a long corrections
 * list stays scannable. On success the Server Action `revalidatePath`s the
 * detail page, so the parent server component re-renders with the persisted
 * reply — the local `open` state simply closes.
 *
 * 🚨 §21.5 / garde-fou §2: this is a psychology/process exchange — the reply is
 * hardened + AMF-safe server-side (`trainingReplyCreateSchema`). The CTA uses
 * the blue `--acc` accent (the surface's single CTA colour), never the cyan
 * training identity.
 */

interface TrainingReplyFormProps {
  trainingAnnotationId: string;
  /** The member's existing reply, or null if they haven't answered yet. */
  existingReply: string | null;
}

const initialState: ReplyTrainingAnnotationActionState | null = null;

export function TrainingReplyForm({ trainingAnnotationId, existingReply }: TrainingReplyFormProps) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState(existingReply ?? '');

  const submitWithClose = async (
    prev: ReplyTrainingAnnotationActionState | null,
    formData: FormData,
  ): Promise<ReplyTrainingAnnotationActionState> => {
    const result = await replyToTrainingAnnotationAction(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  };
  const [state, formAction, isPending] = useActionState(submitWithClose, initialState);

  const remaining = TRAINING_REPLY_MAX - reply.length;

  if (!open) {
    return (
      <div className="mt-3 border-t border-[var(--b-subtle)] pt-3">
        <Btn
          type="button"
          kind="ghost"
          size="s"
          onClick={() => setOpen(true)}
          className="text-[var(--cy)]"
        >
          <MessageSquareReply className="h-3.5 w-3.5" strokeWidth={1.75} />
          {existingReply ? 'Modifier ta réponse' : 'Répondre à Eliott'}
        </Btn>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-3 flex flex-col gap-2 border-t border-[var(--b-subtle)] pt-3"
    >
      <input type="hidden" name="trainingAnnotationId" value={trainingAnnotationId} />
      <div className="flex items-baseline justify-between">
        <label htmlFor={`${formId}-reply`} className="t-eyebrow">
          Ta réponse
        </label>
        <span
          id={`${formId}-reply-counter`}
          className={`t-cap tabular-nums ${remaining < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-4)]'}`}
        >
          {remaining}
          <span className="sr-only"> caractères restants sur {TRAINING_REPLY_MAX}</span>
        </span>
      </div>
      <textarea
        id={`${formId}-reply`}
        name="reply"
        required
        rows={3}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        maxLength={TRAINING_REPLY_MAX + 256 /* server enforces the hard cap */}
        placeholder={TRAINING_UI_COPY.replyPlaceholder}
        className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        aria-invalid={state?.fieldErrors?.reply ? 'true' : undefined}
        aria-describedby={
          [`${formId}-reply-counter`, state?.fieldErrors?.reply ? `${formId}-reply-error` : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
      {state?.fieldErrors?.reply ? (
        <p id={`${formId}-reply-error`} role="alert" className="text-[11px] text-[var(--bad)]">
          {state.fieldErrors.reply}
        </p>
      ) : null}
      {state?.error && state.error !== 'invalid_input' ? (
        <p role="alert" className="text-[12px] text-[var(--bad)]">
          {errorMessage(state.error)}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Btn
          type="button"
          kind="secondary"
          size="s"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          Annuler
        </Btn>
        <Btn
          type="submit"
          kind="primary"
          size="s"
          loading={isPending}
          disabled={isPending || reply.trim().length === 0}
        >
          <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
          Envoyer ma réponse
        </Btn>
      </div>
    </form>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    case 'not_found':
      return 'Correction introuvable, la page a peut-être expiré.';
    default:
      return 'Échec de l’envoi. Réessaie dans un instant.';
  }
}
