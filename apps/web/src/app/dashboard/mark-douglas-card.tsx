'use client';

import { Brain, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

/**
 * FiveTruthsGlyph — petit schéma conceptuel d'appoint à côté de l'eyebrow.
 *
 * Les 5 Fundamental Truths comme 5 nœuds reliés en constellation (un « edge »
 * abstrait : un réseau de probabilités, pas une ligne droite déterministe).
 * Le nœud actif s'illumine en suivant la vérité affichée (`activeIdx`), les
 * autres respirent faiblement — renforce le concept sans voler l'attention au
 * texte. `aria-hidden` : purement décoratif d'appoint, le texte porte le sens.
 *
 * Compositor-only (opacity/transform). Sous `prefers-reduced-motion` le filet
 * global fige tout ; double-garde locale → état figé lisible (nœud actif net,
 * pas de pulsation). `forced-colors` : les glows tombent, les traits restent.
 */
function FiveTruthsGlyph({ activeIdx }: { activeIdx: number }) {
  // 5 nodes on a circle, 0deg = top, clockwise (a calm pentagon "edge graph").
  const r = 9.5;
  const c = 13;
  const nodes = Array.from({ length: 5 }, (_, i) => {
    const a = ((i * 72 - 90) * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  });

  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="md-glyph shrink-0"
    >
      {/* Faint links between every pair — the "web of probabilities". */}
      <g stroke="var(--b-acc)" strokeWidth="0.6" opacity="0.55">
        {nodes.map((p, i) =>
          nodes
            .slice(i + 1)
            .map((q, j) => <line key={`l-${i}-${j}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />),
        )}
      </g>
      {/* Breathing core. */}
      <circle className="md-glyph-core" cx={c} cy={c} r="2" fill="var(--acc)" opacity="0.5" />
      {/* The 5 truth nodes. The active one is fully lit; others dimmed. */}
      {nodes.map((p, i) => {
        const active = i === ((activeIdx % 5) + 5) % 5;
        return (
          <circle
            key={`n-${i}`}
            cx={p.x}
            cy={p.y}
            r={active ? 2.4 : 1.6}
            fill={active ? 'var(--acc-hi)' : 'var(--acc)'}
            opacity={active ? 1 : 0.45}
            className={active ? 'md-glyph-active' : undefined}
            style={{ transition: 'r 600ms var(--e-smooth), opacity 600ms var(--e-smooth)' }}
          />
        );
      })}
      <style>{`
        .md-glyph-core {
          transform-box: fill-box;
          transform-origin: center;
          will-change: opacity, transform;
          animation: mdGlyphBreathe 4.8s var(--e-smooth) infinite;
        }
        .md-glyph-active { will-change: opacity; animation: mdGlyphActive 8s var(--e-smooth) infinite; }
        @keyframes mdGlyphBreathe {
          0%, 100% { opacity: 0.4; transform: scale(0.92); }
          50% { opacity: 0.7; transform: scale(1.06); }
        }
        @keyframes mdGlyphActive {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .md-glyph-core { animation: none; opacity: 0.5; }
          .md-glyph-active { animation: none; opacity: 1; }
        }
      `}</style>
    </svg>
  );
}

/**
 * Mark Douglas card — pédagogie embeddable dashboard.
 *
 * Affiche une rotation des 5 Fundamental Truths de *Trading in the Zone*
 * (Mark Douglas, Penguin/NYIF 2000, Chapter 11 "Thinking Like a Trader").
 * Les `short` sont les **citations canoniques** en VO (≤30 mots, fair-use),
 * les `full` sont des paraphrases francisées dans la voix Eliott.
 *
 * Audit J5 fix (TIER 4 follow-up): les truths #2, #3, #4 étaient tronquées
 * ou réécrites — restaurées au texte original. Le `<cite>` reflète maintenant
 * "citations + paraphrases" plutôt que "paraphrasé" (qui ambiguïsait le
 * statut sémantique du `short` vs `full`).
 *
 * Rotation client-side toutes les 8s, PAUSÉE pour les utilisateurs
 * reduced-motion (`useReducedMotion` — ils gardent les dots manuels) ; chaque
 * changement de vérité fait un fondu d'entrée (`.wow-rise`, neutralisé sous
 * reduced-motion par le filet global).
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
    full: 'Pour un edge donné, l’ordre exact des wins et losses est aléatoire. Une série de pertes ne casse pas l’edge, elle teste ta discipline.',
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
    full: 'Aucun setup ne se répète exactement. Ce qui a marché hier n’est qu’un guide probabiliste, pas une recette.',
  },
] as const;

export function MarkDouglasCard() {
  const [idx, setIdx] = useState(0);
  const prefersReduced = useReducedMotion();

  // Auto-rotate every 8s, but PAUSE for reduced-motion users — the old JSDoc
  // claimed a CSS gate that never existed; the interval fired regardless. AT
  // users keep the manual progress dots below to step through the 5 truths.
  useEffect(() => {
    if (prefersReduced) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % TRUTHS.length);
    }, 8000);
    return () => clearInterval(id);
  }, [prefersReduced]);

  const truth = TRUTHS[idx]!;

  return (
    <Card primary glass className="overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-3.5 w-3.5 text-[var(--acc)]" strokeWidth={1.75} />
          <span className="t-eyebrow">Mark Douglas · 5 truths</span>
          <FiveTruthsGlyph activeIdx={idx} />
        </div>
        <Pill tone="cy">
          {truth.n} / {TRUTHS.length}
        </Pill>
      </div>

      <blockquote key={idx} className="wow-rise flex flex-col gap-2">
        <p
          className="f-display text-[20px] leading-[1.25] font-semibold tracking-[-0.015em] text-[var(--t-1)]"
          style={{ fontFeatureSettings: '"ss01" 1' }}
        >
          {truth.short}
        </p>
        <p className="t-body text-[var(--t-3)]">{truth.full}</p>
      </blockquote>

      <footer className="mt-4 flex items-center justify-between border-t border-[var(--b-subtle)] pt-3">
        <cite className="t-foot text-[var(--t-3)] not-italic">
          Trading in the Zone · Mark Douglas (2000), citations + paraphrases
        </cite>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 rounded-[var(--r-control)] text-[11px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          Bibliothèque
          <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
        </Link>
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
