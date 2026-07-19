import Link from 'next/link';
import { ArrowRight, Clock, MessageSquare, Scale, TrendingDown } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';
import type { MemberAttention } from '@/lib/admin/attention-service';
import type { SerializedBehavioralScore } from '@/lib/scoring/service';

/**
 * J6-admin-scale (scope 3) — member synthesis banner.
 *
 * Sits ABOVE the tab strip on `/admin/members/[id]`, so the admin keeps the
 * member's key signals in view on EVERY tab (not just the overview). Pure,
 * read-only presentational Server Component: every value is pre-computed by
 * the page from services it already loads (`getMembersAttention` +
 * `getLatestBehavioralScore` cache()-wrapped + `getMemberDetail`). No data
 * fetch, no new query, no N+1.
 *
 * POSTURE (SPEC §2, mirror `MemberAttentionBadges`): calm coaching signal,
 * never a punitive verdict. Actionable states are amber (warn) or accent, the
 * quiet baseline is muted — RED is reserved for trade outcomes / hard failures
 * (kept out of this banner entirely). Clickable counts deep-link to the tab
 * that resolves them (`?tab=…`).
 */
interface MemberSynthesisBannerProps {
  memberId: string;
  /** ISO string of the member's last session, or null if never seen. */
  lastSeenAt: string | null;
  /**
   * The member is drifting (active + unseen past the 7-day horizon). Computed
   * page-side from the canonical `DISENGAGED_AFTER_MS` so the banner mirrors
   * the `/admin/a-traiter` "décrochage" list without importing server-only code.
   */
  disengaged: boolean;
  /** Batched triage flags — the blessed `getMembersAttention` reuse. */
  attention: MemberAttention;
  /** Latest behavioral snapshot, or null before the first nightly compute. */
  score: SerializedBehavioralScore | null;
}

type Tone = 'mute' | 'acc' | 'warn';

const TONE_TEXT: Record<Tone, string> = {
  mute: 'text-[var(--t-2)]',
  acc: 'text-[var(--acc-hi)]',
  warn: 'text-[var(--warn)]',
};

/** null → « Jamais vu », else a calm relative-day label from `lastSeenAt`. */
function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Jamais vu';
  const days = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  return `Il y a ${days} j`;
}

function SignalCell({
  icon: Icon,
  label,
  value,
  tone,
  sub,
  href,
}: {
  icon: typeof Clock;
  label: string;
  value: string | number;
  tone: Tone;
  sub?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="t-eyebrow-lg flex items-center gap-1 text-[var(--t-3)]">
        <Icon aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        {label}
      </span>
      <span className={cn('text-[15px] leading-tight font-medium tabular-nums', TONE_TEXT[tone])}>
        {value}
      </span>
      {sub ? <span className="t-cap text-[var(--warn)]">{sub}</span> : null}
    </>
  );

  const base =
    'rounded-card flex min-h-[3.5rem] flex-col justify-center gap-0.5 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2';

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          'transition-colors hover:border-[var(--b-strong)] hover:bg-[var(--bg-2)]',
          'focus-visible:outline-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}

function ScoreCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-card flex flex-col gap-0.5 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2">
      <span className="t-eyebrow-lg text-[var(--t-3)]">{label}</span>
      <span className="text-[15px] leading-tight font-medium text-[var(--t-1)] tabular-nums">
        {value === null ? (
          // Honest « non calculé » (repo convention, harmonised with the scoring
          // cards) rather than a fabricated 0 for a dimension with no snapshot.
          <span className="text-[13px] font-normal text-[var(--t-4)]">non calculé</span>
        ) : (
          <>
            {value}
            <span className="ml-0.5 text-[11px] font-normal text-[var(--t-4)]">/100</span>
          </>
        )}
      </span>
    </div>
  );
}

export function MemberSynthesisBanner({
  memberId,
  lastSeenAt,
  disengaged,
  attention,
  score,
}: MemberSynthesisBannerProps) {
  const { tradesToComment, openDiscrepancies, constancyDeclining } = attention;

  // How many signals ask for the admin's eyes right now — drives the header
  // pill (calm « À jour » when nothing pends).
  const pending =
    (disengaged ? 1 : 0) +
    (tradesToComment > 0 ? 1 : 0) +
    (openDiscrepancies > 0 ? 1 : 0) +
    (constancyDeclining ? 1 : 0);

  const overviewHref = `/admin/members/${memberId}`;
  const tradesHref = `/admin/members/${memberId}?tab=trades`;
  const verificationHref = `/admin/members/${memberId}?tab=verification`;

  return (
    <section aria-labelledby="member-synthesis-heading">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 id="member-synthesis-heading" className="t-eyebrow-lg text-[var(--t-3)]">
            Synthèse
          </h2>
          {pending === 0 ? (
            <Pill tone="ok">À jour</Pill>
          ) : (
            <Pill tone="warn">{pending} à suivre</Pill>
          )}
        </div>

        {/* Triage signals — décrochage + the blessed getMembersAttention flags. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SignalCell
            icon={Clock}
            label="Activité"
            value={formatLastSeen(lastSeenAt)}
            tone={disengaged ? 'warn' : 'mute'}
            {...(disengaged ? { sub: 'En décrochage' } : {})}
          />
          <SignalCell
            icon={MessageSquare}
            label="À commenter"
            value={tradesToComment}
            tone={tradesToComment > 0 ? 'acc' : 'mute'}
            href={tradesHref}
          />
          <SignalCell
            icon={Scale}
            label="Écarts ouverts"
            value={openDiscrepancies}
            tone={openDiscrepancies > 0 ? 'warn' : 'mute'}
            href={verificationHref}
          />
          <SignalCell
            icon={TrendingDown}
            label="Constance"
            value={constancyDeclining ? 'En baisse' : 'Stable'}
            tone={constancyDeclining ? 'warn' : 'mute'}
            href={verificationHref}
          />
        </div>

        {/* Behavioral score — compact read; full gauges live on the overview tab. */}
        <div className="flex flex-col gap-2 border-t border-[var(--b-default)] pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="t-eyebrow-lg text-[var(--t-3)]">Scores comportementaux</span>
            <Link
              href={overviewHref}
              className="t-cap focus-visible:outline-accent inline-flex items-center gap-0.5 text-[var(--acc-hi)] transition-colors hover:text-[var(--acc)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Détail
              <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
            </Link>
          </div>
          {score === null ? (
            <p className="t-body text-[var(--t-3)]">En attente du premier calcul.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ScoreCell label="Discipline" value={score.disciplineScore} />
              <ScoreCell label="Stabilité" value={score.emotionalStabilityScore} />
              <ScoreCell label="Cohérence" value={score.consistencyScore} />
              <ScoreCell label="Engagement" value={score.engagementScore} />
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
