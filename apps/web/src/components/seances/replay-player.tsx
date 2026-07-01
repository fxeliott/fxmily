import { Clapperboard, Loader2 } from 'lucide-react';

/**
 * Replay surface (Server Component). Three states, mirror the static hub:
 *  - `processing`  → Vimeo still transcoding: a calm "en préparation" card, no iframe.
 *  - no embed URL  → replay not available yet (transcript-first ship): info card.
 *  - embed URL     → 16:9 privacy iframe (dnt=1, chrome stripped).
 *
 * The raw transcript is NEVER embedded here — only the official Vimeo replay.
 */
export function ReplayPlayer({
  embedUrl,
  processing,
  title,
}: {
  embedUrl: string | null;
  processing: boolean;
  title: string;
}) {
  if (processing) {
    return (
      <div className="rounded-card flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-5 text-[var(--t-2)]">
        <Loader2
          className="h-5 w-5 shrink-0 text-[var(--acc)] motion-safe:animate-spin"
          aria-hidden="true"
        />
        <p className="t-body">
          Le replay est en cours de préparation. Il s&apos;affichera ici dès qu&apos;il sera prêt.
        </p>
      </div>
    );
  }

  if (!embedUrl) {
    return (
      <div className="rounded-card flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] px-4 py-5 text-[var(--t-2)]">
        <Clapperboard className="h-5 w-5 shrink-0 text-[var(--t-3)]" aria-hidden="true" />
        <p className="t-body">Le replay de cette séance n&apos;est pas disponible.</p>
      </div>
    );
  }

  return (
    <div className="rounded-card relative aspect-video w-full overflow-hidden border border-[var(--b-default)] bg-black">
      <iframe
        src={embedUrl}
        title={`Replay · ${title}`}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
