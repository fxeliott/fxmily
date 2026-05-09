'use client';

import { useEffect } from 'react';

/**
 * Phase P review T1.3 — root-layout error boundary.
 *
 * Next.js 16 distinguishes:
 *  - `app/error.tsx`        : catches errors *under* the root layout.
 *  - `app/global-error.tsx` : catches errors *in* the root layout itself
 *    (e.g. `app/layout.tsx`, `app/providers.tsx`, or any module loaded by
 *    them). When `error.tsx` cannot mount because the root layout itself
 *    threw, this is the last-ditch UI.
 *
 * Constraints (Next.js convention) :
 *  - This component MUST render its own `<html>` and `<body>`. The default
 *    layout is unmounted by the time this runs.
 *  - Keep it self-contained — no `<Btn>`, no providers, no DS imports. If
 *    the failing module crashes at import-time, anything pulling on the
 *    same dep chain would crash again here.
 *  - No analytics, no PostHog, no extras. Sentry is the only third party
 *    we surface, and it's lazy-imported so a missing build still renders.
 *
 * Posture matches `app/error.tsx` (sober French, retry + home, digest ID
 * shown for support) but uses inline styles instead of Tailwind in case
 * the CSS bundle itself failed to load.
 */
export default function GlobalError({
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
        /* swallow — last-ditch UI must never throw */
      });
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#0c1117',
          color: '#f1f5f9',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
        }}
      >
        <main
          style={{
            maxWidth: '32rem',
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '3.5rem',
              height: '3.5rem',
              borderRadius: '999px',
              background: 'rgba(248, 113, 113, 0.15)',
              color: '#f87171',
              display: 'grid',
              placeItems: 'center',
              fontSize: '1.5rem',
            }}
          >
            !
          </div>
          <div>
            <p
              style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                color: '#f87171',
                margin: 0,
              }}
            >
              Erreur
            </p>
            <h1
              style={{
                marginTop: '0.5rem',
                fontSize: '1.75rem',
                fontWeight: 600,
                letterSpacing: '-0.025em',
                color: '#f8fafc',
              }}
            >
              Quelque chose a cassé
            </h1>
            <p
              style={{
                marginTop: '0.75rem',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                color: '#cbd5e1',
              }}
            >
              Une erreur grave a empêché le chargement de l&apos;application. On l&apos;a logué côté
              serveur. Tu peux réessayer ou contacter{' '}
              <a
                href="mailto:eliot@fxmilyapp.com"
                style={{ color: '#a3e635', textDecoration: 'underline' }}
              >
                eliot@fxmilyapp.com
              </a>{' '}
              en mentionnant l&apos;identifiant ci-dessous.
            </p>
            {error.digest ? (
              <p style={{ marginTop: '1rem', fontSize: '0.6875rem', color: '#94a3b8' }}>
                <code
                  style={{
                    background: '#1e293b',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '0.25rem',
                    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
                    color: '#f8fafc',
                  }}
                >
                  ID : {error.digest}
                </code>
              </p>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#a3e635',
                color: '#0c1117',
                border: 'none',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={() => (window.location.href = '/')}
              style={{
                background: 'transparent',
                color: '#f8fafc',
                border: '1px solid #475569',
                padding: '0.625rem 1.25rem',
                borderRadius: '0.5rem',
                fontWeight: 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Retour à l&apos;accueil
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
