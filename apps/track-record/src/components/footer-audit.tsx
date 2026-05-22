interface FooterAuditProps {
  closedTrades: number;
  totalTrades: number;
  months: number;
  instruments: number;
  /** Build identifier — defaults to year (no git sha in static export). */
  buildId?: string;
}

/**
 * Footer audit Bloomberg-grade — pattern Mercury statement footer / Darwinex
 * methodology footer. Source / méthode / dernière sync / build / disclaimer
 * légal compact. Pas de social links, pas de marketing, juste de l'audit.
 *
 * Audit ui-designer 2026-05-22 priorité 5.
 */
export function FooterAudit({
  closedTrades,
  totalTrades,
  months,
  instruments,
  buildId,
}: FooterAuditProps) {
  const buildLabel = buildId ?? `${new Date().getFullYear()}-public-v1`;

  return (
    <footer className="border-t border-[var(--tr-b-subtle)] bg-[var(--tr-bg)]">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-7">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-t-3)] uppercase">
              Sources
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--tr-t-2)]">
              Export ODS verbatim · JSON typé · {totalTrades} lignes · {closedTrades} clôturés ·{' '}
              {instruments} instruments
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-t-3)] uppercase">
              Méthode
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--tr-t-2)]">
              % cumulé arithmétique · R-multiple Van Tharp · Aucune exclusion · Pertes affichées
              avec la même prégnance que les gains
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-t-3)] uppercase">
              Limitations
            </div>
            <p className="text-[11.5px] leading-relaxed text-[var(--tr-t-2)]">
              {months} mois documentés. Sample size limité. Variance normale ≠ edge cassé (Van Tharp
              loss-streak rule).
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-medium tracking-[0.1em] text-[var(--tr-t-3)] uppercase">
              Build
            </div>
            <p className="font-mono text-[11.5px] leading-relaxed text-[var(--tr-t-3)] tabular-nums">
              {buildLabel}
              <br />
              Cloudflare Pages · static export
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-[var(--tr-b-subtle)] pt-5">
          <p className="font-mono text-[10.5px] leading-relaxed text-[var(--tr-t-3)] tabular-nums">
            © Fxmily · {new Date().getFullYear()} · Track record public · Performances passées ne
            préjugent pas des performances futures · Conforme Règlement Général AMF en vigueur.
          </p>
        </div>
      </div>
    </footer>
  );
}
