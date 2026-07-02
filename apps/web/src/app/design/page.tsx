import { notFound } from 'next/navigation';

import { DesignSystemShowcase } from '@/components/design-system/showcase';

export const metadata = {
  title: 'Design System · Fxmily (dev)',
  robots: { index: false, follow: false },
};

/**
 * Route vitrine vivante du design system (S9) — DEV UNIQUEMENT.
 *
 * `notFound()` en production : la vitrine n'est jamais exposée aux membres,
 * elle sert d'ancre anti-régression visuelle pendant le développement
 * (tokens, primitives, états, motion réunis sur une seule page).
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DesignSystemShowcase />;
}
