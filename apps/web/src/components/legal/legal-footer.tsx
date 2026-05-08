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
      className="bg-[var(--bg-1)]/40 mt-auto border-t border-[var(--b-subtle)] backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-5 text-xs text-[var(--t-3)] sm:flex-row sm:items-center sm:justify-between">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-[var(--t-2)]">Fxmily</span>
          <span aria-hidden="true">·</span>
          <span>© {year}</span>
          <span aria-hidden="true">·</span>
          <span>Suivi comportemental — pas de conseil de trade.</span>
        </p>
        <nav aria-label="Liens légaux" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/legal/privacy"
            className="rounded px-1 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            Confidentialité
          </Link>
          <span aria-hidden="true" className="text-[var(--t-4)]">
            ·
          </span>
          <Link
            href="/legal/terms"
            className="rounded px-1 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            CGU
          </Link>
          <span aria-hidden="true" className="text-[var(--t-4)]">
            ·
          </span>
          <Link
            href="/legal/mentions"
            className="rounded px-1 hover:text-[var(--t-1)] focus-visible:text-[var(--t-1)]"
          >
            Mentions légales
          </Link>
        </nav>
      </div>
    </footer>
  );
}
