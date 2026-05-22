'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import logoFxmily from '../../public/logo-fxmily.png';

interface LogoMarkProps {
  /** Image height in px (width auto from natural ratio 573:486). */
  height?: number;
  className?: string;
}

/**
 * Logo Fxmily — refonte T1 ultra-minimal (Eliot feedback 2026-05-22 :
 * « contour carré cheap et mal intégré »).
 *
 * Diagnostic du contour perçu (DOM inspect) :
 *   - drop-shadow noir 14px blur sur PNG transparent étendait la bbox
 *     visible sur fond `#0a0a0b`
 *   - halo radial-gradient `tr-breathe` infinite créait un cercle perceptible
 *   - container square `width: size, height: size` créait l'illusion bordure
 *
 * Solution canonical (ui-designer specs §6) :
 *   - `inline-flex` SANS width/height fixe (l'image définit ses dimensions)
 *   - AUCUN drop-shadow
 *   - AUCUN halo permanent
 *   - AUCUN pointer-spotlight
 *   - PNG transparent direct sur le bg, propre
 *   - Animation entrée uniquement : opacity 0→1 + translateY 4px→0 sur 600ms
 *
 * Le PNG source a 86 % de pixels transparents (alpha strippé via PIL) +
 * ramp anti-alias propre sur les edges → intégration zéro bordure perçue.
 */
export function LogoMark({ height = 40, className = '' }: LogoMarkProps) {
  const reduced = useReducedMotion();
  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`inline-flex items-center ${className}`}
    >
      <Image
        src={logoFxmily}
        alt="Fxmily"
        height={height}
        // Width auto via natural ratio (573 × 486)
        sizes={`${height}px`}
        priority
        style={{ height, width: 'auto' }}
      />
    </motion.div>
  );
}
