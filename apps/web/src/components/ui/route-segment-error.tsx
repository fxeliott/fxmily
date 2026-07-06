'use client';

import { AlertTriangle, ArrowLeft, Compass, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';

import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

/**
 * RouteSegmentError — shared premium error / not-found surface for every
 * App Router `error.tsx` and `not-found.tsx` boundary (Tour 15 wow pass).
 *
 * Before this component, ~21 segment `error.tsx` files were near-identical
 * copies of the same Inter markup with only the headline changing, and none
 * of them carried the DA display face (`f-display` / Clash Display) or the
 * ambient depth cue the rest of the app ships. This centralises the wow so a
 * boundary is now a 3-5 line wrapper that passes its contextual copy.
 *
 * Two variants:
 *  - `error`     : recoverable throw below a layout. Shows `reset()` retry
 *    (Next.js contract) + a home/back link + the digest ID for support.
 *  - `not-found` : 404. No retry (nothing to re-render); calm way-back nav.
 *
 * Posture (SPEC §2 — discipline/psychologie, anti-FOMO):
 *  - calm, factual French copy, never punitive, no apology theatre
 *  - DS tokens (`--var`) + `f-display` masthead, ambient aurora + orb behind
 *  - motion lives in CSS/props only (global reduced-motion filet kills the
 *    orb drift) — the JSX tree never branches on `useReducedMotion` so
 *    hydration stays stable (repo lesson `reference_reduced-motion-hydration`)
 *
 * `error.tsx` boundaries stay `'use client'` and keep the `{ error, reset }`
 * contract in their thin wrapper; the Sentry capture also lives here so every
 * boundary reports with one code path.
 */
export interface RouteSegmentErrorProps {
  variant?: 'error' | 'not-found';
  /** Bold, contextual headline (e.g. "Ton journal n'a pas pu s'afficher"). */
  headline: ReactNode;
  /**
   * Optional eyebrow above the headline. Defaults to "Erreur" for the error
   * variant and "404" for not-found.
   */
  eyebrow?: string;
  /**
   * Optional remediation paragraph. Falls back to a sober per-variant default
   * that already covers the common case (retry / stale link).
   */
  description?: ReactNode;
  /** The thrown error (error variant only) — surfaces the digest for support. */
  error?: Error & { digest?: string };
  /** Next.js segment reset handler (error variant only) — retries in place. */
  reset?: () => void;
  /** Primary way-back link for the not-found variant. Default `/dashboard`. */
  homeHref?: string;
  className?: string;
}

export function RouteSegmentError({
  variant = 'error',
  headline,
  eyebrow,
  description,
  error,
  reset,
  homeHref = '/dashboard',
  className,
}: RouteSegmentErrorProps): React.ReactElement {
  const isNotFound = variant === 'not-found';

  useEffect(() => {
    // Best-effort client-side capture (error variant only). Sentry dedupes by
    // digest, and a missing SDK is a no-op — capture must never compound a UX
    // error. Not-found is an expected state, so we don't report it.
    if (isNotFound || !error) return;
    void import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => {
        /* swallow — Sentry must never be the reason a UX error compounds */
      });
  }, [error, isNotFound]);

  const resolvedEyebrow = eyebrow ?? (isNotFound ? '404' : 'Erreur');
  const resolvedDescription =
    description ??
    (isNotFound ? (
      <>
        La page que tu cherches n&apos;existe pas (ou plus). Si tu suivais un lien, il était
        peut-être périmé.
      </>
    ) : (
      <>
        Rien de grave, on a logué l&apos;erreur côté serveur. Tes données sont intactes. Tu peux
        réessayer, ou revenir en arrière. Si ça persiste, contacte{' '}
        <a
          href="mailto:fxeliott@fxmily.fr"
          className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
        >
          fxeliott@fxmily.fr
        </a>
        {error?.digest ? ' en mentionnant l’identifiant ci-dessous.' : '.'}
      </>
    ));

  const accentToken = isNotFound ? 'var(--acc-hi)' : 'var(--bad)';
  const haloTokens = isNotFound
    ? 'border-[var(--b-acc)] text-[var(--acc-hi)]'
    : 'border-[var(--b-danger)] text-[var(--bad)]';

  return (
    <main
      data-slot="route-segment-error"
      data-variant={variant}
      className={cn(
        'relative flex w-full flex-1 flex-col items-center justify-center overflow-hidden px-4 py-16 text-center',
        className,
      )}
    >
      {/* Ambient backplate — aurora wash + one drifting orb, painted below the
          content. Decorative only: aria-hidden + pointer-events:none, and the
          orb drift is killed by the global reduced-motion rule. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="ds-aurora absolute inset-0 opacity-70" />
        <div
          className="ds-orb"
          style={{
            top: '-6rem',
            left: '50%',
            marginLeft: '-14rem',
            width: '28rem',
            height: '28rem',
            background: isNotFound
              ? 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.32) 0%, transparent 70%)'
              : 'radial-gradient(circle, oklch(0.62 0.16 25 / 0.28) 0%, transparent 70%)',
          }}
        />
      </div>

      <span
        aria-hidden="true"
        className={cn(
          'relative grid h-16 w-16 place-items-center rounded-full border bg-[var(--bg-2)]',
          haloTokens,
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full opacity-40 blur-xl"
          style={{ background: accentToken }}
        />
        {isNotFound ? (
          <Compass className="relative h-7 w-7" strokeWidth={1.75} />
        ) : (
          <AlertTriangle className="relative h-7 w-7" strokeWidth={1.75} />
        )}
      </span>

      <div className="mt-6 max-w-xl">
        <p
          className="text-[11px] font-medium tracking-[0.2em] uppercase"
          style={{ color: accentToken }}
        >
          {resolvedEyebrow}
        </p>
        <h1 className="f-display mt-3 text-3xl leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-4xl">
          {headline}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--t-2)]">{resolvedDescription}</p>
        {!isNotFound && error?.digest ? (
          <p className="mt-4 text-[11px] text-[var(--t-3)]">
            <code className="rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--t-1)]">
              ID : {error.digest}
            </code>
          </p>
        ) : null}
      </div>

      <nav
        aria-label={isNotFound ? 'Retour' : 'Actions'}
        className="mt-7 flex flex-wrap items-center justify-center gap-3"
      >
        {!isNotFound && reset ? (
          <button
            type="button"
            onClick={reset}
            className={btnVariants({ kind: 'primary', size: 'm' })}
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Réessayer
          </button>
        ) : null}
        <Link
          href={homeHref}
          className={btnVariants({ kind: isNotFound ? 'primary' : 'secondary', size: 'm' })}
        >
          {isNotFound ? <ArrowLeft aria-hidden="true" className="h-4 w-4" /> : null}
          {isNotFound ? 'Tableau de bord' : 'Retour au tableau de bord'}
        </Link>
        {isNotFound ? (
          <Link href="/" className={btnVariants({ kind: 'ghost', size: 'm' })}>
            Accueil
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
