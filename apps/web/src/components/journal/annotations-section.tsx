import { Image as ImageIcon, MessageSquare } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedAnnotation } from '@/lib/admin/annotations-service';
import { selectStorage, StorageError } from '@/lib/storage';

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

/** Defensive wrapper: a corrupted `mediaKey` row would otherwise crash the
 * whole page render. Logs the error server-side and returns null so the
 * card still shows the comment. */
function safeReadUrl(storage: ReturnType<typeof selectStorage>, key: string | null): string | null {
  if (!key) return null;
  try {
    return storage.getReadUrl(key);
  } catch (err) {
    if (err instanceof StorageError) {
      console.error('[annotations-section] invalid mediaKey, dropping image', key, err);
      return null;
    }
    throw err;
  }
}

export function AnnotationsSection({
  annotations,
  isAdmin,
  currentUserId = null,
}: AnnotationsSectionProps) {
  // Empty state: render an explicit "0 correction" card on the admin surface
  // so the admin gets a clear "this trade has no correction yet" anchor next
  // to the "Annoter ce trade" CTA. On the member surface we hide the
  // section entirely — no need to advertise an absence.
  if (annotations.length === 0) {
    if (!isAdmin) return null;
    return (
      <section className="flex flex-col gap-3">
        <h2 className="t-h3 flex items-center gap-2 text-[var(--t-1)]">
          <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
          Corrections envoyées
          <span className="t-cap text-[var(--t-4)]">(0)</span>
        </h2>
        <Card className="p-4">
          <p className="t-body text-[var(--t-3)]">
            Aucune correction encore — le bouton ci-dessous en crée une.
          </p>
        </Card>
      </section>
    );
  }

  const storage = selectStorage();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="t-h3 flex items-center gap-2 text-[var(--t-1)]">
          <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
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
              mediaUrl={safeReadUrl(storage, annotation.mediaKey)}
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
  const createdAtDate = new Date(annotation.createdAt);
  const formattedDate = DATETIME_FMT.format(createdAtDate);
  return (
    <Card className="p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Pill tone="acc">CORRECTION</Pill>
        {isAdmin && annotation.isUnseenByMember ? (
          <Pill tone="warn" dot="live">
            Non lue
          </Pill>
        ) : null}
        {annotation.mediaType === 'image' ? (
          <Pill tone="mute">
            <ImageIcon className="h-2.5 w-2.5" strokeWidth={2} />
            Capture jointe
          </Pill>
        ) : null}
        <time dateTime={annotation.createdAt} className="t-cap ml-auto text-[var(--t-4)]">
          {formattedDate}
        </time>
      </header>

      <p className="t-body leading-relaxed whitespace-pre-wrap text-[var(--t-2)]">
        {annotation.comment}
      </p>

      {mediaUrl ? (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl}
            alt={`Capture annotée jointe à la correction du ${formattedDate}`}
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
