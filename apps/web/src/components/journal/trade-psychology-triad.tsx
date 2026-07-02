import { ExternalLink, LineChart } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { emotionLabel } from '@/lib/trading/emotions';

/**
 * S4 §33 (enrichissement #2) — le parcours d'un trade assemblé en un seul endroit,
 * avant → pendant → après, en RAPPROCHANT la capture, l'émotion et le débrief pour
 * que le membre (et l'admin qui supervise) relise le trade comme une histoire.
 *
 * Avant, ces trois dimensions vivaient dispersées dans la fiche : l'arc émotionnel
 * d'un côté, la capture d'entrée plus bas, la capture de sortie encore plus bas, le
 * débrief tout en bas. Ce composant les réunit : chaque moment porte son émotion ET
 * sa capture, et la lecture écrite (intention d'entrée + débrief de sortie) suit
 * juste en dessous, étiquetée.
 *
 * Posture §2 / §33.2 : purement DESCRIPTIF. On affiche l'état déclaré et les
 * captures du membre, jamais une lecture de marché, jamais un jugement, jamais de
 * rouge punitif (pills neutres `mute`). « Pendant » et « après » se renseignent à
 * la clôture → tant que le trade est ouvert, ils sont en attente, pas « manquants ».
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
  /** Capture avant entrée (clé résolue en URL signée par l'appelant). Legacy —
   * les nouveaux trades portent un lien TradingView (`entryChartUrl`). */
  entryPhotoUrl?: string | null;
  /** Capture après sortie (présente seulement à la clôture). Legacy. */
  exitPhotoUrl?: string | null;
  /** J1 — lien TradingView d'entrée (le champ primaire des nouveaux trades). */
  entryChartUrl?: string | null;
  /** J1 — lien TradingView de sortie (renseigné à la clôture). */
  exitChartUrl?: string | null;
  /** Note d'intention pré-entrée (côté « avant » du débrief scindé). */
  entryNote?: string | null;
  /** Débrief de sortie (côté « après » du débrief scindé). */
  debrief?: string | null;
  /** Paire — utilisée pour les `alt` accessibles des captures. */
  pair: string;
}

export function TradePsychologyTriad({
  before,
  during,
  after,
  isClosed,
  entryPhotoUrl = null,
  exitPhotoUrl = null,
  entryChartUrl = null,
  exitChartUrl = null,
  entryNote = null,
  debrief = null,
  pair,
}: TradePsychologyTriadProps) {
  const hasEmotions = before.length > 0 || during.length > 0 || after.length > 0;
  const hasWritten = entryNote !== null || debrief !== null;
  // Render the arc as soon as ANY dimension exists (émotion, lien TradingView,
  // capture legacy ou écrit) — parité avec les sections d'origine, chacune
  // masquée si vide.
  if (
    !hasEmotions &&
    !entryPhotoUrl &&
    !exitPhotoUrl &&
    !entryChartUrl &&
    !exitChartUrl &&
    !hasWritten
  ) {
    return null;
  }

  const phases = [
    {
      key: 'before',
      label: 'Avant',
      emotions: before,
      pending: 'Rien noté',
      photoUrl: entryPhotoUrl,
      photoAlt: `Capture avant entrée du trade ${pair}`,
      chartUrl: entryChartUrl,
      chartLabel: "Voir l'analyse d'entrée sur TradingView",
    },
    {
      key: 'during',
      label: 'Pendant',
      emotions: during,
      pending: isClosed ? 'Rien noté' : 'Se renseigne à la clôture',
      photoUrl: null,
      photoAlt: '',
      chartUrl: null,
      chartLabel: '',
    },
    {
      key: 'after',
      label: 'Après',
      emotions: after,
      pending: isClosed ? 'Rien noté' : 'Se renseigne à la clôture',
      photoUrl: exitPhotoUrl,
      photoAlt: `Capture après sortie du trade ${pair}`,
      chartUrl: exitChartUrl,
      chartLabel: "Voir l'analyse de sortie sur TradingView",
    },
  ] as const;

  return (
    <Card className="p-4">
      <h2 className="t-eyebrow mb-3">Le parcours de ce trade</h2>
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
            {phase.chartUrl ? (
              <a
                href={phase.chartUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={phase.chartLabel}
                className="rounded-card mt-0.5 inline-flex items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2 text-[12px] font-medium text-[var(--acc)] transition-colors hover:border-[var(--b-strong)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                <LineChart className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate">Analyse TradingView</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-[var(--t-4)]" aria-hidden />
              </a>
            ) : null}
            {phase.photoUrl ? (
              <a
                href={phase.photoUrl}
                target="_blank"
                rel="noreferrer"
                className="wow-hover-glow rounded-card mt-0.5 block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={phase.photoUrl}
                  alt={phase.photoAlt}
                  loading="lazy"
                  className="rounded-card aspect-[16/9] w-full border border-[var(--b-default)] object-cover"
                />
              </a>
            ) : null}
          </div>
        ))}
      </div>

      {/* Lecture écrite du parcours — l'intention d'entrée puis le débrief de
          sortie, étiquetés et séparés (avant, ils étaient fondus dans un seul
          bloc « Notes » en bas de fiche). §33.2 : neutre, jamais un jugement. */}
      {hasWritten ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-[var(--b-default)] pt-3">
          {entryNote !== null ? (
            <div className="flex flex-col gap-1">
              <span className="t-mono-cap text-[var(--t-4)]">Avant le trade</span>
              <p className="t-body leading-relaxed whitespace-pre-wrap text-[var(--t-2)]">
                {entryNote}
              </p>
            </div>
          ) : null}
          {debrief !== null ? (
            <div className="flex flex-col gap-1">
              <span className="t-mono-cap text-[var(--t-4)]">Débrief</span>
              <p className="t-body leading-relaxed whitespace-pre-wrap text-[var(--t-2)]">
                {debrief}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
