/**
 * Loading skeleton for `/admin/track-record` list page.
 *
 * T5 audit Phase H — ui-designer T2-3 fix : sans `loading.tsx` Next 16
 * Suspense fallback, naviguer depuis `/admin` vers `/admin/track-record`
 * affichait un blank reload (le Server Component async re-render bloqué
 * sur `listPublicTrades` + `getCatalogStats` parallel fetch). Le skeleton
 * matche la structure rendue post-fetch (header + stats strip 4-cells +
 * filter strip + 5 row cards) pour minimiser le layout shift.
 *
 * DS-v2 `.skel` classe (`globals.css`) anime un subtle shimmer
 * `prefers-reduced-motion`-safe — pas de pulse agressif (anti Black-Hat
 * gamification).
 */

import { Card } from '@/components/ui/card';

// Phase H+5 TIER 2 #7 fix — align padding avec `page.tsx:68` pour éviter
// le layout shift visible mobile (~16px scroll bump) à la transition
// skeleton → loaded. `page.tsx` utilise `pt-6 pb-24 md:pt-10`.
const CONTAINER = 'container mx-auto max-w-6xl px-4 pt-6 pb-24 md:pt-10';

export default function AdminTrackRecordLoading() {
  return (
    <main className={CONTAINER}>
      {/* Hero header — Pill admin + Pill T5 + h1 + lead + Nouveau trade CTA */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="skel rounded-pill h-6 w-16" aria-hidden />
            <div className="skel rounded-pill h-6 w-24" aria-hidden />
          </div>
          <div className="skel h-9 w-72 rounded" aria-hidden />
          <div className="skel h-5 w-96 max-w-full rounded" aria-hidden />
        </div>
        <div className="skel rounded-button h-11 w-40 self-start" aria-hidden />
      </div>

      {/* Stats strip 4 cells */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4" edge={false}>
            <div className="skel mb-2 h-3 w-20 rounded" aria-hidden />
            <div className="skel h-8 w-16 rounded" aria-hidden />
          </Card>
        ))}
      </div>

      {/* Filter chips row */}
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skel rounded-pill h-9 w-20" aria-hidden />
        ))}
      </div>

      {/* Row cards list — 5 placeholders */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="p-4" edge={false}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="skel h-5 w-10 rounded" aria-hidden />
                  <div className="skel rounded-pill h-5 w-16" aria-hidden />
                  <div className="skel rounded-pill h-5 w-16" aria-hidden />
                  <div className="skel rounded-pill h-5 w-14" aria-hidden />
                </div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <div className="skel h-6 w-20 rounded" aria-hidden />
                  <div className="skel h-5 w-16 rounded" aria-hidden />
                  <div className="skel h-4 w-12 rounded" aria-hidden />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="skel h-4 w-24 rounded" aria-hidden />
                  <div className="skel h-4 w-16 rounded" aria-hidden />
                  <div className="skel h-4 w-20 rounded" aria-hidden />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="skel rounded-button h-11 w-20" aria-hidden />
                <div className="skel rounded-pill h-11 w-24" aria-hidden />
                <div className="skel rounded-pill h-11 w-24" aria-hidden />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        Chargement de la liste des trades publics.
      </span>
    </main>
  );
}
