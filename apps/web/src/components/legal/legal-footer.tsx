import Link from 'next/link';

/**
 * Global footer wired from `app/layout.tsx`. Surfaces the three RGPD legal
 * pages required by SPEC §15 J10 + §16 :
 *
 *  - `/legal/privacy` — Politique de confidentialité (RGPD)
 *  - `/legal/terms`   — CGU
 *  - `/legal/mentions` — Mentions légales
 *
 * Plus a `mailto:` link to the editor (Eliot) and the build year.
 *
 * Server Component, zero JS shipped to the client. Visible site-wide because
 * a working RGPD claim cannot be one-click-away from any page.
 */
export function LegalFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer
      role="contentinfo"
      className="mt-auto border-t border-[var(--b-subtle)] bg-[var(--bg-1)]/40 backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 text-xs text-[var(--t-3)] sm:flex-row sm:items-center sm:justify-between">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[var(--t-2)]">Fxmily</span>
          <span aria-hidden="true">·</span>
          <span>© {year}</span>
          <span aria-hidden="true">·</span>
          <span>Suivi comportemental — pas de conseil de trade.</span>
        </p>
        {/*
          Touch target ≥ 24×24 (WCAG 2.5.8 AA — J10 Phase G a11y B3).
          `py-1.5` (12px vertical padding) gives ~24px hit-area on the
          ~12px line-height links. Inline focus-ring for clarity (the
          global `*:focus-visible` ring still applies via cascade — kept
          here explicit for immediate intent).
        */}
        <nav aria-label="Liens légaux" className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <Link
            href="/legal/privacy"
            className="inline-flex min-h-6 items-center rounded px-2 py-1.5 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            Confidentialité
          </Link>
          <span aria-hidden="true" className="text-[var(--t-4)]">
            ·
          </span>
          <Link
            href="/legal/terms"
            className="inline-flex min-h-6 items-center rounded px-2 py-1.5 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            CGU
          </Link>
          <span aria-hidden="true" className="text-[var(--t-4)]">
            ·
          </span>
          <Link
            href="/legal/mentions"
            className="inline-flex min-h-6 items-center rounded px-2 py-1.5 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            Mentions légales
          </Link>
        </nav>
      </div>
    </footer>
  );
}
