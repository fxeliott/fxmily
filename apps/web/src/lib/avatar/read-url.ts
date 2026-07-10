import 'server-only';

import { cache } from 'react';

import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';

/**
 * Shared avatar read-URL + initials helpers — single source of truth for
 * "stored `avatarKey` → servable read URL" and "firstName/lastName → initials
 * disc fallback".
 *
 * These two helpers were copy-pasted verbatim across three server surfaces
 * (`lib/leaderboard/service.ts`, `app/account/photo/page.tsx`, and — new — the
 * nav-shell user chip). Copies drift; one helper cannot. Consolidated here so
 * the leaderboard row, the settings page and the sidebar face all resolve a
 * photo the exact same way.
 *
 * Server-only: `avatarUrlOf` resolves the URL through `selectStorage()` (itself
 * `server-only`). Client components (e.g. the shell `UserFooter`) receive the
 * already-resolved `url` string as a prop — they never import this module.
 */

/** First + last initial, uppercased. Falls back to '?' when both are empty. */
export function initialsOf(firstName: string | null, lastName: string | null): string {
  const a = firstName?.trim().charAt(0) ?? '';
  const b = lastName?.trim().charAt(0) ?? '';
  const s = `${a}${b}`.toUpperCase();
  return s.length > 0 ? s : '?';
}

/**
 * Servable read URL for a member's photo, or null → initials fallback.
 *
 * A malformed / unresolvable key never throws to the caller (a face must never
 * 500 the board, the settings page or the whole app shell): it falls through to
 * the legacy `image` field, then to null (→ the `<Avatar>` initials disc).
 */
export function avatarUrlOf(avatarKey: string | null, image: string | null): string | null {
  if (avatarKey) {
    try {
      return selectStorage().getReadUrl(avatarKey);
    } catch {
      // Malformed key never breaks the caller — fall through to initials.
    }
  }
  return image ?? null;
}

export interface SessionAvatar {
  /** Resolved read URL, or null when no photo is set. */
  url: string | null;
  /** Initials fallback (first + last initial). */
  initials: string;
  /** First name, used only for the image alt text. */
  firstName: string;
}

/**
 * Uncached core of {@link getSessionAvatar} — exported for unit tests only.
 * Application code MUST use the `cache()`-wrapped `getSessionAvatar` so repeat
 * calls in one request share the single PK lookup.
 */
export async function loadSessionAvatar(userId: string): Promise<SessionAvatar | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, avatarKey: true, image: true },
  });
  if (!user) return null;
  return {
    url: avatarUrlOf(user.avatarKey, user.image),
    initials: initialsOf(user.firstName, user.lastName),
    firstName: user.firstName?.trim() || 'Membre',
  };
}

/**
 * Identity + avatar for the nav-shell user chip (sidebar desktop + drawer
 * mobile), resolvable for ANY authenticated user — member OR admin. Unlike the
 * leaderboard's `getMyLeaderboardRank` (member-only, and null until the first
 * board snapshot exists), this is a plain user-row lookup, so the member's own
 * face shows in the chrome immediately and admins get their photo too.
 *
 * `React.cache()`-wrapped: the root layout calls it once per request; wrapping
 * keeps it a single query even if another server surface reads it in the same
 * render. Returns null only when the user row is gone (deleted mid-session).
 */
export const getSessionAvatar = cache(loadSessionAvatar);
