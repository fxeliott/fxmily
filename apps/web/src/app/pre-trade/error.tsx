'use client';

import { RouteSegmentError } from '@/components/ui/route-segment-error';

/**
 * Segment error boundary for `/pre-trade/*` (Next.js `error.tsx` convention).
 * Renders BELOW the layout so the nav shell stays mounted — a thin wrapper
 * over the shared `RouteSegmentError` (DA + Sentry capture centralised).
 * Pre-trade sits on the member's hot path (they open it seconds before an
 * entry): a graceful in-shell error beats a full-page crash mid-routine.
 */
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <RouteSegmentError
      variant="error"
      error={error}
      reset={reset}
      headline="Ton pré-trade n'a pas pu s'afficher"
    />
  );
}
