'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useEffect, useRef } from 'react';

import { BrandMark, FX_PATH } from '@/components/brand/brand-mark';
import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

/**
 * Splash / accueil public — `/` (V4 refonte « welcome-only »).
 *
 * Porte d'entrée ÉPURÉE, UN seul écran (100dvh) : emblème de marque orbital
 * animé + « Bienvenue sur la Fxmily » + EXACTEMENT deux actions (se connecter
 * / demander un accès) + ligne de confiance discrète. Aucun récit marketing
 * sous le pli — directive : l'accueil ne doit PAS ressembler à une app interne.
 *
 * Invariants frontend-elite : compositor-only (transform/opacity), aurora
 * deep-space scopée, entrée `.wow-rise` + emblème `.splash-float`.
 * prefers-reduced-motion et forced-colors gérés dans globals.css
 * (`.splash-*`, `.wow-*`, `.fx-*`). Route publique.
 */
export function SplashHero() {
  const parallaxRef = useRef<HTMLDivElement>(null);

  // Pointer-parallax discret sur l'emblème : rAF-throttlé, et désactivé sous
  // prefers-reduced-motion OU pointeur grossier (tactile) — l'emblème garde
  // alors son flottement CSS seul. Compositor-only (translate3d via --px/--py).
  useEffect(() => {
    const el = parallaxRef.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (reduce.matches || !fine.matches) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;
        const dy = (e.clientY / window.innerHeight - 0.5) * 2;
        const max = 10;
        el.style.setProperty('--px', `${(dx * max).toFixed(2)}px`);
        el.style.setProperty('--py', `${(dy * max).toFixed(2)}px`);
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main className="relative flex min-h-dvh flex-col overflow-x-hidden bg-[var(--bg)]">
      {/* ═══════════════ HERO (premier écran, ambiance deep-space scopée) ═══════════════ */}
      <section className="splash-aurora-rich relative flex min-h-[100svh] flex-col overflow-hidden">
        {/* Ambient backplate : champ d'étoiles + rayons coniques + orbes lents + grain
            (couches décoratives, z auto < contenu z-10). */}
        <StarField />
        <div aria-hidden className="splash-sweep" />
        <div
          aria-hidden
          className="splash-orb login-orb-a absolute -top-40 -left-32 h-[520px] w-[520px] sm:h-[620px] sm:w-[620px]"
          style={{
            opacity: 0.62,
            background: 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.3) 0%, transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="splash-orb splash-orb-extra login-orb-b absolute -right-44 -bottom-44 h-[640px] w-[640px]"
          style={{
            opacity: 0.55,
            background: 'radial-gradient(circle, oklch(0.5 0.21 262 / 0.26) 0%, transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="splash-orb splash-orb-extra absolute top-1/3 left-1/2 h-[460px] w-[460px] -translate-x-1/2"
          style={{
            opacity: 0.34,
            background: 'radial-gradient(circle, oklch(0.7 0.13 217 / 0.2) 0%, transparent 70%)',
          }}
        />
        <SplashGrain />

        {/* ── Marque (minimal, top-left) ── */}
        <header className="relative z-10 flex items-center justify-between px-5 pt-7 sm:px-10">
          <div className="flex items-center gap-2.5">
            <span className="rounded-control grid h-[26px] w-[26px] place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <BrandMark className="w-[16px]" />
            </span>
            <span className="f-display text-[15px] font-semibold tracking-[-0.01em] text-[var(--t-1)]">
              Fxmily
            </span>
          </div>
          <span className="t-eyebrow hidden sm:inline" style={{ color: 'var(--t-2)' }}>
            Cohorte privée
          </span>
        </header>

        {/* ── Bienvenue centrée ── */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8 px-5 py-10 text-center">
          {/* Élément signature : emblème de marque orbital animé */}
          <div ref={parallaxRef} className="splash-parallax">
            <div className="splash-float">
              <BrandEmblem />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <h1
              className="f-display font-bold tracking-[-0.04em] text-[var(--t-1)]"
              style={{
                fontFeatureSettings: '"ss01" 1',
                fontSize: 'clamp(2.1rem, 1.5rem + 3vw, 3.75rem)',
                lineHeight: 1.02,
              }}
            >
              <span className="word-rise inline-block" style={{ animationDelay: '90ms' }}>
                Bienvenue
              </span>{' '}
              <span className="word-rise inline-block" style={{ animationDelay: '180ms' }}>
                sur
              </span>{' '}
              <span className="word-rise inline-block" style={{ animationDelay: '260ms' }}>
                la
              </span>{' '}
              <span
                className="word-rise inline-block text-[var(--acc-hi)]"
                style={{
                  animationDelay: '380ms',
                  textShadow: '0 0 32px oklch(0.62 0.19 254 / 0.45)',
                }}
              >
                Fxmily
              </span>
            </h1>

            <p
              className="wow-rise t-lead max-w-[42ch] text-balance"
              style={{ '--rise-delay': '560ms' } as CSSProperties}
            >
              Le journal qui ignore le marché. On mesure ton plan, ta discipline et ton mental — pas
              les bougies.
            </p>
          </div>

          {/* EXACTEMENT deux actions (role=group plutôt que <nav> : 2 liens d'action
              ne constituent pas un landmark de navigation — a11y review) */}
          <div
            role="group"
            aria-label="Accès à l'application"
            className="wow-rise flex w-full max-w-sm flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center"
            style={{ '--rise-delay': '680ms' } as CSSProperties}
          >
            <Link
              href="/login"
              className={cn(btnVariants({ kind: 'primary', size: 'l' }), 'wow-hover-glow group')}
            >
              Se connecter
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                strokeWidth={2}
                aria-hidden="true"
              />
            </Link>
            <Link
              href="/rejoindre"
              className={cn(btnVariants({ kind: 'secondary', size: 'l' }), 'wow-hover-glow')}
            >
              Demander un accès
            </Link>
          </div>

          {/* Une ligne de confiance discrète (pas un strip dense) */}
          <p
            className="wow-rise t-cap flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
            style={{ '--rise-delay': '820ms', color: 'var(--t-2)' } as CSSProperties}
          >
            <span>Accès sur invitation</span>
            <span aria-hidden className="text-[var(--t-4)]/60">
              ·
            </span>
            <span>Données chiffrées</span>
            <span aria-hidden className="text-[var(--t-4)]/60">
              ·
            </span>
            <span>Aucun conseil de marché</span>
          </p>
        </div>

        {/* ── Footer minimal, intégré au bas de l'écran d'accueil (la landing est
            désormais UN seul écran : bienvenue + 2 actions, pas de récit marketing
            sous le pli — directive « accueil épuré, pas une app interne »). Les
            liens légaux RGPD restent accessibles ici (le LegalFooter global se
            retire sur `/` pour ne pas créer un 2e écran résiduel). ── */}
        <footer className="relative z-10 flex flex-col items-center justify-center gap-2 px-5 pb-7 text-[10px] tabular-nums sm:flex-row sm:gap-3">
          <span className="t-foot" style={{ color: 'var(--t-2)' }}>
            © 2026 Fxmily — Discipline avant le marché.
          </span>
          <span aria-hidden className="hidden text-[var(--t-4)] sm:inline">
            ·
          </span>
          <nav aria-label="Liens légaux" className="flex items-center gap-x-1">
            <Link
              href="/legal/privacy"
              className="inline-flex min-h-6 items-center rounded px-1.5 py-1 transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              style={{ color: 'var(--t-2)' }}
            >
              Confidentialité
            </Link>
            <span aria-hidden className="text-[var(--t-4)]">
              ·
            </span>
            <Link
              href="/legal/terms"
              className="inline-flex min-h-6 items-center rounded px-1.5 py-1 transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              style={{ color: 'var(--t-2)' }}
            >
              CGU
            </Link>
            <span aria-hidden className="text-[var(--t-4)]">
              ·
            </span>
            <Link
              href="/legal/mentions"
              className="inline-flex min-h-6 items-center rounded px-1.5 py-1 transition-colors hover:text-[var(--t-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
              style={{ color: 'var(--t-2)' }}
            >
              Mentions légales
            </Link>
          </nav>
        </footer>
      </section>
    </main>
  );
}

/**
 * Grain léger (SVG feTurbulence) posé sur l'aurora — casse le « dégradé propre »
 * (anti-AI-slop). Statique, décoratif, mix-blend pour fondre dans le fond.
 */
function SplashGrain() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.04] mix-blend-overlay"
      preserveAspectRatio="none"
    >
      <filter id="splashNoise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.82"
          numOctaves={2}
          stitchTiles="stitch"
        />
      </filter>
      <rect width="100%" height="100%" filter="url(#splashNoise)" />
    </svg>
  );
}

/**
 * Champ d'étoiles déterministe (zéro Math.random → stable SSR/CSR, aucun
 * mismatch d'hydratation). Positions en %, rayon en px. Une partie scintille
 * (opacité only, .splash-twinkle) ; le reste est statique. Purement décoratif
 * (aria-hidden + pointer-events via .splash-stars). Biais bords/haut/bas pour
 * laisser le centre (emblème + titre) respirer.
 */
function StarField() {
  type Star = {
    x: number;
    y: number;
    r: number;
    o: number;
    tw?: boolean;
    dur?: number;
    delay?: number;
    cyan?: boolean;
  };
  const CY = 'var(--cy)';
  const WHITE = 'var(--t-1)';
  const stars: readonly Star[] = [
    { x: 6, y: 12, r: 1.2, o: 0.5, tw: true, dur: 4.4, delay: 0.1 },
    { x: 14, y: 22, r: 0.9, o: 0.35 },
    { x: 24, y: 8, r: 1.0, o: 0.45, tw: true, dur: 5.2, delay: 0.6 },
    { x: 33, y: 18, r: 0.8, o: 0.3 },
    { x: 46, y: 7, r: 1.1, o: 0.5, tw: true, dur: 3.8, delay: 1.1, cyan: true },
    { x: 58, y: 14, r: 0.9, o: 0.4 },
    { x: 68, y: 6, r: 1.0, o: 0.45, tw: true, dur: 4.9, delay: 0.3 },
    { x: 78, y: 16, r: 1.2, o: 0.5, tw: true, dur: 5.6, delay: 0.9 },
    { x: 88, y: 9, r: 0.9, o: 0.35 },
    { x: 94, y: 20, r: 1.0, o: 0.45, tw: true, dur: 4.2, delay: 1.4 },
    { x: 4, y: 34, r: 1.0, o: 0.4, tw: true, dur: 5.0, delay: 0.5 },
    { x: 10, y: 48, r: 0.8, o: 0.3 },
    { x: 7, y: 60, r: 1.1, o: 0.45, tw: true, dur: 4.6, delay: 1.2 },
    { x: 92, y: 36, r: 1.0, o: 0.4, tw: true, dur: 5.3, delay: 0.2, cyan: true },
    { x: 96, y: 52, r: 0.9, o: 0.35 },
    { x: 89, y: 62, r: 1.2, o: 0.5, tw: true, dur: 4.0, delay: 0.8 },
    { x: 8, y: 80, r: 1.0, o: 0.4, tw: true, dur: 4.8, delay: 0.4 },
    { x: 18, y: 90, r: 0.9, o: 0.35 },
    { x: 28, y: 76, r: 1.1, o: 0.45, tw: true, dur: 5.4, delay: 1.0 },
    { x: 40, y: 92, r: 0.8, o: 0.3 },
    { x: 52, y: 84, r: 1.0, o: 0.45, tw: true, dur: 4.3, delay: 0.7, cyan: true },
    { x: 62, y: 94, r: 0.9, o: 0.35 },
    { x: 72, y: 80, r: 1.2, o: 0.5, tw: true, dur: 5.1, delay: 0.2 },
    { x: 82, y: 90, r: 1.0, o: 0.4, tw: true, dur: 4.7, delay: 1.3 },
    { x: 90, y: 78, r: 0.8, o: 0.3 },
    { x: 36, y: 40, r: 0.7, o: 0.22 },
    { x: 64, y: 44, r: 0.7, o: 0.24 },
    { x: 50, y: 62, r: 0.8, o: 0.26, tw: true, dur: 6.0, delay: 0.5 },
  ];
  return (
    <svg aria-hidden="true" className="splash-stars" preserveAspectRatio="none">
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={`${s.x}%`}
          cy={`${s.y}%`}
          r={s.r}
          fill={s.cyan ? CY : WHITE}
          className={s.tw ? 'splash-twinkle' : undefined}
          style={
            s.tw
              ? ({
                  '--tw-dur': `${s.dur ?? 4}s`,
                  '--tw-delay': `${s.delay ?? 0}s`,
                } as CSSProperties)
              : { opacity: s.o }
          }
        />
      ))}
    </svg>
  );
}

/**
 * Emblème de marque orbital — l'unique élément signature de l'accueil.
 * Anneaux orbitaux lents désynchronisés + arc accent qui se dessine à
 * l'entrée + cœur lumineux portant le monogramme FX. Tout est SVG (zéro
 * lien cassé, theme-able). Rotations pinnées au centre du viewBox via
 * `.splash-ring-*` (transform-box: view-box). PUREMENT DÉCORATIF : la marque
 * « Fxmily » est déjà portée par le wordmark du header + le <h1>, donc
 * `aria-hidden` (pas de redondance pour lecteur d'écran — a11y review).
 */
function BrandEmblem() {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      focusable="false"
      className="h-auto w-[208px] sm:w-[268px]"
    >
      <defs>
        <radialGradient id="splashCoreGrad" cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="oklch(0.86 0.14 246)" />
          <stop offset="55%" stopColor="oklch(0.55 0.2 258)" />
          <stop offset="100%" stopColor="oklch(0.3 0.13 268)" />
        </radialGradient>
        <radialGradient id="splashHaloGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="oklch(0.62 0.19 254 / 0.62)" />
          <stop offset="58%" stopColor="oklch(0.62 0.19 254 / 0.1)" />
          <stop offset="100%" stopColor="oklch(0.62 0.19 254 / 0)" />
        </radialGradient>
      </defs>

      {/* Halo ambiant — respire (opacity + scale) */}
      <circle className="splash-core" cx="100" cy="100" r="94" fill="url(#splashHaloGrad)" />

      {/* Anneau externe (rotation lente) + points orbitaux lumineux (cyan + accent) */}
      <g className="splash-ring-slow">
        <circle
          cx="100"
          cy="100"
          r="84"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 9"
          style={{ stroke: 'var(--b-strong)' }}
        />
        <circle
          cx="100"
          cy="16"
          r="3.2"
          style={{
            fill: 'var(--cy)',
            filter: 'drop-shadow(0 0 6px oklch(0.789 0.139 217 / 0.85))',
          }}
        />
        <circle
          cx="100"
          cy="184"
          r="1.8"
          style={{
            fill: 'var(--acc-hi)',
            filter: 'drop-shadow(0 0 4px oklch(0.74 0.16 250 / 0.7))',
          }}
        />
      </g>

      {/* Anneau médian : trace faible complète + arc accent qui se dessine */}
      <circle
        cx="100"
        cy="100"
        r="62"
        fill="none"
        strokeWidth="1"
        style={{ stroke: 'var(--b-default)' }}
      />
      <circle
        className="splash-arc-draw"
        cx="100"
        cy="100"
        r="62"
        pathLength={1}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        transform="rotate(-90 100 100)"
        style={{ stroke: 'var(--acc)' }}
      />

      {/* Anneau interne (rotation inverse) + point orbital accent */}
      <g className="splash-ring-rev">
        <circle
          cx="100"
          cy="100"
          r="44"
          fill="none"
          strokeWidth="1"
          strokeDasharray="1 7"
          style={{ stroke: 'var(--b-strong)' }}
        />
        <circle
          cx="100"
          cy="56"
          r="2.8"
          style={{
            fill: 'var(--acc-hi)',
            filter: 'drop-shadow(0 0 5px oklch(0.74 0.16 250 / 0.85))',
          }}
        />
      </g>

      {/* Cœur lumineux + monogramme FX (logo officiel vectorisé) */}
      <circle
        cx="100"
        cy="100"
        r="30"
        fill="url(#splashCoreGrad)"
        strokeWidth="1"
        style={{ stroke: 'var(--b-acc-strong)' }}
      />
      <svg
        x="80"
        y="84"
        width="40"
        height="32"
        viewBox="118 115 363 295"
        preserveAspectRatio="xMidYMid meet"
        overflow="visible"
      >
        <path fillRule="evenodd" d={FX_PATH} fill="oklch(0.98 0.01 247)" />
      </svg>
    </svg>
  );
}
