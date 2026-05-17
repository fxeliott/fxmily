import 'server-only';

import { db } from '@/lib/db';
import { NOTIFICATION_TYPES, type NotificationTypeSlug } from '@/lib/schemas/push-subscription';

/**
 * Per-category notification preferences (J9).
 *
 * Default policy: **opt-in by default**. A missing row in `notification_preferences`
 * means the member has consented (the browser permission prompt was the legal
 * consent gesture — RGPD posture). The dispatcher reads `getEffectivePreferences`
 * which materializes the full set including default-true rows.
 *
 * To opt OUT: the member toggles a category in `/account/notifications` →
 * `togglePreferenceAction` upserts a row with `enabled = false`.
 *
 * To re-enable: the member toggles back → `enabled = true`. We never delete
 * the row (auditable history of the user's choices).
 */

export type EffectivePreferences = Record<NotificationTypeSlug, boolean>;

/**
 * Returns the effective preferences map for a member: all 5 NotificationType
 * slugs with their enabled/disabled state. Missing rows default to `true`.
 */
export async function getEffectivePreferences(userId: string): Promise<EffectivePreferences> {
  const rows = await db.notificationPreference.findMany({
    where: { userId },
    select: { type: true, enabled: true },
  });

  const map: EffectivePreferences = {
    annotation_received: true,
    training_annotation_received: true,
    checkin_morning_reminder: true,
    checkin_evening_reminder: true,
    douglas_card_delivered: true,
    weekly_report_ready: true,
  };

  for (const row of rows) {
    // The Prisma enum maps 1:1 to our string union, but we type-cast for safety.
    const slug = row.type as NotificationTypeSlug;
    if (NOTIFICATION_TYPES.includes(slug)) {
      map[slug] = row.enabled;
    }
  }

  return map;
}

/**
 * Upsert a preference row. Used by the Server Action `togglePreferenceAction`.
 * Idempotent — toggling twice ends up at the original state. Cascades on
 * User delete (RGPD).
 */
export async function setPreference(
  userId: string,
  type: NotificationTypeSlug,
  enabled: boolean,
): Promise<void> {
  await db.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, enabled },
    update: { enabled },
  });
}

/**
 * Convenience: returns true iff the member has opted into the given category.
 * Missing row → true (consent default-on).
 */
export async function isPreferenceEnabled(
  userId: string,
  type: NotificationTypeSlug,
): Promise<boolean> {
  const row = await db.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
    select: { enabled: true },
  });
  return row === null ? true : row.enabled;
}
