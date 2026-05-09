import { ArrowLeft, Compass } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { btnVariants } from '@/components/ui/btn';

/**
 * J10 Phase L — global 404 (`app/not-found.tsx` Next.js convention).
 *
 * Triggered when a route doesn't match the App Router file-system tree.
 * Server Component — pure SSR, no client JS.
 *
 * Posture : factual, calm, no humor that would feel off when someone
 * actually loses data ("oups, page disparue!"). Just three doors back :
 * dashboard (members default), `/account`, and `/` (public landing).
 */

export const metadata: Metadata = {
  title: 'Page introuvable',
  description:
    'La page que tu cherches n’existe pas (ou plus). Trois portes pour revenir en arrière.',
};

export default function NotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <span
        aria-hidden="true"
        className="grid h-14 w-14 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
      >
        <Compass className="h-6 w-6" />
      </span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--acc)]">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          Page introuvable
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--t-2)]">
          La page que tu cherches n&apos;existe pas (ou plus). Si tu suivais un lien, il était
          peut-être périmé.
        </p>
      </div>
      <nav aria-label="Retour" className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard" className={btnVariants({ kind: 'primary', size: 'm' })}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Dashboard
        </Link>
        <Link href="/account" className={btnVariants({ kind: 'secondary', size: 'm' })}>
          Mon compte
        </Link>
        <Link href="/" className={btnVariants({ kind: 'ghost', size: 'm' })}>
          Accueil
        </Link>
      </nav>
    </main>
  );
}
