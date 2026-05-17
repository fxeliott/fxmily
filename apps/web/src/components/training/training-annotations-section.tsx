import { Image as ImageIcon, MessageSquare } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { SerializedTrainingAnnotation } from '@/lib/admin/training-annotation-service';
import { selectStorage, StorageError } from '@/lib/storage';

import { DeleteTrainingAnnotationButton } from './delete-training-annotation-button';

/**
 * Backtest-corrections list (J-T3 — carbon mirror of
 * `journal/annotations-section.tsx`).
 *
 * Used by:
 *   - `/admin/members/[id]/training/[trainingTradeId]` — admin, with the
 *     delete CTA + "Non lue" badge on rows the current admin authored.
 *   - `/training/[trainingTradeId]` — member, read-only.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): consumes `SerializedTrainingAnnotation`
 * only; `selectStorage().getReadUrl` resolves a `training_annotations/` key
 * (served by the GET route's training_annotation branch). Zero real-edge
 * reference. The "CORRECTION" pill is cyan (`--cy`) — NOT the journal's lime
 * `acc` — so the member never confuses a backtest correction with a
 * real-trade correction (non-confusability, Mark Douglas).
 */

const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface TrainingAnnotationsSectionProps {
  annotations: SerializedTrainingAnnotation[];
  /** Admin viewing surface — enables the delete CTA + "Non lue" badge. */
  isAdmin: boolean;
  /** Currently-authenticated user id — gates the delete button client-side
   * (the Server Action re-checks `(id, adminId)`). */
  currentUserId?: string | null;
}

/** Defensive: a corrupted `mediaKey` must not crash the page render. */
function safeReadUrl(storage: ReturnType<typeof selectStorage>, key: string | null): string | null {
  if (!key) return null;
  try {
    return storage.getReadUrl(key);
  } catch (err) {
    if (err instanceof StorageError) {
      console.error('[training-annotations-section] invalid mediaKey, dropping image', key, err);
      return null;
    }
    throw err;
  }
}

export function TrainingAnnotationsSection({
  annotations,
  isAdmin,
  currentUserId = null,
}: TrainingAnnotationsSectionProps) {
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
            <TrainingAnnotationCard
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

interface TrainingAnnotationCardProps {
  annotation: SerializedTrainingAnnotation;
  isAdmin: boolean;
  canDelete: boolean;
  mediaUrl: string | null;
}

function TrainingAnnotationCard({
  annotation,
  isAdmin,
  canDelete,
  mediaUrl,
}: TrainingAnnotationCardProps) {
  const formattedDate = DATETIME_FMT.format(new Date(annotation.createdAt));
  return (
    <Card className="p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Pill tone="cy">CORRECTION</Pill>
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
          <DeleteTrainingAnnotationButton trainingAnnotationId={annotation.id} />
        </footer>
      ) : null}
    </Card>
  );
}
