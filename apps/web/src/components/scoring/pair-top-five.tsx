import type { PairPerf } from '@/lib/scoring/dashboard-data';
import { cn } from '@/lib/utils';

/**
 * Top-5 traded pairs with win-rate + average R (J6, SPEC §7.5).
 *
 * Server Component. Posture: surface "where do you actually play?" without
 * coaching the member toward / away from any pair (zero market analysis).
 */
interface PairTopFiveProps {
  pairs: ReadonlyArray<PairPerf>;
}

export function PairTopFive({ pairs }: PairTopFiveProps) {
  return (
    <div className="rounded-card-lg flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Top 5 paires</span>
        <span className="t-mono-cap text-[var(--t-4)]">par volume de trades</span>
      </div>
      {pairs.length === 0 ? (
        <p className="t-cap py-6 text-center text-[var(--t-4)]">Pas encore de trades clôturés.</p>
      ) : (
        <table className="w-full">
          <thead className="sr-only">
            <tr>
              <th>Paire</th>
              <th>Trades</th>
              <th>Win rate</th>
              <th>R moyen</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.pair} className="border-t border-[var(--b-subtle)]">
                <td className="py-2">
                  <span className="f-mono text-[13px] font-semibold text-[var(--t-1)]">
                    {p.pair}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span className="t-cap text-[var(--t-3)]">{p.trades} t</span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      't-mono-cap',
                      p.winRate >= 0.55
                        ? 'text-[var(--ok)]'
                        : p.winRate >= 0.45
                          ? 'text-[var(--t-1)]'
                          : 'text-[var(--bad)]',
                    )}
                  >
                    {(p.winRate * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="py-2 text-right">
                  <span
                    className={cn(
                      'f-mono text-[12px] tabular-nums',
                      p.avgR > 0
                        ? 'text-[var(--acc)]'
                        : p.avgR < 0
                          ? 'text-[var(--bad)]'
                          : 'text-[var(--t-3)]',
                    )}
                  >
                    {p.avgR > 0 ? '+' : ''}
                    {p.avgR.toFixed(2)}R
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
