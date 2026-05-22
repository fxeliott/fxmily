'use client';

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from 'framer-motion';
import Image from 'next/image';
import type { PointerEvent } from 'react';
import logoFxmily from '../../public/logo-fxmily.png';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * Fxmily "FK" logo mark — asset original Eliot, fond noir strippé en alpha
 * (PIL luminance threshold + ramp anti-alias, 2026-05-22).
 *
 * Le PNG a une vraie transparence : 86 % de pixels alpha=0, 13 % blanc
 * opaque, 0.6 % rampe sur les edges pour anti-alias clean. Plus besoin
 * de `mix-blend-mode: lighten` (qui interférait avec l'aurora gradient).
 *
 * Halo bleu derrière (`tr-breathe` 5.5s idle), spotlight pointer-reactive
 * (Motion useMotionValue + useSpring — JAMAIS setState pour 60 fps), et
 * drop-shadow sur l'image elle-même donnent la signature lumineuse.
 */
export function LogoMark({ size = 96, className = '' }: LogoMarkProps) {
  const reduced = useReducedMotion();
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const sx = useSpring(mx, { stiffness: 150, damping: 20 });
  const sy = useSpring(my, { stiffness: 150, damping: 20 });
  const bg = useMotionTemplate`radial-gradient(circle 240px at ${sx}% ${sy}%, rgba(0,133,255,0.40), transparent 60%)`;

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 100);
    my.set(((e.clientY - r.top) / r.height) * 100);
  };

  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, filter: 'blur(8px)', scale: 0.95 },
        animate: { opacity: 1, filter: 'blur(0px)', scale: 1 },
      };

  return (
    <motion.div
      {...motionProps}
      className={`relative isolate inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      onPointerMove={onPointerMove}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Halo soft idle — breathes 5.5s. */}
      <div
        aria-hidden
        className="tr-breathe pointer-events-none absolute inset-0 -z-10 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(0,133,255,0.30) 0%, transparent 70%)',
        }}
      />
      {/* Pointer-reactive spotlight. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-[-30%] -z-10"
        style={{ background: bg }}
      />

      {/* Logo original (mix-blend-mode: lighten élimine le bg pur-noir). */}
      <Image
        src={logoFxmily}
        alt="Fxmily"
        width={size}
        height={size}
        priority
        sizes={`${size}px`}
        style={{
          width: size,
          height: 'auto',
          filter:
            'drop-shadow(0 0 28px rgba(0,133,255,0.45)) drop-shadow(0 4px 14px rgba(0,0,0,0.5))',
        }}
      />
    </motion.div>
  );
}
