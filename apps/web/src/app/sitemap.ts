import type { MetadataRoute } from 'next';

/**
 * Phase T security hardening (2026-05-09) — empty sitemap for V1 closed cohort.
 *
 * Match `app/robots.ts` posture : no public surface to index. We return an
 * empty sitemap so crawlers that hit `/sitemap.xml` get a valid empty
 * response (rather than a 404 that they might follow up on).
 *
 * V2 may expose `/legal/*` and a marketing landing — populate this then.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
