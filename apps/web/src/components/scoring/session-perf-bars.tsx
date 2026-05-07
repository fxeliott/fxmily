import type { SessionPerf } from '@/lib/scoring/dashboard-data';
import { cn } from '@/lib/utils';

/**
 * Per-session performance breakdown (J6, SPEC §7.5).
 *
 * Server Component, pure HTML/CSS. Each session shows the trade volume
 * (relative bar) + win-rate + avg R. The bar widths are normalized to the
 * busiest session = 100% width.
 */
interface SessionPerfBarsProps {
  sessions: ReadonlyArray<SessionPerf>;
}

export function SessionPerfBars({ sessions }: SessionPerfBarsProps) {
  const maxVolume = Math.max(1, ...sessions.map((s) => s.trades));

  return (
    <div className="rounded-card-lg flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="t-eyebrow">Performance par session</span>
        <span className="t-mono-cap text-[var(--t-4)]">UTC bands</span>
      </div>
      <ul className="flex flex-col gap-2">
        {sessions.map((s) => {
          const volPct = (s.trades / maxVolume) * 100;
          return (
            <li key={s.session} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-[var(--t-1)]">{s.label}</span>
                <span className="flex items-center gap-3">
                  <span className="t-mono-cap text-[var(--t-4)]">{s.trades} trades</span>
                  <span
                    className={cn(
                      't-mono-cap',
                      s.winRate >= 0.55
                        ? 'text-[var(--ok)]'
                        : s.winRate >= 0.45
                          ? 'text-[var(--t-1)]'
                          : 'text-[var(--bad)]',
                    )}
                  >
                    {(s.winRate * 100).toFixed(0)}%
                  </span>
                  <span
                    className={cn(
                      'f-mono w-14 text-right text-[12px] tabular-nums',
                      s.avgR > 0
                        ? 'text-[var(--acc)]'
                        : s.avgR < 0
                          ? 'text-[var(--bad)]'
                          : 'text-[var(--t-3)]',
                    )}
                  >
                    {s.avgR > 0 ? '+' : ''}
                    {s.avgR.toFixed(2)}R
                  </span>
                </span>
              </div>
              <div className="rounded-pill h-1.5 overflow-hidden bg-[var(--bg-2)]">
                <div
                  className={cn(
                    'rounded-pill h-full transition-[width]',
                    s.avgR > 0
                      ? 'bg-[var(--acc)]'
                      : s.avgR < 0
                        ? 'bg-[var(--bad)]'
                        : 'bg-[var(--t-4)]',
                  )}
                  style={{ width: `${Math.max(2, volPct)}%` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
