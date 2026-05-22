'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No Sentry wire in T0 — direct console for now. T3 will tunnel through Sentry.
    console.error('[track-record] route error', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <div className="text-[11px] font-medium tracking-[0.16em] text-[var(--tr-warn)] uppercase">
        Erreur
      </div>
      <h1
        className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-[var(--tr-t-1)] sm:text-4xl"
        style={{ fontFamily: 'var(--tr-font-display)' }}
      >
        Une erreur est survenue.
      </h1>
      <p className="mt-3 max-w-sm text-[15px] text-[var(--tr-t-2)]">
        Essayez de recharger la page. Si le problème persiste, contactez l&apos;équipe Fxmily.
      </p>
      {error.digest && (
        <code className="mt-4 font-mono text-xs text-[var(--tr-t-3)]">id : {error.digest}</code>
      )}
      <button
        onClick={() => reset()}
        className="tr-cta mt-8 inline-flex h-11 items-center rounded-lg bg-[var(--tr-acc)] px-5 text-sm font-semibold text-[var(--tr-acc-fg)] transition hover:bg-[var(--tr-acc-hi)]"
        style={{ boxShadow: 'var(--tr-sh-cta)' }}
      >
        Recharger
      </button>
    </main>
  );
}
