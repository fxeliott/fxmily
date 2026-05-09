'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Btn } from '@/components/ui/btn';

/**
 * J10 Phase L — global error boundary (`app/error.tsx` Next.js convention).
 *
 * Catches any unhandled error from a Server Component / route handler /
 * client component below the root layout. The Sentry SDK already captures
 * the error via `onRequestError` in `instrumentation.ts` for server-side
 * throws, but we additionally `useEffect` here to capture client-side
 * throws that escape the React render cycle.
 *
 * Posture (SPEC §2 + memory `feedback_premium_frontend`) :
 *  - sober, factual French copy — no FOMO, no apology theatre
 *  - DS v2 deep-space + lime accent (matches the rest of the app)
 *  - the `reset()` function lets the user retry the failing render in
 *    place ; falling back to a full nav to `/` is offered as a hard reset
 *
 * NOTE : this is the GLOBAL error boundary. Next.js 16 also supports
 * route-segment errors (`app/account/error.tsx` etc) for finer-grained
 * recovery — V2 if needed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Best-effort client-side capture. If `@sentry/nextjs` is bundled, this
    // surfaces the error in the dashboard with the same scope as the route
    // handler context. If not, it's a no-op import (Sentry does its own
    // dedupe via the event_id digest).
    void import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {
        /* swallow — Sentry must never be the reason a UX error compounds */
      });
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 text-center">
      <span
        aria-hidden="true"
        className="grid h-14 w-14 place-items-center rounded-full bg-[var(--bad-dim)] text-[var(--bad)]"
      >
        <AlertTriangle className="h-6 w-6" />
      </span>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--bad)]">
          Erreur
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          Quelque chose a cassé
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--t-2)]">
          Inattendu, on a logué l&apos;erreur côté serveur. Tu peux réessayer la page, ou revenir à
          l&apos;accueil. Si ça persiste, contacte{' '}
          <a
            href="mailto:eliot@fxmilyapp.com"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            eliot@fxmilyapp.com
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
    </main>
  );
}
