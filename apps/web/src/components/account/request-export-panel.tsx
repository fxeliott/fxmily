'use client';

import { Archive, CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { requestDataExportAction } from '@/app/account/data/actions';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';

/**
 * `<RequestExportPanel>` — client island for the J6 asynchronous RGPD export
 * (scope 6). The heavy archive (JSON + photos) is built off-request; this panel
 * only requests a job and reflects the server's job status.
 *
 * Display truth = the `job` PROP (server-rendered, re-fetched via
 * `router.refresh()`), never local optimistic state — so the status shown is
 * always the persisted job. While a job is pending/processing we poll every 6s
 * so the download link appears without a manual refresh; the interval is bounded
 * (only mounts while `isRunning`, clears on transition/unmount). The member is
 * also notified (`data_export_ready`) when it lands, so leaving the page is fine.
 *
 * Posture (Mark Douglas, no-FOMO): factual copy, no urgency. The instant JSON
 * export stays available on the page as the lighter option.
 */

export type ExportJobView = {
  id: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  /**
   * Server-computed: a pending/processing job that has outlived any legitimate
   * build (its off-request work died with a server restart). Rendered as a
   * recoverable "stuck" state with an explicit relaunch, and it stops the poll.
   */
  stale?: boolean;
};

export function RequestExportPanel({ job }: { job: ExportJobView | null }): React.ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const status = job?.status ?? null;
  const isRunning = status === 'pending' || status === 'processing';
  // A zombie job: still "running" server-side but its build died. Show a relaunch
  // affordance instead of an eternal spinner, and DON'T poll (refreshing a dead
  // job changes nothing — relaunching it does).
  const isStuck = isRunning && job?.stale === true;
  const isActivelyRunning = isRunning && !isStuck;

  useEffect(() => {
    if (!isActivelyRunning) return;
    const timer = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(timer);
  }, [isActivelyRunning, router]);

  function handleRequest(): void {
    setError(null);
    // AWAIT inside the transition so `pending` (the button's disabled + label)
    // reflects the real in-flight state for the whole round-trip (React 19 async
    // Actions); the try/catch surfaces a rejection as the error message instead
    // of an unhandled rejection.
    startTransition(async () => {
      try {
        const result = await requestDataExportAction();
        if (!result.ok) {
          setError(
            result.error === 'unauthorized'
              ? 'Session expirée, reconnecte-toi.'
              : 'La préparation n’a pas pu démarrer. Réessaie dans un instant.',
          );
          return;
        }
        router.refresh();
      } catch {
        setError('La préparation n’a pas pu démarrer. Réessaie dans un instant.');
      }
    });
  }

  return (
    <div className="rounded-card border border-[var(--b-subtle)] bg-[var(--bg-2)] p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--bg-3)] text-[var(--acc-hi)] ring-1 ring-[var(--b-acc)] ring-inset"
        >
          <Archive className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--t-1)]">
              Export complet (avec photos)
            </h3>
            {/*
             * The status pills change IN PLACE when the panel polls (every 6s)
             * and the job flips pending -> ready/failed, with no navigation. Wrap
             * them in a polite live region so a screen-reader member hears the
             * outcome (WCAG 2.1 SC 4.1.3). The sr-only sentence makes the terse
             * pill self-explanatory; aria-live only announces CHANGES after mount,
             * so an already-ready job on first load stays silent (correct).
             */}
            <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
              {status === 'ready' && <Pill tone="ok">Prêt</Pill>}
              {isActivelyRunning && <Pill tone="cy">Préparation…</Pill>}
              {isStuck && <Pill tone="warn">Interrompu</Pill>}
              {status === 'failed' && <Pill tone="bad">Échec</Pill>}
              <span className="sr-only">
                {status === 'ready'
                  ? 'Ton export complet est prêt à télécharger.'
                  : isActivelyRunning
                    ? 'Préparation de ton export complet en cours.'
                    : isStuck
                      ? 'La préparation de ton export a été interrompue, tu peux la relancer.'
                      : status === 'failed'
                        ? 'La préparation de ton export a échoué, tu peux réessayer.'
                        : ''}
              </span>
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--t-3)]">
            Une archive <code className="font-mono text-[var(--t-2)]">.zip</code> avec tes données
            (JSON) <strong>et tes photos</strong> (trades, preuves, avatar). Préparée en
            arrière-plan, tu reçois une notification quand elle est prête.
          </p>

          {status === 'ready' && job && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={`/api/account/data/export/${job.id}`}
                className={btnVariants({ kind: 'primary', size: 's' })}
                data-testid="download-export-zip"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Télécharger l’archive
              </a>
              <button
                type="button"
                onClick={handleRequest}
                disabled={pending}
                className={btnVariants({ kind: 'ghost', size: 's' })}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                Regénérer
              </button>
            </div>
          )}

          {isActivelyRunning && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--t-2)]">
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin motion-reduce:hidden"
              />
              On assemble ton archive. Tu peux quitter cette page, on te préviendra.
            </p>
          )}

          {isStuck && (
            <div className="mt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--t-2)]">
                <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-[var(--warn)]" />
                La préparation a été interrompue (redémarrage serveur). Relance-la quand tu veux.
              </p>
              <button
                type="button"
                onClick={handleRequest}
                disabled={pending}
                className={btnVariants({ kind: 'primary', size: 's' })}
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {pending ? 'Démarrage…' : 'Relancer la préparation'}
              </button>
            </div>
          )}

          {(status === null || status === 'failed') && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleRequest}
                disabled={pending}
                className={btnVariants({ kind: 'primary', size: 's' })}
              >
                {status === 'failed' ? (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Archive aria-hidden="true" className="h-4 w-4" />
                )}
                {pending
                  ? 'Démarrage…'
                  : status === 'failed'
                    ? 'Réessayer'
                    : 'Préparer mon export complet'}
              </button>
            </div>
          )}

          {status === 'failed' && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--t-3)]">
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 text-[var(--warn)]" />
              La dernière préparation a échoué. Nouvelle tentative quand tu veux.
            </p>
          )}

          {status === 'ready' && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--t-3)]">
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-[var(--ok)]" />
              Archive prête. Le lien reste valable tant que tu ne la regénères pas.
            </p>
          )}

          {error !== null && (
            <p role="alert" className="mt-2 text-[11px] text-[var(--bad)]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
