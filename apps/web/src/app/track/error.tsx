'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Btn } from '@/components/ui/btn';

/**
 * Segment error boundary for `/track` (Next.js `error.tsx` convention).
 *
 * Unlike `app/error.tsx` (the GLOBAL boundary, which replaces the whole
 * document), a segment boundary renders BELOW the member layout — so the
 * sidebar / nav shell stays mounted. A `throw` from a force-dynamic page
 * (e.g. a transient DB hiccup) degrades gracefully into a calm panel inside
 * the chrome, instead of nuking the entire screen.
 *
 * Posture (SPEC §2 — execution/discipline/psy, anti-Black-Hat) :
 *  - calm, factual French copy — no FOMO, no apology theatre, never punitive
 *  - DS v3 noir + bleu lumineux, mirrors `app/error.tsx`
 *  - `reset()` re-renders the failing segment in place ; no stack trace exposed
 *  - client-side capture mirrors the global boundary (Sentry dedupes by digest)
 */
export default function TrackError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    void import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {
        /* swallow — Sentry must never be the reason a UX error compounds */
      });
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <span
        aria-hidden="true"
        className="grid h-14 w-14 place-items-center rounded-full bg-[var(--bad-dim)] text-[var(--bad)]"
      >
        <AlertTriangle className="h-6 w-6" />
      </span>
      <div>
        <p className="text-[11px] font-medium tracking-[0.18em] text-[var(--bad)] uppercase">
          Erreur
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          Le suivi n&apos;a pas pu s&apos;afficher
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--t-2)]">
          Rien de grave, on a logué l&apos;erreur côté serveur. Tes données sont intactes. Tu peux
          réessayer cette page, ou revenir à l&apos;accueil. Si ça persiste, contacte{' '}
          <a
            href="mailto:fxeliott@fxmily.fr"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            fxeliott@fxmily.fr
          </a>{' '}
          en mentionnant l&apos;identifiant ci-dessous.
        </p>
        {error.digest ? (
          <p className="mt-4 text-[11px] text-[var(--t-3)]">
            <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--t-1)]">
              ID : {error.digest}
            </code>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Btn kind="primary" size="m" onClick={reset}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Réessayer
        </Btn>
        <Btn kind="secondary" size="m" onClick={() => (window.location.href = '/')}>
          Retour à l&apos;accueil
        </Btn>
      </div>
    </div>
  );
}
