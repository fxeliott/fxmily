import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

import { LegalToc } from './legal-toc';

interface LegalLayoutProps {
  /** Top-level legal page heading (h1). */
  title: string;
  /** Date the document was last reviewed by the editor (Eliott). Format ISO `YYYY-MM-DD`. */
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
 * Visual posture : DS-v3 token-driven card, blue `--acc` accent on eyebrow +
 * last-updated pill, generous reading width (max-w-3xl), prose-style spacing on
 * children. A very discreet brand wash sits behind the header and the content
 * fades in softly on entrance — sober only : these pages exist to inform, not
 * to sell. No hero, no tilt, no gradient border.
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
    <main className="relative mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      {/* Ambient brand wash — purely decorative, sits behind the header only.
          Very low opacity + a top-to-transparent mask so it reads as a faint
          tint of colour, never a marketing banner. `aria-hidden`, no pointer
          interaction. Sober elevation for an "inform, not sell" surface. */}
      <div
        aria-hidden="true"
        className="surf-grad-soft pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 [mask-image:linear-gradient(to_bottom,black,transparent)] opacity-50"
      />
      <header className="wow-reveal relative mb-6">
        {/* Discreet brand emblem — a small token-driven SVG sigil (a stylised
            "F" stroke inside a soft ring) anchored top-right of the header. Pure
            decoration (aria-hidden), token colours so it flips in light + folds
            under forced-colors via currentColor. It signs the page as Fxmily
            without ever reading as a marketing hero. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 48 48"
          className="pointer-events-none absolute top-0 right-0 hidden h-12 w-12 opacity-70 sm:block"
        >
          <circle cx="24" cy="24" r="21" fill="none" stroke="var(--b-acc)" strokeWidth="1.25" />
          <circle
            cx="24"
            cy="24"
            r="15"
            fill="none"
            stroke="var(--b-acc)"
            strokeWidth="0.75"
            opacity="0.6"
          />
          <path
            d="M18 32V16h12M18 24h9"
            fill="none"
            stroke="var(--acc)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <Link
          href={backHref}
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label={`Retour : ${backLabel}`}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {backLabel}
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.18em] text-[var(--acc)] uppercase">
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

      {/* S19.2 — progressive-enhancement TOC (sibling of the article so the
          prose `[&_a]` styles don't bleed into its links). */}
      <LegalToc />

      <article
        data-legal-body
        className={cn(
          'wow-reveal rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 transition-colors duration-200 hover:border-[var(--b-acc)] sm:p-7',
          // Accent liseré on hover of each prose section : the h2 grows a soft
          // left rule in --acc-dim, a discreet cue that signs the section as
          // brand-accented without shifting layout (border on the existing
          // padding box). Compositor-safe (colour only), folds in forced-colors.
          '[&_h2]:-ml-3 [&_h2]:border-l-2 [&_h2]:border-l-transparent [&_h2]:pl-3 [&_h2]:transition-colors [&_h2]:duration-200 hover:[&_h2]:border-l-[var(--acc-dim)]',
          // Compact prose ramp aligned with DS-v3 spacing tokens. h2 ramp
          // bumped from text-base to text-[15px] sm:text-base for a stronger
          // hierarchy contrast vs the h1 (24-30 px) on long legal pages
          // (UI designer T2-6 — J10 Phase I).
          '[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[var(--t-1)] sm:[&_h2]:text-base [&_h2:first-child]:mt-0',
          '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[var(--t-1)]',
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
