import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

interface LegalLayoutProps {
  /** Top-level legal page heading (h1). */
  title: string;
  /** Date the document was last reviewed by the editor (Eliot). Format ISO `YYYY-MM-DD`. */
  lastUpdatedIso: string;
  /** Short eyebrow above the heading — e.g. "Confidentialité", "CGU". */
  eyebrow: string;
  /** Optional summary right below the heading (≤2 sentences). */
  summary?: ReactNode;
  /** Where the back-link points (default `/`). */
  backHref?: string;
  /** Label of the back-link (default "Accueil"). */
  backLabel?: string;
  children: ReactNode;
}

/**
 * Shared shell for the three RGPD legal pages (`/legal/privacy`,
 * `/legal/terms`, `/legal/mentions`). Server Component — keeps the bundle
 * lean (these pages are visited rarely but must stay reachable from the
 * authenticated app and the public surface).
 *
 * Visual posture : DS v2 deep-space card, lime accent on eyebrow + last
 * updated pill, generous reading width (max-w-3xl), prose-style spacing on
 * children. No hero animation : these pages exist to inform, not to sell.
 */
export function LegalLayout({
  title,
  lastUpdatedIso,
  eyebrow,
  summary,
  backHref = '/',
  backLabel = 'Accueil',
  children,
}: LegalLayoutProps): React.ReactElement {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <Link
          href={backHref}
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label={`Retour : ${backLabel}`}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {backLabel}
        </Link>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--acc)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          {title}
        </h1>
        {summary ? (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">{summary}</p>
        ) : null}
        <p className="mt-4 text-xs text-[var(--t-3)]">
          {/* `<Pill tone="mute">` for DS-coherence (J10 Phase G UI designer T2-5). */}
          <Pill tone="mute">Dernière mise à jour&nbsp;: {formatLastUpdated(lastUpdatedIso)}</Pill>
        </p>
      </header>

      <article
        className={cn(
          'rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-7',
          // Compact prose ramp aligned with DS v2 spacing tokens. h2 ramp
          // bumped from text-base to text-[15px] sm:text-base for a stronger
          // hierarchy contrast vs the h1 (24-30 px) on long legal pages
          // (UI designer T2-6 — J10 Phase I).
          '[&_h2:first-child]:mt-0 [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[var(--t-1)] sm:[&_h2]:text-base',
          '[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[var(--t-1)]',
          '[&_p]:my-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-[var(--t-2)]',
          '[&_ul]:my-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:text-sm [&_ul]:text-[var(--t-2)]',
          '[&_ol]:my-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:text-sm [&_ol]:text-[var(--t-2)]',
          '[&_a]:text-[var(--acc-hi)] [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-[var(--acc)]',
          '[&_strong]:font-semibold [&_strong]:text-[var(--t-1)]',
          '[&_code]:rounded [&_code]:bg-[var(--bg-2)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
        )}
      >
        {children}
      </article>
    </main>
  );
}

function formatLastUpdated(iso: string): string {
  // Pure formatter — keeps locale stable across SSR + client. We avoid
  // `Intl.DateTimeFormat` here because the legal page is RSC-only and we
  // don't want timezone drift in audits ("did the doc change at 23:00 UTC
  // or 00:00 CEST?"). Keep the date as the editor wrote it.
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  const months = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  const idx = Number(m) - 1;
  const monthName = idx >= 0 && idx < 12 ? months[idx] : m;
  return `${Number(d)} ${monthName} ${y}`;
}
