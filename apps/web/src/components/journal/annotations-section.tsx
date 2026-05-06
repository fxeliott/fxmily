import { Image as ImageIcon, MessageSquare } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedAnnotation } from '@/lib/admin/annotations-service';
import { selectStorage } from '@/lib/storage';

import { DeleteAnnotationButton } from './delete-annotation-button';

/**
 * Annotations list section (J4, SPEC §7.8).
 *
 * Used by:
 *   - `/admin/members/[id]/trades/[tradeId]` — admin view, shows the delete
 *     button on each card the current admin authored.
 *   - `/journal/[id]` — member view, read-only.
 *
 * Rendering policy:
 *   - Render newest annotation first.
 *   - "Non lue" pill for any annotation with `seenByMemberAt = null` (admin
 *     surface only — by the time the member sees the page their annotations
 *     are bulk-marked as seen).
 *   - Plain-text rendering with `whitespace-pre-wrap` — markdown rendering
 *     ships when we wire `react-markdown` (J6+). Comments are sanitised at
 *     write time via Zod's trim + max length.
 */

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface AnnotationsSectionProps {
  annotations: SerializedAnnotation[];
  /** Admin viewing surface — enables the delete CTA + "non lue" badge. */
  isAdmin: boolean;
  /** Identifier of the currently-authenticated user — used by the delete
   * button to gate ownership client-side (server re-checks). */
  currentUserId?: string | null;
}

export function AnnotationsSection({
  annotations,
  isAdmin,
  currentUserId = null,
}: AnnotationsSectionProps) {
  if (annotations.length === 0) {
    return null;
  }

  const storage = selectStorage();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="t-eyebrow flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
          {isAdmin ? 'Corrections envoyées' : 'Corrections reçues'}
          <span className="t-cap text-[var(--t-4)]">({annotations.length})</span>
        </h2>
      </div>

      <ol className="flex flex-col gap-3">
        {annotations.map((annotation) => (
          <li key={annotation.id}>
            <AnnotationCard
              annotation={annotation}
              isAdmin={isAdmin}
              canDelete={isAdmin && currentUserId === annotation.adminId}
              mediaUrl={annotation.mediaKey ? storage.getReadUrl(annotation.mediaKey) : null}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

interface AnnotationCardProps {
  annotation: SerializedAnnotation;
  isAdmin: boolean;
  canDelete: boolean;
  mediaUrl: string | null;
}

function AnnotationCard({ annotation, isAdmin, canDelete, mediaUrl }: AnnotationCardProps) {
  return (
    <Card className="p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Pill tone="acc">CORRECTION</Pill>
        {isAdmin && annotation.isUnseenByMember ? (
          <Pill tone="warn" dot="live">
            Non lue
          </Pill>
        ) : null}
        {!isAdmin && annotation.mediaType === 'image' ? (
          <Pill tone="cy">
            <ImageIcon className="h-2.5 w-2.5" strokeWidth={2} />
            Capture jointe
          </Pill>
        ) : null}
        <span className="t-cap ml-auto text-[var(--t-4)]">
          {DATETIME_FMT.format(new Date(annotation.createdAt))}
        </span>
      </header>

      <p className="t-body whitespace-pre-wrap leading-relaxed text-[var(--t-2)]">
        {annotation.comment}
      </p>

      {mediaUrl ? (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl}
            alt="Capture annotée"
            className="rounded-card max-h-96 w-full border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
          />
        </div>
      ) : null}

      {canDelete ? (
        <footer className="mt-3 flex justify-end">
          <DeleteAnnotationButton annotationId={annotation.id} />
        </footer>
      ) : null}
    </Card>
  );
}
