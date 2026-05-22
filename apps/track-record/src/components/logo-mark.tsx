'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import logoFxmily from '../../public/logo-fxmily.png';

interface LogoMarkProps {
  /** Image height in px (width auto from natural ratio 573:486). */
  height?: number;
  /** Si true : halo bleu signature lumineuse (hero only, jamais header). */
  withHalo?: boolean;
  className?: string;
}

/**
 * Logo Fxmily T2 — signature lumineuse réintroduite après feedback T1
 * « presque rien sur la page » + brief initial « halo, micro-interaction,
 * à toi de juger ce qui sublime le mieux le logo ».
 *
 * Évolutions vs T1 :
 *  - `withHalo` prop : active un halo bleu radial très diffus DERRIÈRE le PNG
 *    (jamais devant, jamais une box autour). Le halo respire (animation breathe
 *    8s) si motion enabled. Hero uniquement.
 *  - Hover micro-lift y=-2 (subtle, jamais scale)
 *  - Animation d'entrée : opacity 0→1 + translateY 6px→0 + 800ms
 *
 * Anti-pattern banni : drop-shadow NOIR (cause du contour carré T0.6).
 * Le halo bleu ne remplit qu'un cercle radial flouté autour du logo, pas un
 * rectangle.
 */
export function LogoMark({ height = 40, withHalo = false, className = '' }: LogoMarkProps) {
  const reduced = useReducedMotion();
  const motionProps = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        whileHover: { y: -2 },
      };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className={`relative inline-flex items-center ${className}`}
    >
      {withHalo && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(circle at center, rgba(91, 141, 239, 0.28) 0%, rgba(91, 141, 239, 0.08) 35%, transparent 70%)',
            filter: 'blur(20px)',
            transform: 'scale(2.2)',
          }}
          initial={reduced ? false : { opacity: 0.6 }}
          animate={reduced ? false : { opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <Image
        src={logoFxmily}
        alt="Fxmily"
        height={height}
        sizes={`${height}px`}
        priority
        style={{ height, width: 'auto' }}
      />
    </motion.div>
  );
}
