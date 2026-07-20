'use client';

import { Archive, CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
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

/** Map the download route's non-200 statuses to factual French copy (posture
 *  §2 — never dump the raw API JSON error at the member). 410 (zip pruned by
 *  retention/TTL after the link was rendered) and 404 (job gone) both resolve to
 *  « regenerate »; the « Régénérer » button is already on screen. */
function downloadErrorMessage(status: number): string {
  if (status === 410 || status === 404) {
    return 'Ce lien a expiré. Régénère ton archive pour la télécharger à nouveau.';
  }
  if (status === 401) return 'Session expirée, reconnecte-toi.';
  if (status === 409)
    return 'Ton archive n’est pas encore prête. Patiente un instant, puis réessaie.';
  return 'Le téléchargement n’a pas pu aboutir. Réessaie, ou régénère ton archive.';
}

/** Pull the server-authored filename out of `Content-Disposition` (the source of
 *  truth) so the saved file keeps the route's name; the caller falls back to the
 *  server-mirrored default when the header is absent or unparsable. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function RequestExportPanel({ job }: { job: ExportJobView | null }): React.ReactNode {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Keyboard/AT focus anchor. Every action button (Régénérer / Relancer / Préparer
  // / Réessayer) UNMOUNTS when its status transition lands, so the browser would
  // drop focus to <body> and a keyboard member would restart from the top of the
  // page (WCAG 2.4.3 Focus Order). On a USER-INITIATED transition only (never on
  // the background poll) we move focus to the panel heading, keeping the member
  // anchored while the polite role=status region announces the new state.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const refocusHeadingRef = useRef(false);

  const status = job?.status ?? null;
  const isRunning = status === 'pending' || status === 'processing';
  // A zombie job: still "running" server-side but its build died. Show a relaunch
  // affordance instead of an eternal spinner, and DON'T poll (refreshing a dead
  // job changes nothing — relaunching it does).
  const isStuck = isRunning && job?.stale === true;
  const isActivelyRunning = isRunning && !isStuck;
  // The rendered branch, so the refocus effect fires on EVERY meaningful UI
  // transition (incl. stuck→running, where `status` alone stays 'pending').
  const view = isStuck ? 'stuck' : isActivelyRunning ? 'running' : (status ?? 'idle');

  useEffect(() => {
    if (!isActivelyRunning) return;
    const timer = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(timer);
  }, [isActivelyRunning, router]);

  // Restore focus to the heading after a user-triggered status change unmounted
  // the button they activated. Gated by `refocusHeadingRef` so the 6s poll (which
  // also changes `view`, e.g. running→ready) never yanks focus from elsewhere.
  useEffect(() => {
    if (!refocusHeadingRef.current) return;
    refocusHeadingRef.current = false;
    headingRef.current?.focus();
  }, [view]);

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
        // Arm the heading refocus for the status change this refresh will land, so
        // the keyboard member isn't dropped to <body> when the button unmounts.
        refocusHeadingRef.current = true;
        router.refresh();
      } catch {
        setError('La préparation n’a pas pu démarrer. Réessaie dans un instant.');
      }
    });
  }

  /**
   * Download the ready archive CLIENT-SIDE instead of letting the browser
   * navigate to the API URL. A raw `<a href>` nav renders the route's JSON error
   * body verbatim if the zip was pruned (410) or the job vanished (404/401)
   * between render and click — a technical dump at the member (posture §2). We
   * fetch first: 200 → blob save (Content-Disposition filename preserved);
   * non-200 → factual French copy in the existing `role="alert"`, with the
   * « Régénérer » button already on screen. The `href` stays for progressive
   * enhancement — no-JS and right-click « save as » still download the
   * attachment (the route serves 200 as `Content-Disposition: attachment`).
   */
  async function handleDownload(e: React.MouseEvent<HTMLAnchorElement>): Promise<void> {
    // Leave modified / non-primary clicks (open in new tab, save-as, middle
    // click) to the browser — the href is a real, attachment-served URL.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (downloading || !job) return;
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch(`/api/account/data/export/${job.id}`, {
        headers: { Accept: 'application/zip' },
      });
      if (!res.ok) {
        setError(downloadErrorMessage(res.status));
        return;
      }
      // The member export is a bounded snapshot (their own data + photos), so
      // buffering it as one blob to force a named save is acceptable here.
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `fxmily-export-${job.id.slice(-6)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Le téléchargement n’a pas pu aboutir. Vérifie ta connexion, puis réessaie.');
    } finally {
      setDownloading(false);
    }
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
            <h3
              ref={headingRef}
              tabIndex={-1}
              className="rounded-sm text-sm font-semibold text-[var(--t-1)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-2)]"
            >
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
                onClick={handleDownload}
                aria-busy={downloading}
                aria-disabled={downloading}
                className={btnVariants({ kind: 'primary', size: 's' })}
                data-testid="download-export-zip"
              >
                {downloading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Download aria-hidden="true" className="h-4 w-4" />
                )}
                {downloading ? 'Téléchargement…' : 'Télécharger l’archive'}
              </a>
              <button
                type="button"
                onClick={handleRequest}
                disabled={pending}
                className={btnVariants({ kind: 'ghost', size: 's' })}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                Régénérer
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
              Archive prête. Le lien reste valable tant que tu ne la régénères pas.
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
