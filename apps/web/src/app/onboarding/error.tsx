'use client';

import { RouteSegmentError } from '@/components/ui/route-segment-error';

/**
 * Segment error boundary for `/onboarding/*` (Next.js `error.tsx` convention).
 * Renders BELOW the layout so the shell stays mounted — a thin wrapper over
 * the shared `RouteSegmentError` (DA + Sentry capture centralised). Onboarding
 * is the FIRST surface a new member ever sees: without this boundary a render
 * error would bubble to the root error page and look like the app is down.
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
      headline="Ton onboarding n'a pas pu s'afficher"
    />
  );
}
