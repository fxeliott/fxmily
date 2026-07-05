import { Clock, Layers } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { safeTimeZone } from '@/lib/checkin/timezone';
import type { SerializedTrainingSession } from '@/lib/training/training-session-service';

/**
 * Read-only backtest-session row (S8 Mode Entraînement). Pure presentation,
 * DS-v2 cyan tokens. Used on the `/training` landing (member) and the admin
 * member training tab — wrapped in a `<Link>` by the caller (mirror
 * `training-trade-card` + `training-trade-card-linkable`).
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): consumes `SerializedTrainingSession` only;
 * it never feeds the real edge.
 */

function formatDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: safeTimeZone(timezone),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function TrainingSessionCard({
  session,
  timezone = 'Europe/Paris',
}: {
  session: SerializedTrainingSession;
  timezone?: string;
}) {
  const title = session.label?.trim() || 'Session sans nom';
  const isEnded = session.endedAt != null;

  return (
    <Card className="group/ts relative flex flex-col gap-3 p-4">
      {/* S18 — identité CYAN training (§21.7) : liseré supérieur décoratif cyan,
          décoratif (pointer-events:none), s'intensifie quand la carte est survolée
          via le Link parent. JAMAIS le bleu CTA --acc (non-confusabilité §21.5). */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 right-3 left-3 z-10 h-px opacity-70 transition-opacity duration-200 group-hover/ts:opacity-100"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, var(--cy-edge) 50%, transparent 100%)',
        }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow inline-flex items-center gap-1.5 text-[var(--cy)]">
            <Layers className="h-3.5 w-3.5" strokeWidth={2} />
            Session de backtest
          </span>
          <span className="f-display truncate text-[16px] leading-[1.2] font-semibold text-[var(--t-1)]">
            {title}
          </span>
        </div>
        <Pill tone={isEnded ? 'mute' : 'cy'} dot={isEnded ? false : 'live'}>
          {isEnded ? 'Terminée' : 'En cours'}
        </Pill>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {session.symbol ? <Pill tone="mute">{session.symbol}</Pill> : null}
        {session.timeframe ? <Pill tone="mute">{session.timeframe}</Pill> : null}
        <span className="t-cap inline-flex items-center gap-1 text-[var(--t-4)] tabular-nums">
          <Clock className="h-3 w-3" strokeWidth={1.75} />
          {formatDate(new Date(session.startedAt), timezone)}
        </span>
      </div>

      <div className="border-t border-[var(--b-subtle)] pt-3">
        <span className="f-mono text-[14px] font-semibold text-[var(--t-1)] tabular-nums">
          {session.tradeCount}
        </span>{' '}
        <span className="t-cap text-[var(--t-3)]">
          backtest{session.tradeCount > 1 ? 's' : ''} dans cette séance
        </span>
      </div>
    </Card>
  );
}
