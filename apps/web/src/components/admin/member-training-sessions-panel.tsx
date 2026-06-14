import { Layers } from 'lucide-react';
import Link from 'next/link';

import { TrainingSessionCard } from '@/components/training/training-session-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { SerializedTrainingSession } from '@/lib/training/training-session-service';

/**
 * Backtest-sessions list for the admin member training tab (S8 — carbon mirror
 * of `member-training-panel.tsx`). Each row links to
 * `/admin/members/[id]/training/sessions/[sessionId]` — the admin-scoped
 * session detail that lists the backtests inside it, each drilling into the
 * existing annotate page.
 *
 * 🚨 STATISTICAL ISOLATION (§21.5): consumes `SerializedTrainingSession` only;
 * the link stays on the `/admin/members/[id]/training/*` surface.
 */
export function MemberTrainingSessionsPanel({
  memberId,
  sessions,
}: {
  memberId: string;
  sessions: SerializedTrainingSession[];
}) {
  if (sessions.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={Layers}
          headline="Aucune session de backtest."
          lead="Les séances de backtest du membre apparaîtront ici dès qu'il en ouvrira une."
        />
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {sessions.map((s) => (
        <li key={s.id}>
          <Link
            href={`/admin/members/${memberId}/training/sessions/${s.id}`}
            aria-label={`Voir la session ${s.label?.trim() || 'sans nom'} (${s.tradeCount} backtest${s.tradeCount > 1 ? 's' : ''})`}
            className="rounded-card block transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cy)]"
          >
            <TrainingSessionCard session={s} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
