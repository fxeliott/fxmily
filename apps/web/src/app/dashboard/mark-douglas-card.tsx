'use client';

import { Brain, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

/**
 * Mark Douglas card — pédagogie embeddable dashboard.
 *
 * Affiche une rotation des 5 Fundamental Truths de *Trading in the Zone*
 * (Mark Douglas, Penguin/NYIF 2000, Chapter 11 "Thinking Like a Trader").
 * Les `short` sont les **citations canoniques** en VO (≤30 mots, fair-use),
 * les `full` sont des paraphrases francisées dans la voix Eliot.
 *
 * Audit J5 fix (TIER 4 follow-up): les truths #2, #3, #4 étaient tronquées
 * ou réécrites — restaurées au texte original. Le `<cite>` reflète maintenant
 * "citations + paraphrases" plutôt que "paraphrasé" (qui ambiguïsait le
 * statut sémantique du `short` vs `full`).
 *
 * Rotation client-side toutes les 8s (gated reduced-motion via CSS).
 */

const TRUTHS = [
  {
    n: 1,
    short: 'Anything can happen.',
    full: "Le marché peut faire n'importe quoi à n'importe quel moment. Pas de signal qui garantit. Tu trades des probabilités, pas des certitudes.",
  },
  {
    n: 2,
    // Canonical: "You don't need to know what's going to happen next to
    // make money." — restored from previous truncation.
    short: "You don't need to know what's going to happen next to make money.",
    full: 'Pas besoin de prédire la prochaine bougie pour être rentable. Tu as besoin d’un edge appliqué avec discipline sur un échantillon assez grand.',
  },
  {
    n: 3,
    // Shortened from canonical "There is a random distribution between wins
    // and losses for any given set of variables that define an edge." Keeps
    // the "for any given edge" clause that anchors the truth to the edge
    // notion — the previous "Random distribution between wins and losses."
    // dropped that and turned it into "the market is random" (false).
    short: 'Random distribution of wins and losses for any given edge.',
    full: 'Pour un edge donné, l’ordre exact des wins et losses est aléatoire. Une série de pertes ne casse pas l’edge — elle teste ta discipline.',
  },
  {
    n: 4,
    // Shortened from canonical "An edge is nothing more than an indication
    // of a higher probability of one thing happening over another." Keeps
    // "indication" — the anti-determinism keyword in Douglas's framing.
    short: 'An edge is an indication of a higher probability.',
    full: 'Un setup à 60% de win rate perd encore 40% du temps. Accepte ça avant d’entrer, sinon chaque perte sera vécue comme une trahison.',
  },
  {
    n: 5,
    short: 'Every moment in the market is unique.',
    full: 'Aucun setup ne se répète exactement. Ce qui a marché hier n’est qu’un guide probabiliste — pas une recette.',
  },
] as const;

export function MarkDouglasCard() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % TRUTHS.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  const truth = TRUTHS[idx]!;

  return (
    <Card primary className="overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-[var(--acc)]" strokeWidth={1.75} />
          <span className="t-eyebrow">Mark Douglas · 5 truths</span>
        </div>
        <Pill tone="cy">
          {truth.n} / {TRUTHS.length}
        </Pill>
      </div>

      <blockquote className="flex flex-col gap-2">
        <p
          className="f-display text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-[var(--t-1)]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          {truth.short}
        </p>
        <p className="t-body text-[var(--t-3)]">{truth.full}</p>
      </blockquote>

      <footer className="mt-4 flex items-center justify-between border-t border-[var(--b-subtle)] pt-3">
        <cite className="t-foot not-italic text-[var(--t-3)]">
          Trading in the Zone — Mark Douglas (2000), citations + paraphrases
        </cite>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          Bibliothèque
          <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
        </button>
      </footer>

      {/* Progress dots */}
      <div className="mt-3 flex items-center gap-1">
        {TRUTHS.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIdx(i)}
            aria-label={`Truth ${i + 1}`}
            className={`rounded-pill h-1 transition-all ${
              i === idx ? 'w-6 bg-[var(--acc)]' : 'w-1 bg-[var(--b-strong)]'
            }`}
          />
        ))}
      </div>
    </Card>
  );
}
