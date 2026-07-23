'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Btn } from '@/components/ui/btn';

/**
 * OfflineReload — client island mounted on the static `/offline` fallback page
 * (SCOPE 3, J8). Makes the page's "ton espace se recharge tout seul" promise
 * REAL instead of a phantom (the copy previously claimed an auto-reload that
 * no code actually performed).
 *
 * Two recovery paths:
 *
 * 1. **Automatic** — listen for the browser `online` event (an edge-triggered
 *    offline→online transition) and reload. The Service Worker served this
 *    `/offline` page as the network-first fallback WITHOUT changing the URL, so
 *    `location.reload()` re-requests the ORIGINAL page the member was heading
 *    to — which now succeeds. They land back where they were, not on a dead end.
 *
 * 2. **Manual "Réessayer"** — the `online` event only fires on a real interface
 *    transition. If `navigator.onLine` was already `true` when this page loaded
 *    (server transiently unreachable, DNS hiccup, captive portal…), no event
 *    fires. We deliberately do NOT auto-reload on mount in that case:
 *    `navigator.onLine === true` does not prove reachability, so a mount-time
 *    reload could loop (fail → /offline → reload → fail → …). The button hands
 *    that decision to the member.
 *
 * The page stays `force-static`: this island is prerendered into the static
 * HTML and hydrated on the member's device — no server work at request time.
 *
 * Calm posture (SPEC §2, Mark Douglas): no countdown, no alarm, no auto-retry
 * loop — a single sober control.
 */
export function OfflineReload(): React.ReactElement {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = (): void => {
      // Re-attempt the navigation the member was making (URL is unchanged —
      // the SW served /offline in place). Now that the network is back, it
      // resolves to the real page.
      window.location.reload();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <Btn
        kind="secondary"
        size="m"
        loading={retrying}
        onClick={() => {
          setRetrying(true);
          window.location.reload();
        }}
      >
        <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Réessayer
      </Btn>
      <p role="status" aria-live="polite" className="sr-only">
        {retrying ? 'Tentative de reconnexion en cours.' : ''}
      </p>
    </div>
  );
}
