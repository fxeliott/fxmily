import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';

/**
 * Offline fallback (`/offline`) — served by the service worker when a
 * navigation fails while the device is offline (Tour 15). Pre-cached at SW
 * install; kept static and self-contained (no data fetch, no auth) so it
 * renders from cache with zero network. Public route (see `auth.config.ts`).
 *
 * Posture: calm and factual (SPEC §2). Not an error, not a dead end — the
 * member simply reconnects and continues. No FOMO, no blame.
 */
export const metadata: Metadata = {
  title: 'Hors ligne',
  description: 'Tu es hors ligne. Reconnecte-toi pour retrouver ton espace Fxmily.',
};

// Fully static — no request-time data.
export const dynamic = 'force-static';

export default function OfflinePage(): React.ReactElement {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-16 text-center">
      {/* Ambient backplate — decorative, aria-hidden, reduced-motion safe. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="ds-aurora absolute inset-0 opacity-60" />
        <div
          className="ds-orb"
          style={{
            top: '-6rem',
            left: '50%',
            marginLeft: '-13rem',
            width: '26rem',
            height: '26rem',
            background: 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.28) 0%, transparent 70%)',
          }}
        />
      </div>

      <span
        aria-hidden="true"
        className="relative grid h-16 w-16 place-items-center rounded-full border border-[var(--b-strong)] bg-[var(--bg-2)] text-[var(--t-2)]"
      >
        <WifiOff className="h-7 w-7" strokeWidth={1.75} />
      </span>

      <div className="mt-6 max-w-md">
        <p className="text-[11px] font-medium tracking-[0.2em] text-[var(--t-3)] uppercase">
          Hors ligne
        </p>
        <h1 className="f-display mt-3 text-3xl leading-[1.05] font-medium tracking-[-0.02em] text-[var(--t-1)] sm:text-4xl">
          Tu es hors ligne
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--t-2)]">
          La connexion s&apos;est interrompue. Dès que le réseau revient, ton espace se recharge
          tout seul. Rien n&apos;est perdu.
        </p>
      </div>
    </main>
  );
}
