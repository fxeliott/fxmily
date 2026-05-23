'use client';

import { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import logoFxmily from '../../public/logo-fxmily.png';

interface LogoMarkProps {
  /** Image height in px (width auto from natural ratio 573:486). */
  height?: number;
  /** Hero halo bleu radial-gradient signature lumineuse. */
  withHalo?: boolean;
  /** Mouse-driven parallax tilt (3D perspective transform). */
  withTilt?: boolean;
  className?: string;
}

/**
 * Logo Fxmily T3 — halo signature lumineuse + parallax tilt mouse-driven.
 *
 * Evolutions vs T2 :
 *  - withTilt prop active une rotation 3D suivant la souris (perspective 600px)
 *  - Spring damped pour éviter jitter
 *  - Reduced-motion désactive le tilt
 *  - Halo + tilt s'utilisent ensemble sur le hero
 *
 * Anti-pattern banni : drop-shadow NOIR (cause contour carré T0.6). Le halo
 * bleu reste un radial gradient pure (jamais rectangle).
 */
export function LogoMark({
  height = 40,
  withHalo = false,
  withTilt = false,
  className = '',
}: LogoMarkProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 150, damping: 20, mass: 0.4 });
  // Tilt range : ±8deg max
  const rotateY = useTransform(sx, [-1, 1], [-8, 8]);
  const rotateX = useTransform(sy, [-1, 1], [8, -8]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || !withTilt) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    x.set(px * 2 - 1);
    y.set(py * 2 - 1);
  };

  const handlePointerLeave = () => {
    if (reduced || !withTilt) return;
    x.set(0);
    y.set(0);
  };

  const entryMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        ...(withTilt ? {} : { whileHover: { y: -2 } }),
      };

  const perspectiveStyle = withTilt && !reduced ? { perspective: 600 } : {};
  const tiltStyle =
    withTilt && !reduced ? { rotateX, rotateY, transformStyle: 'preserve-3d' as const } : {};

  return (
    <motion.div
      ref={ref}
      {...entryMotion}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative inline-flex items-center ${className}`}
      style={perspectiveStyle}
    >
      {withHalo && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(circle at center, rgba(91, 141, 239, 0.32) 0%, rgba(91, 141, 239, 0.10) 35%, transparent 70%)',
            filter: 'blur(22px)',
            transform: 'scale(2.4)',
          }}
          initial={reduced ? false : { opacity: 0.6 }}
          animate={reduced ? false : { opacity: [0.5, 0.95, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <motion.div style={tiltStyle}>
        <Image
          src={logoFxmily}
          alt="Fxmily"
          height={height}
          sizes={`${height}px`}
          priority
          style={{ height, width: 'auto' }}
        />
      </motion.div>
    </motion.div>
  );
}
