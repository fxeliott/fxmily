'use client';

import { MessageSquarePlus, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useActionState } from 'react';

import { CommentPalette } from '@/components/admin/comment-palette';
import { Btn } from '@/components/ui/btn';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ANNOTATION_COMMENT_MAX } from '@/lib/schemas/annotation';
import { TRACKING_AXES } from '@/lib/tracking/axes';

import {
  createAnnotationAction,
  type CreateAnnotationActionState,
} from '@/app/admin/members/[id]/trades/[tradeId]/actions';

/**
 * Admin "annotate this trade" CTA + Sheet form (J4, SPEC §7.8).
 *
 * Mobile-first: the Sheet slides in from the bottom on mobile, anchoring the
 * form above the home indicator. Desktop layout is responsive — the bottom
 * sheet keeps reading "modal-like" up to wide viewports without competing
 * with the trade detail view.
 *
 * Flow:
 *   1. Admin clicks "Annoter ce trade" → Sheet opens.
 *   2. Types a comment + (optional) pastes a TradingView link (Tour 13 —
 *      replaces the former screenshot upload).
 *   3. Submits → Server Action runs:
 *        create row → enqueue notif → email best-effort → audit.
 *   4. On success the Sheet closes and the parent page revalidates so the
 *      annotations list refreshes inline.
 */

interface AnnotateTradeButtonProps {
  memberId: string;
  tradeId: string;
}

const initialState: CreateAnnotationActionState | null = null;

export function AnnotateTradeButton({ memberId, tradeId }: AnnotateTradeButtonProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');

  // Wrap the Server Action so the Sheet closes + form resets on success
  // without touching `useEffect` (React 19 + react-hooks/set-state-in-effect).
  // Local resets stay client-side; revalidatePath in the action refreshes the
  // parent server component so the new annotation appears inline.
  const submitWithReset = async (
    prev: CreateAnnotationActionState | null,
    formData: FormData,
  ): Promise<CreateAnnotationActionState> => {
    const result = await createAnnotationAction(memberId, tradeId, prev, formData);
    if (result.ok) {
      setOpen(false);
      setComment('');
      formRef.current?.reset();
    }
    return result;
  };
  const [state, formAction, isPending] = useActionState(submitWithReset, initialState);

  // Palette insert: append the reframe to the existing comment (never replace),
  // clamp to the hard cap so a tap can't overflow, then focus the field so the
  // admin keeps typing inline. Newline separator keeps stacked reframes legible.
  const insertPreset = (text: string) => {
    setComment((current) => {
      const base = current.trimEnd();
      const merged = base.length > 0 ? `${base}\n${text}` : text;
      return merged.slice(0, ANNOTATION_COMMENT_MAX);
    });
    textareaRef.current?.focus();
  };

  const remaining = ANNOTATION_COMMENT_MAX - comment.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Btn kind="primary" size="m" className="w-full sm:w-auto">
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
          Annoter ce trade
        </Btn>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="rounded-t-card max-h-[90dvh] overflow-y-auto border-x-0 border-t border-b-0 border-[var(--b-default)] bg-[var(--bg-1)] sm:max-h-[80dvh]"
      >
        <SheetHeader>
          <SheetTitle className="t-h2">Annoter ce trade</SheetTitle>
          <SheetDescription className="t-body text-[var(--t-3)]">
            Conseils sur l&apos;exécution, la discipline et la psychologie. Pas d&apos;analyse de
            marché.
          </SheetDescription>
        </SheetHeader>

        <form
          ref={formRef}
          id={formId}
          action={formAction}
          className="flex flex-col gap-4 px-4 pb-4"
        >
          {/* Comment field */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor={`${formId}-comment`} className="t-eyebrow">
                Correction
              </label>
              <span
                id={`${formId}-comment-counter`}
                className={`t-cap tabular-nums ${remaining < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-4)]'}`}
              >
                {remaining}
                <span className="sr-only"> caractères restants sur {ANNOTATION_COMMENT_MAX}</span>
              </span>
            </div>
            <CommentPalette onInsert={insertPreset} disabled={isPending} />
            <textarea
              ref={textareaRef}
              id={`${formId}-comment`}
              name="comment"
              required
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={ANNOTATION_COMMENT_MAX + 256 /* let server enforce hard cap */}
              placeholder="Ex. R:R 1:2 prévu, mais sizing doublé après 2 wins, attention au pattern over-confidence (cf. fiche Douglas « arrogance précède la chute »)."
              className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-invalid={state?.fieldErrors?.comment ? 'true' : undefined}
              aria-describedby={
                [
                  `${formId}-comment-counter`,
                  state?.fieldErrors?.comment ? `${formId}-comment-error` : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            {state?.fieldErrors?.comment ? (
              <p
                id={`${formId}-comment-error`}
                role="alert"
                className="text-[11px] text-[var(--bad)]"
              >
                {state.fieldErrors.comment}
              </p>
            ) : null}
          </div>

          {/* Coaching axis (optional) — J-AI corrections echo. A native select
              (no shadcn Select primitive exists in this DS) styled to match the
              comment field; it submits its value through FormData like every
              other field. Empty option = untagged (null server-side). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${formId}-axis`} className="t-eyebrow">
              Axe de coaching (optionnel)
            </label>
            <select
              id={`${formId}-axis`}
              name="axis"
              defaultValue=""
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
            >
              <option value="">Aucun axe</option>
              {TRACKING_AXES.map((axis) => (
                <option key={axis.id} value={axis.id}>
                  {axis.label}
                </option>
              ))}
            </select>
            <span className="t-cap text-[var(--t-4)]">
              Relie cette correction à un axe de suivi pour l&apos;écho au membre.
            </span>
          </div>

          {/* Tour 13 — optional TradingView link (replaces the former upload).
              Type=url + inputMode so mobile keyboards surface the URL layout. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${formId}-tvurl`} className="t-eyebrow">
              Lien TradingView (optionnel)
            </label>
            <input
              id={`${formId}-tvurl`}
              name="tradingViewUrl"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://fr.tradingview.com/x/…"
              className="rounded-card border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-invalid={state?.fieldErrors?.tradingViewUrl ? 'true' : undefined}
              aria-describedby={
                [
                  `${formId}-tvurl-help`,
                  state?.fieldErrors?.tradingViewUrl ? `${formId}-tvurl-error` : null,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
            />
            <span id={`${formId}-tvurl-help`} className="t-cap text-[var(--t-4)]">
              Partage un snapshot ou un layout TradingView pour appuyer ta correction.
            </span>
            {state?.fieldErrors?.tradingViewUrl ? (
              <p
                id={`${formId}-tvurl-error`}
                role="alert"
                className="text-[11px] text-[var(--bad)]"
              >
                {state.fieldErrors.tradingViewUrl}
              </p>
            ) : null}
          </div>

          {/* Top-level errors */}
          {state?.error && state.error !== 'invalid_input' ? (
            <p role="alert" className="text-[12px] text-[var(--bad)]">
              {errorMessage(state.error)}
            </p>
          ) : null}

          {/* Submit row */}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Btn
              type="button"
              kind="secondary"
              size="m"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Annuler
            </Btn>
            <Btn
              type="submit"
              kind="primary"
              size="m"
              loading={isPending}
              disabled={isPending || comment.trim().length === 0}
            >
              <Send className="h-4 w-4" strokeWidth={1.75} />
              Envoyer correction
            </Btn>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function errorMessage(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Session expirée, reconnecte-toi.';
    case 'forbidden':
      return 'Action réservée à l’admin.';
    case 'trade_not_found':
      return 'Trade introuvable, la page a peut-être expiré.';
    default:
      return 'Échec de l’envoi. Réessaie dans un instant.';
  }
}
