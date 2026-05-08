'use client';

import { useState, useTransition } from 'react';

import { togglePreferenceAction } from '@/app/account/notifications/actions';
import { NOTIFICATION_TYPES, type NotificationTypeSlug } from '@/lib/schemas/push-subscription';

/**
 * `<PreferencesGrid>` — per-category opt-out toggles for J9 (`/account/notifications`).
 *
 * One toggle per `NotificationType`. Default state for each is `enabled=true`
 * (consent default-on, opt-out by toggle). Members can disable any category;
 * the dispatcher checks `getEffectivePreferences(userId)` before sending.
 *
 * Admin-only category (`weekly_report_ready`) is hidden for members.
 *
 * Mark Douglas posture (no-FOMO, no-pressure):
 * - Labels are factual ("Corrections d'Eliot") not anxious ("Tu rates ce setup !").
 * - Descriptions explain WHEN the push fires + the value, no urgency stick.
 * - No counter / "X messages non lus" badge — those go on `/dashboard` already.
 *
 * Optimistic UI: toggle flips immediately, server action runs in transition.
 * If the server returns ok=false, we revert the local state and show a soft
 * error inline. No toast / popup (mobile-friendly: stays in flow).
 */

type Props = {
  initialPreferences: Partial<Record<NotificationTypeSlug, boolean>>;
  /** Hide admin-only categories (weekly_report_ready) for members. */
  isAdmin: boolean;
};

type CategoryMeta = {
  type: NotificationTypeSlug;
  label: string;
  description: string;
  /** Hide for members. */
  adminOnly?: boolean;
};

const CATEGORIES: CategoryMeta[] = [
  {
    type: 'annotation_received',
    label: "Corrections d'Eliot sur tes trades",
    description:
      "Tu es notifié dès qu'une correction texte ou vidéo est ajoutée sur l'un de tes trades.",
  },
  {
    type: 'checkin_morning_reminder',
    label: 'Rappel check-in du matin',
    description:
      'Notification autour de 7h30 (heure locale) si le check-in matin n’a pas été fait.',
  },
  {
    type: 'checkin_evening_reminder',
    label: 'Rappel check-in du soir',
    description: 'Notification autour de 20h30 si le check-in soir n’a pas été fait.',
  },
  {
    type: 'douglas_card_delivered',
    label: 'Fiches Mark Douglas pertinentes',
    description:
      'Quand une fiche est déclenchée par ton activité (3 pertes consécutives, plan dévié, etc.).',
  },
  {
    type: 'weekly_report_ready',
    label: 'Rapport hebdo IA prêt (admin)',
    description:
      'Notification quand le digest hebdomadaire des membres est généré (dimanche soir).',
    adminOnly: true,
  },
];

export function PreferencesGrid({ initialPreferences, isAdmin }: Props): React.ReactNode {
  const [preferences, setPreferences] = useState<Record<NotificationTypeSlug, boolean>>(() => {
    const seed: Record<NotificationTypeSlug, boolean> = {
      annotation_received: true,
      checkin_morning_reminder: true,
      checkin_evening_reminder: true,
      douglas_card_delivered: true,
      weekly_report_ready: true,
    };
    for (const type of NOTIFICATION_TYPES) {
      if (initialPreferences[type] !== undefined) {
        seed[type] = initialPreferences[type];
      }
    }
    return seed;
  });
  const [errorByType, setErrorByType] = useState<Partial<Record<NotificationTypeSlug, string>>>({});
  const [, startTransition] = useTransition();

  function handleToggle(type: NotificationTypeSlug, enabled: boolean): void {
    // Optimistic flip.
    const previous = preferences[type];
    setPreferences((p) => ({ ...p, [type]: enabled }));
    setErrorByType((e) => {
      const next = { ...e };
      delete next[type];
      return next;
    });

    startTransition(() => {
      void togglePreferenceAction({ type, enabled }).then((result) => {
        if (!result.ok) {
          // Revert and surface a soft error.
          setPreferences((p) => ({ ...p, [type]: previous }));
          setErrorByType((e) => ({ ...e, [type]: 'Échec — réessaie.' }));
        }
      });
    });
  }

  const visibleCategories = CATEGORIES.filter((c) => isAdmin || !c.adminOnly);

  return (
    <ul className="divide-border border-border bg-card divide-y rounded-lg border">
      {visibleCategories.map((cat) => {
        const id = `pref-${cat.type}`;
        const enabled = preferences[cat.type];
        const error = errorByType[cat.type];
        return (
          <li key={cat.type} className="flex items-start gap-3 p-4">
            <div className="flex-1">
              <label htmlFor={id} className="text-foreground block text-sm font-medium">
                {cat.label}
              </label>
              <p className="text-muted-foreground mt-1 text-sm">{cat.description}</p>
              {error !== undefined && (
                <p role="alert" className="text-danger mt-1 text-sm">
                  {error}
                </p>
              )}
            </div>
            {/*
             * Native checkbox styled as a switch. Touch target 44px (h-11) to
             * match J5 / J7 patterns. role="switch" announces state correctly
             * to screen readers (NVDA / VoiceOver / TalkBack).
             */}
            <label
              htmlFor={id}
              className="relative inline-flex h-11 w-11 cursor-pointer items-center justify-center"
            >
              <input
                id={id}
                type="checkbox"
                role="switch"
                aria-checked={enabled}
                checked={enabled}
                onChange={(e) => handleToggle(cat.type, e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={`relative h-6 w-11 rounded-full transition ${
                  enabled ? 'bg-primary' : 'bg-muted/50'
                } peer-focus-visible:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2`}
              >
                <span
                  className={`bg-background absolute top-0.5 h-5 w-5 rounded-full shadow transition ${
                    enabled ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
