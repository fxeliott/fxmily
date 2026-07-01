import { Compass } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import type { AlertView } from '@/lib/verification/alerts';

/**
 * S4 §33/§34 — surface membre des alertes de dérive (lecture seule).
 *
 * Une alerte se déclenche quand un même type d'écart se répète au-delà de son
 * seuil ; elle prépare une fiche Mark Douglas pour travailler le point.
 *
 * Posture §33.2 (anti Black-Hat, BLOQUANT) :
 *   - JAMAIS de rouge punitif (aucun `tone="bad"`, aucun `text-[var(--bad)]`) ;
 *   - le vocabulaire reste celui du miroir : « préparée pour t'aider », jamais
 *     « violation » ou « sanction » ;
 *   - une alerte est un signal psychologique à travailler, pas un crime.
 */

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Paris',
});

/** Status → libellé calme + ton (jamais rouge, §33.2). */
const STATUS_META: Record<AlertView['status'], { label: string; tone: 'cy' | 'mute' }> = {
  delivered: { label: 'Fiche envoyée', tone: 'cy' },
  open: { label: 'En préparation', tone: 'mute' },
  dismissed: { label: 'Classé', tone: 'mute' },
};

export function DriftAlertsCard({ alerts }: { alerts: readonly AlertView[] }) {
  if (alerts.length === 0) {
    return (
      <p className="t-body max-w-prose text-[var(--t-3)]">
        Aucune alerte de dérive sur les 30 derniers jours. Tes écarts ne se répètent pas, c&apos;est
        exactement ce qu&apos;on veut voir. Continue comme ça.
      </p>
    );
  }

  return (
    <>
      <p className="t-body max-w-prose leading-[1.6] text-[var(--t-2)]">
        Quand un même type d&apos;écart se répète, une fiche Mark Douglas t&apos;est préparée pour
        travailler ce point, calmement, jamais pour te juger. Voici ce qui a été relevé récemment.
      </p>
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {alerts.map((alert) => {
          const status = STATUS_META[alert.status];
          return (
            <li key={alert.id}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--t-1)]">
                    <Compass
                      className="h-3.5 w-3.5 text-[var(--t-3)]"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {alert.label}
                  </span>
                  <Pill tone={status.tone}>{status.label}</Pill>
                </div>
                <span className="t-cap text-[var(--t-4)]">
                  {DATE_FMT.format(alert.createdAt)} · répété {alert.repeatCount} fois
                </span>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
