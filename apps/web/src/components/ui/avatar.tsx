import { cn } from '@/lib/utils';
import { AvatarImage } from './avatar-image';

/**
 * Avatar — shared member face primitive (leaderboard, settings, onboarding).
 *
 * Renders the member's uploaded photo when present, otherwise a calm initials
 * disc (never a broken image, never an empty circle). The image URL is issued
 * by the storage layer (`selectStorage().getReadUrl(avatarKey)`) and the
 * initials/first-name are pre-computed by the leaderboard service, so this
 * component NEVER re-derives display data, it only paints it.
 *
 * The initials disc is ALWAYS rendered as the base layer; the photo (a tiny
 * {@link AvatarImage} client island) is painted on top and removes itself on a
 * load error, so an expired/deleted src degrades to the initials instead of a
 * broken-image glyph — the "never a broken image" promise holds at runtime,
 * not just when the URL is null at render time.
 *
 * Storage-agnostic on purpose: the src can be a same-origin API path
 * (`/api/uploads/avatars/…` in dev) or an absolute object-store URL (R2 in
 * prod), so a plain `<img>` is the right tool here rather than `next/image`
 * (which would demand per-backend `remotePatterns` config). The photo is
 * already normalized server-side to a 512px square WebP, so there is no
 * layout-shift or over-fetch to optimize away.
 *
 * Server Component; only the swap-on-error image layer is a client island.
 */

export interface AvatarProps {
  /** Read URL for the member's photo, or null → initials fallback. */
  url: string | null;
  /** Uppercase initials shown when there is no photo. */
  initials: string;
  /** First name, used only for the image alt text (accessibility). */
  firstName: string;
  /** Rendered square size in pixels. Default 40. */
  size?: number;
  /** Accent ring — used to self-highlight the viewer's own avatar. */
  ring?: boolean;
  className?: string;
}

export function Avatar({
  url,
  initials,
  firstName,
  size = 40,
  ring,
  className,
}: AvatarProps): React.ReactElement {
  return (
    <span
      data-slot="avatar"
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full',
        'bg-gradient-to-br from-[var(--bg-3)] to-[var(--bg-2)] text-[var(--t-2)]',
        'ring-1 ring-[var(--b-default)] ring-inset',
        ring && 'ring-2 ring-[var(--b-acc)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden="true"
        className="f-display font-semibold tracking-[-0.01em] tabular-nums"
        style={{ fontSize: Math.max(11, Math.round(size * 0.4)) }}
      >
        {initials}
      </span>
      {url ? <AvatarImage url={url} firstName={firstName} size={size} /> : null}
    </span>
  );
}
