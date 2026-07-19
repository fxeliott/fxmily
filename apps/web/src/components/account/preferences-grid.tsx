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
 * Admin-only categories (`weekly_report_ready`, `training_reply_received`) are
 * hidden for members.
 *
 * Mark Douglas posture (no-FOMO, no-pressure):
 * - Labels are factual ("Corrections d'Eliott") not anxious ("Tu rates ce setup !").
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
    label: "Corrections d'Eliott sur tes trades",
    description:
      "Tu es notifié dès qu'une correction texte ou vidéo est ajoutée sur l'un de tes trades.",
  },
  {
    type: 'training_annotation_received',
    label: "Corrections d'Eliott sur tes backtests",
    description:
      "Tu es notifié dès qu'une correction est ajoutée sur l'un de tes backtests en mode entraînement.",
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
  {
    type: 'monthly_debrief_ready',
    label: 'Débrief mensuel prêt',
    description:
      'Notification début de mois quand ta synthèse du mois écoulé est disponible : progression, trading réel, entraînement.',
  },
  {
    type: 'mindset_check_ready',
    label: 'Auto-évaluation mindset hebdo',
    description:
      'Rappel hebdo (lundi matin) pour ton QCM de 2 minutes : mindset, discipline, patience. Calme et sans pression.',
  },
  {
    type: 'verification_gentle_reminder',
    label: 'Rappel bienveillant de suivi',
    description:
      'Un unique rappel calme quand un élément de ton suivi reste de côté, l’occasion de t’expliquer s’il y a une raison, avant toute relance. Jamais insistant.',
  },
  {
    type: 'verification_proof_analyzed',
    label: 'Analyse de tes captures MT5',
    description:
      'Notification quand l’analyse d’une capture d’historique MT5 est terminée : tu vois le résultat sans avoir à recharger ta page de vérification.',
  },
  {
    type: 'training_reply_received',
    label: 'Réponses des membres à tes corrections (admin)',
    description:
      'Notification quand un membre répond à l’une de tes corrections de backtest, pour boucler l’échange sans surveiller chaque entraînement.',
    adminOnly: true,
  },
  {
    type: 'weekly_review_reminder',
    label: 'Rappel de revue hebdomadaire',
    description: "Un rappel le dimanche matin si tu n'as pas encore fait ta revue de la semaine.",
  },
  {
    type: 'calendar_ready',
    label: 'Calendrier de la semaine',
    description: 'Une notification quand ton calendrier de la semaine est publié.',
  },
  {
    type: 'data_export_ready',
    label: 'Export de données prêt',
    description:
      'Une notification quand l’archive de tes données (RGPD, avec tes photos) que tu as demandée est prête à télécharger.',
  },
];

export function PreferencesGrid({ initialPreferences, isAdmin }: Props): React.ReactNode {
  const [preferences, setPreferences] = useState<Record<NotificationTypeSlug, boolean>>(() => {
    const seed: Record<NotificationTypeSlug, boolean> = {
      annotation_received: true,
      training_annotation_received: true,
      checkin_morning_reminder: true,
      checkin_evening_reminder: true,
      douglas_card_delivered: true,
      weekly_report_ready: true,
      monthly_debrief_ready: true,
      mindset_check_ready: true,
      verification_gentle_reminder: true,
      verification_proof_analyzed: true,
      training_reply_received: true,
      weekly_review_reminder: true,
      calendar_ready: true,
      data_export_ready: true,
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
          setErrorByType((e) => ({ ...e, [type]: 'Échec, réessaie.' }));
        }
      });
    });
  }

  const visibleCategories = CATEGORIES.filter((c) => isAdmin || !c.adminOnly);

  return (
    <ul className="rounded-card divide-y divide-[var(--b-subtle)] border border-[var(--b-default)] bg-[var(--bg-1)]">
      {visibleCategories.map((cat) => {
        const id = `pref-${cat.type}`;
        const enabled = preferences[cat.type];
        const error = errorByType[cat.type];
        return (
          <li key={cat.type} className="flex items-start gap-3 p-4">
            <div className="flex-1">
              <label htmlFor={id} className="block text-sm font-medium text-[var(--t-1)]">
                {cat.label}
              </label>
              <p id={`${id}-desc`} className="mt-1 text-sm text-[var(--t-2)]">
                {cat.description}
              </p>
              {error !== undefined && (
                <p
                  key={`${cat.type}-${error}`}
                  role="alert"
                  className="mt-1 text-sm text-[var(--bad)]"
                >
                  {error}
                </p>
              )}
            </div>
            {/*
             * Native checkbox styled as a switch. Single `<label htmlFor>`
             * association above (avoids WCAG 4.1.2 ambiguity of two labels
             * pointing at the same input). Touch target 44px (h-11) on the
             * <span> wrapper. Focus outline lives on the wrapper (full
             * 44×44 hit-area), not on the 24px-tall track — so the focus
             * outline isn't visually clipped to the track.
             */}
            <span className="relative inline-flex h-11 w-11 items-center justify-center has-[:focus-visible]:rounded-full has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--acc)]">
              <input
                id={id}
                type="checkbox"
                role="switch"
                aria-checked={enabled}
                aria-describedby={`${id}-desc`}
                checked={enabled}
                onChange={(e) => handleToggle(cat.type, e.target.checked)}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              {/* S19.2 — WCAG 1.4.11 (non-text contrast ≥3:1): the OFF track was
                  --bg-2 on a --bg-1 card (~1.1:1, invisible). A solid neutral
                  border (theme-stable, ~4:1 both modes) gives the control a
                  perceivable boundary; --bg-3 fill lifts it off the card. State
                  stays dual-cued (track colour + thumb position, 1.4.1). */}
              <span
                aria-hidden="true"
                className={`relative h-6 w-11 rounded-full border transition ${
                  enabled
                    ? 'border-transparent bg-[var(--acc)]'
                    : 'border-[var(--n-400)] bg-[var(--bg-3)]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--bg)] shadow transition ${
                    enabled ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
