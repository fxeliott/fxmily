import type { Metadata } from 'next';

import { RouteSegmentError } from '@/components/ui/route-segment-error';

/**
 * Global 404 (`app/not-found.tsx`) — triggered when no route matches the App
 * Router tree. Renders the shared premium not-found surface (calm way-back nav,
 * no retry). `RouteSegmentError` is a client component, but a Server Component
 * may render it — Next hydrates the small island client-side.
 */
export const metadata: Metadata = {
  title: 'Page introuvable',
  description: 'La page que tu cherches n’existe pas (ou plus). Reviens au tableau de bord.',
};

export default function NotFound(): React.ReactElement {
  return <RouteSegmentError variant="not-found" headline="Page introuvable" />;
}
