'use client';

import { RouteSegmentError } from '@/components/ui/route-segment-error';

/**
 * Segment error boundary for `/progression` (Next.js `error.tsx` convention).
 * Renders BELOW the layout so the nav shell stays mounted — a thin wrapper
 * over the shared `RouteSegmentError` (DA + Sentry capture centralised).
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
      headline="La progression n'a pas pu s'afficher"
    />
  );
}
