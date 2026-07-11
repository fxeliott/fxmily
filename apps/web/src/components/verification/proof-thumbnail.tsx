import { ImageOff } from 'lucide-react';

/**
 * `/verification` proof thumbnail — purge-aware (Tour 13).
 *
 * MT5 captures are DELETED from storage once the analysis reaches a terminal
 * state (`filePurgedAt` stamped by `purgeProofFile` — confidentiality: the
 * screenshot has served its purpose, only the extracted positions + SHA-256
 * fingerprint are kept). The DB row survives, so the signed `readUrl` of a
 * purged proof points at a file that no longer exists.
 *
 * - `purged: false` → the original clickable thumbnail (anchor + <img>,
 *   opens the capture full-size in a new tab).
 * - `purged: true`  → a static dashed placeholder with NO <img> and NO link,
 *   so the browser never fires a request against the missing file (no 404
 *   in the network tab, no broken-image icon). The box is decorative
 *   (`aria-hidden`); the visible French caption « Capture analysée puis
 *   supprimée (confidentialité) » lives in the metadata column of the parent
 *   card (`app/verification/page.tsx`) where screen readers pick it up.
 *
 * Pure server-compatible component (no hooks) — rendered by the RSC page,
 * unit-tested with RTL under jsdom.
 */
export function ProofThumbnail({
  purged,
  readUrl,
  openAriaLabel,
}: {
  readonly purged: boolean;
  readonly readUrl: string;
  readonly openAriaLabel: string;
}) {
  if (purged) {
    return (
      <div
        data-slot="proof-thumbnail-purged"
        aria-hidden
        className="rounded-card flex h-16 w-24 shrink-0 items-center justify-center border border-dashed border-[var(--b-default)] bg-[var(--bg-1)]"
      >
        <ImageOff className="h-5 w-5 text-[var(--t-4)]" aria-hidden />
      </div>
    );
  }

  return (
    <a
      href={readUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={openAriaLabel}
      className="rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={readUrl}
        alt="Capture d'historique MT5"
        loading="lazy"
        className="rounded-card h-16 w-24 border border-[var(--b-default)] object-cover"
      />
    </a>
  );
}
