'use client';

import { RouteSegmentError } from '@/components/ui/route-segment-error';

/**
 * Root error boundary (`app/error.tsx`) — catches any unhandled throw *below*
 * the root layout (Server Component, route handler, or client island). The
 * shared `RouteSegmentError` carries the DA + Sentry capture; `app/global-error.tsx`
 * stays self-contained for the case where the root layout itself throws.
 */
export default function GlobalError({
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
      headline="Quelque chose a cassé"
    />
  );
}
