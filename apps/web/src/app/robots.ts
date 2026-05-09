import type { MetadataRoute } from 'next';

/**
 * Phase T security hardening (2026-05-09) — robots.txt for V1 closed cohort.
 *
 * Fxmily V1 is a private invitation-only cohort (~30 trading-formation
 * members, growing to 100). The app should NOT be indexed by search
 * engines. Disallow everything for all crawlers.
 *
 * V2 may relax to allow `/legal/*` indexing if Fxmily ever ships a public
 * marketing surface, but that's out of scope today.
 *
 * Cf. `apps/web/src/app/sitemap.ts` for the matching empty sitemap (also
 * intentionally not exposing routes to crawlers).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
