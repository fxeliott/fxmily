'use client';

import { MessageSquarePlus, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useActionState } from 'react';

import { MediaUploader } from '@/components/media-uploader';
import { Btn } from '@/components/ui/btn';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';
import { ANNOTATION_COMMENT_MAX } from '@/lib/schemas/annotation';

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
 *   2. Types a comment + (optional) drops a screenshot.
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
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [mediaKey, setMediaKey] = useState<string | null>(null);
  /** Tracks the MediaUploader's in-flight upload so we can block submit
   * between the moment a file is dropped and the moment /api/uploads has
   * answered with a key. Without this, an admin who clicks Submit while
   * the upload is mid-flight would create a comment-only annotation and
   * leave an orphan file in storage. */
  const [isUploading, setIsUploading] = useState(false);

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
      setMediaKey(null);
      setIsUploading(false);
      formRef.current?.reset();
    }
    return result;
  };
  const [state, formAction, isPending] = useActionState(submitWithReset, initialState);

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
        className="rounded-t-card max-h-[90dvh] overflow-y-auto border-x-0 border-b-0 border-t border-[var(--b-default)] bg-[var(--bg-1)] sm:max-h-[80dvh]"
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
                className={`t-cap tabular-nums ${remaining < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-4)]'}`}
              >
                {remaining}
              </span>
            </div>
            <textarea
              id={`${formId}-comment`}
              name="comment"
              required
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={ANNOTATION_COMMENT_MAX + 256 /* let server enforce hard cap */}
              placeholder="Ex. Plan respecté à 100%, mais entrée à contre-tendance — revois le check de structure avant le tap."
              className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-invalid={state?.fieldErrors?.comment ? 'true' : undefined}
            />
            {state?.fieldErrors?.comment ? (
              <p role="alert" className="text-[11px] text-[var(--bad)]">
                {state.fieldErrors.comment}
              </p>
            ) : null}
          </div>

          {/* Media uploader (image-only at J4) */}
          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">Capture annotée (optionnel)</span>
            <MediaUploader
              kind="annotation-image"
              tradeId={tradeId}
              name="mediaKey"
              mediaTypeName="mediaType"
              mediaTypeValue="image"
              acceptMime={ALLOWED_IMAGE_MIME_TYPES}
              maxBytes={MAX_SCREENSHOT_BYTES}
              idleLabel="Glisse une capture annotée"
              previewAlt="Capture annotée"
              error={state?.fieldErrors?.mediaKey}
              onUploaded={({ key }) => setMediaKey(key)}
              onCleared={() => setMediaKey(null)}
              onStatusChange={(status) => setIsUploading(status === 'uploading')}
            />
            <span className="t-cap text-[var(--t-4)]">
              Vidéo Zoom (jusqu&apos;à 500 Mo) — prochain jalon, dès que R2 sera configuré.
            </span>
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
              disabled={isPending || isUploading || comment.trim().length === 0}
              aria-describedby={isUploading ? `${formId}-upload-blocking` : undefined}
            >
              <Send className="h-4 w-4" strokeWidth={1.75} />
              {isUploading
                ? 'Upload en cours…'
                : mediaKey
                  ? 'Envoyer correction + capture'
                  : 'Envoyer correction'}
            </Btn>
            {isUploading ? (
              <span
                id={`${formId}-upload-blocking`}
                role="status"
                aria-live="polite"
                className="t-cap text-[var(--t-4)] sm:hidden"
              >
                Patiente, la capture s&apos;envoie.
              </span>
            ) : null}
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
      return 'Trade introuvable — la page a peut-être expiré.';
    default:
      return 'Échec de l’envoi. Réessaie dans un instant.';
  }
}
