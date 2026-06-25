import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { emotionLabel } from '@/lib/trading/emotions';

/**
 * S4 §33 (enrichissement #2) — l'arc émotionnel d'un trade assemblé en un seul
 * endroit : avant → pendant → après. Les trois moments existaient déjà mais
 * dispersés dans la fiche (avant le détail, pendant/après après la sortie) ; le
 * membre (et l'admin qui supervise) ne lisait jamais le parcours d'un coup
 * d'œil — alors que c'est LE cœur de la méthode (Mark Douglas, master prompt §22).
 *
 * Posture §2 / §33.2 : purement DESCRIPTIF. On affiche l'état déclaré, jamais une
 * lecture de marché, jamais un jugement, jamais de rouge punitif (pills neutres
 * `mute`, comme les trois cartes d'origine). « Pendant » et « après » se
 * renseignent à la clôture → tant que le trade est ouvert, ils sont en attente,
 * pas « manquants ».
 *
 * Composant PARTAGÉ (membre + admin) via `TradeDetailView` : aucune branche
 * conditionnelle sur le rôle, le rendu est identique pour les deux.
 */

interface TradePsychologyTriadProps {
  before: readonly string[];
  during: readonly string[];
  after: readonly string[];
  /** Open trades only capture « avant » ; during/after come at close. */
  isClosed: boolean;
}

export function TradePsychologyTriad({
  before,
  during,
  after,
  isClosed,
}: TradePsychologyTriadProps) {
  // Hide entirely when nothing was logged across the arc (parité avec les trois
  // cartes d'origine, qui se masquaient chacune si vide).
  if (before.length === 0 && during.length === 0 && after.length === 0) {
    return null;
  }

  const phases = [
    { key: 'before', label: 'Avant', emotions: before, pending: 'Rien noté' },
    {
      key: 'during',
      label: 'Pendant',
      emotions: during,
      pending: isClosed ? 'Rien noté' : 'Se renseigne à la clôture',
    },
    {
      key: 'after',
      label: 'Après',
      emotions: after,
      pending: isClosed ? 'Rien noté' : 'Se renseigne à la clôture',
    },
  ] as const;

  return (
    <Card className="p-4">
      <h2 className="t-eyebrow mb-3">Parcours émotionnel</h2>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {phases.map((phase) => (
          <div
            key={phase.key}
            className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
          >
            <span className="t-mono-cap text-[var(--t-4)]">{phase.label}</span>
            {phase.emotions.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {phase.emotions.map((slug) => (
                  <li key={slug}>
                    <Pill tone="mute">{emotionLabel(slug)}</Pill>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="t-cap text-[var(--t-4)]">{phase.pending}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
