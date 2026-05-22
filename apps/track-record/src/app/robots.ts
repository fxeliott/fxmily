import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

/**
 * T0 — bloque l'indexation jusqu'au prod deploy (T3).
 * Quand publié, retirer le `disallow: '/'` ou autoriser explicitement les bots.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
