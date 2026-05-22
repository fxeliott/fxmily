'use client';

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from 'framer-motion';
import type { PointerEvent } from 'react';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * Fxmily "FK" logo mark — SVG inline avec halo bleu pointer-reactive.
 * Pattern : drop-shadow halo + spotlight radial-gradient suivi par pointer
 * (useMotionValue + useSpring, JAMAIS setState — re-renders tuent 60 fps).
 * Idle : "breathing" subtil 5.5s via .tr-breathe (CSS keyframes).
 *
 * Source : research Motion design subagent + Awwwards 2026 pattern.
 */
export function LogoMark({ size = 96, className = '' }: LogoMarkProps) {
  const reduced = useReducedMotion();
  const mx = useMotionValue(50);
  const my = useMotionValue(50);
  const sx = useSpring(mx, { stiffness: 150, damping: 20 });
  const sy = useSpring(my, { stiffness: 150, damping: 20 });
  const bg = useMotionTemplate`radial-gradient(circle 220px at ${sx}% ${sy}%, rgba(0,133,255,0.35), transparent 60%)`;

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 100);
    my.set(((e.clientY - r.top) / r.height) * 100);
  };

  // exactOptionalPropertyTypes : conditional spread to avoid `prop={cond ? undefined : x}`.
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
      {/* Halo soft idle — breathes (5.5s). */}
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

      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="img"
        aria-label="Fxmily"
        style={{
          filter:
            'drop-shadow(0 0 24px rgba(0,133,255,0.45)) drop-shadow(0 4px 12px rgba(0,0,0,0.4))',
        }}
      >
        {/* "F" mark + "X" stroke (approximation du logo fxmily noir/blanc). */}
        <g fill="#EDEDF3">
          {/* F vertical stem */}
          <path d="M 22 18 L 32 18 L 32 82 L 22 82 Z" />
          {/* F top bar */}
          <path d="M 22 18 L 58 18 L 58 28 L 32 28 Z" />
          {/* F middle bar */}
          <path d="M 32 44 L 50 44 L 50 54 L 32 54 Z" />
          {/* X — top-left to bottom-right */}
          <path d="M 48 18 L 58 18 L 84 82 L 74 82 Z" />
          {/* X — top-right to bottom-left */}
          <path d="M 74 18 L 84 18 L 58 82 L 48 82 Z" />
        </g>
      </svg>
    </motion.div>
  );
}
