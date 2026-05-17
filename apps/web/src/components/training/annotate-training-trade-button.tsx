'use client';

import { MessageSquarePlus, Send } from 'lucide-react';
import { useActionState, useId, useRef, useState } from 'react';

import {
  createTrainingAnnotationAction,
  type CreateTrainingAnnotationActionState,
} from '@/app/admin/members/[id]/training/[trainingTradeId]/actions';
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
import { TRAINING_ANNOTATION_COMMENT_MAX } from '@/lib/schemas/training-annotation';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';

/**
 * Admin "corriger ce backtest" CTA + Sheet (J-T3 — carbon mirror of
 * `admin/annotate-trade-button.tsx`). Same flow: open Sheet → comment +
 * optional capture → Server Action (create → enqueue notif → audit) → on
 * success the Sheet closes and the parent server component revalidates.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): the uploader uses
 * `kind="training-annotation-image"` + the `trainingTradeId` prop (NOT
 * `tradeId`) so the media lands under `training_annotations/{trainingTradeId}/`
 * and never a real-edge prefix; the action is the J-T3 one.
 */

interface AnnotateTrainingTradeButtonProps {
  memberId: string;
  trainingTradeId: string;
}

const initialState: CreateTrainingAnnotationActionState | null = null;

export function AnnotateTrainingTradeButton({
  memberId,
  trainingTradeId,
}: AnnotateTrainingTradeButtonProps) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [mediaKey, setMediaKey] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const submitWithReset = async (
    prev: CreateTrainingAnnotationActionState | null,
    formData: FormData,
  ): Promise<CreateTrainingAnnotationActionState> => {
    const result = await createTrainingAnnotationAction(memberId, trainingTradeId, prev, formData);
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

  const remaining = TRAINING_ANNOTATION_COMMENT_MAX - comment.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Btn kind="primary" size="m" className="w-full sm:w-auto">
          <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
          Corriger ce backtest
        </Btn>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="rounded-t-card max-h-[90dvh] overflow-y-auto border-x-0 border-t border-b-0 border-[var(--b-default)] bg-[var(--bg-1)] sm:max-h-[80dvh]"
      >
        <SheetHeader>
          <SheetTitle className="t-h2">Corriger ce backtest</SheetTitle>
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
              maxLength={TRAINING_ANNOTATION_COMMENT_MAX + 256 /* server enforces hard cap */}
              placeholder="Ex. R:R 1:2 prévu, mais entrée anticipée avant la confirmation — travaille la patience d'exécution (cf. fiche Douglas « attendre son setup »)."
              className="rounded-card resize-y border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2.5 font-sans text-[14px] leading-relaxed text-[var(--t-1)] placeholder:text-[var(--t-4)] focus-visible:border-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              aria-invalid={state?.fieldErrors?.comment ? 'true' : undefined}
            />
            {state?.fieldErrors?.comment ? (
              <p role="alert" className="text-[11px] text-[var(--bad)]">
                {state.fieldErrors.comment}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow">Capture annotée (optionnel)</span>
            <MediaUploader
              kind="training-annotation-image"
              trainingTradeId={trainingTradeId}
              name="mediaKey"
              mediaTypeName="mediaType"
              mediaTypeValue="image"
              acceptMime={ALLOWED_IMAGE_MIME_TYPES}
              maxBytes={MAX_SCREENSHOT_BYTES}
              idleLabel="Glisse une capture annotée"
              previewAlt="Capture annotée du backtest"
              error={state?.fieldErrors?.mediaKey}
              onUploaded={({ key }) => setMediaKey(key)}
              onCleared={() => setMediaKey(null)}
              onStatusChange={(status) => setIsUploading(status === 'uploading')}
            />
          </div>

          {state?.error && state.error !== 'invalid_input' ? (
            <p role="alert" className="text-[12px] text-[var(--bad)]">
              {errorMessage(state.error)}
            </p>
          ) : null}

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
    case 'training_trade_not_found':
      return 'Backtest introuvable — la page a peut-être expiré.';
    default:
      return 'Échec de l’envoi. Réessaie dans un instant.';
  }
}
