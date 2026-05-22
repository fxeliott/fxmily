import { Calculator, Database, Filter, FileSearch } from 'lucide-react';

interface MethodCol {
  Icon: typeof Calculator;
  title: string;
  body: string;
}

const COLS: readonly MethodCol[] = [
  {
    Icon: Calculator,
    title: 'Calcul',
    body: 'Σ % cumulé arithmétique (pas composé). Expectancy = winRate × avgWinR + lossRate × avgLossR (Van Tharp). Profit Factor cap à ∞ sans pertes.',
  },
  {
    Icon: Database,
    title: 'Source',
    body: 'Export ODS verbatim → JSON typé Prisma. 139 lignes, ordinaux séquentiels 1..N. Valeur pl_val (cellule typée) autoritaire pour le %.',
  },
  {
    Icon: Filter,
    title: 'Exclusions',
    body: 'Aucune. Aucune période exclue. Aucun trade retiré. Pas de cherry-pick par construction. BE / Stop / Profit affichés selon convention finance.',
  },
  {
    Icon: FileSearch,
    title: 'Audit',
    body: 'Résultats vérifiables par la cohorte de membres présents en réunion live. Conforme Règlement Général AMF en vigueur. Code source ouvert.',
  },
];

/**
 * Methodology band 4 colonnes — pattern Mercury "How we calculate" /
 * Bloomberg statement methodology row. Placée entre KPI strip et charts,
 * AVANT que l'investisseur regarde les courbes — il doit savoir COMMENT
 * les chiffres sont calculés.
 *
 * Audit ui-designer 2026-05-22 priorité 3.
 */
export function MethodologyBand() {
  return (
    <section
      aria-labelledby="methodology-heading"
      className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)]"
    >
      <header className="border-b border-[var(--tr-b-subtle)] px-5 py-3">
        <h2
          id="methodology-heading"
          className="text-[11px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase"
        >
          Méthodologie · comment ce track record est calculé et vérifié
        </h2>
      </header>
      <div className="grid grid-cols-1 divide-y divide-[var(--tr-b-subtle)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {COLS.map((c) => {
          const Icon = c.Icon;
          return (
            <article key={c.title} className="px-5 py-4 sm:py-5 lg:divide-[var(--tr-b-subtle)]">
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-[var(--tr-acc-hi)]" aria-hidden />
                <h3 className="text-[12px] font-semibold tracking-[0.04em] text-[var(--tr-t-1)] uppercase">
                  {c.title}
                </h3>
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--tr-t-2)]">{c.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
