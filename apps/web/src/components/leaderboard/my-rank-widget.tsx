import { ArrowRight, Trophy } from 'lucide-react';
import Link from 'next/link';

import { MetricRing } from '@/components/dashboard/daily-completion-ring';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import { isLowScore, weakestPillar } from '@/lib/leaderboard/insights';
import { getMyLeaderboardRank } from '@/lib/leaderboard/service';

import { PILLAR_META_BY_KEY } from './pillar-meta';
import { RankMovementChip } from './rank-movement-chip';

/**
 * LeaderboardRankWidget — dashboard surfacing of the member's current standing,
 * the always-visible motivation to keep working (leaderboard "mis en avant sur
 * chaque compte"). Mirrors the Vérification link-card: icon + eyebrow + a rank
 * headline + the score ring, all a single tap into `/classement`. Async Server
 * Component; wrap in `<Suspense>` on the dashboard with the exported skeleton.
 */

function ordinal(rank: number): string {
  return rank === 1 ? '1re' : `${rank}e`;
}

export async function LeaderboardRankWidget({
  userId,
}: {
  userId: string;
}): Promise<React.ReactElement> {
  const mine = await getMyLeaderboardRank(userId);
  const ranked = mine !== null && mine.rank !== null && mine.score !== null;
  const onPodium = ranked && mine.rank !== null && mine.rank <= 3;

  // Personalized dashboard signals (read-time, no extra query — `breakdown` is
  // already on the React.cache-shared read). `weakest` names the lever to push;
  // `lowScore` surfaces a calm ambre "Score bas" flag so a member not doing the
  // work sees it on the dashboard, never shamed (SPEC §31.2, mirrors the card).
  // Gated `!onPodium` (mirrors MyRankCard): a top-3 member is never flagged low,
  // so the "Score bas" pill can't sit next to the "Tu es dans le top 3" headline.
  const lowScore = mine !== null && isLowScore(mine.score, mine.status) && !onPodium;
  const weakestKey = ranked && mine?.breakdown ? weakestPillar(mine.breakdown.parts) : null;
  const weakest = weakestKey ? PILLAR_META_BY_KEY[weakestKey] : null;

  const headline = !ranked
    ? 'Bientôt au classement'
    : onPodium
      ? 'Tu es dans le top 3'
      : `${ordinal(mine.rank!)} sur ${mine.totalRanked}`;

  const description = !ranked
    ? 'Encore quelques jours de check-ins et ton nom apparaît. Le classement mesure ton travail, pas tes gains.'
    : onPodium
      ? 'Continue ton travail au quotidien pour tenir ta place sur le podium.'
      : lowScore
        ? weakest
          ? `Ton score est bas en ce moment. Commence par ${weakest.label}.`
          : 'Ton score est bas en ce moment. Un check-in aujourd’hui te relance.'
        : weakest
          ? `Ton meilleur levier pour grimper : ${weakest.label}.`
          : 'Ton classement sur le travail et la régularité. Grimpe en restant fidèle à ton process.';

  return (
    <HoverLift className="block h-full">
      <Link
        href="/classement"
        className="rounded-card card-premium flex h-full items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-1)] text-[var(--acc-hi)]"
          >
            <Trophy className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 space-y-1">
            <span className="t-eyebrow text-[var(--t-3)]">Classement</span>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-[var(--t-1)]">{headline}</p>
              {ranked ? <RankMovementChip movement={mine.movement} /> : null}
              {lowScore ? (
                <Pill tone="warn" dot>
                  Score bas
                </Pill>
              ) : null}
            </div>
            <p className="text-[12px] leading-relaxed text-[var(--t-3)]">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {ranked ? (
            <MetricRing
              value={mine.score ?? 0}
              max={100}
              suffix="/100"
              ariaLabel={`Ton score de travail : ${mine.score} sur 100.`}
            />
          ) : null}
          <ArrowRight className="h-5 w-5 shrink-0 text-[var(--t-3)]" aria-hidden="true" />
        </div>
      </Link>
    </HoverLift>
  );
}

/** Layout-matched skeleton for the dashboard `<Suspense>` boundary. */
export function LeaderboardRankSkeleton(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="rounded-card flex h-full min-h-[92px] items-center justify-between gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-4"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-control h-9 w-9 shrink-0 animate-pulse bg-[var(--bg-3)] motion-reduce:animate-none" />
        <div className="space-y-2">
          <div className="h-2.5 w-20 animate-pulse rounded bg-[var(--bg-3)] motion-reduce:animate-none" />
          <div className="h-3.5 w-28 animate-pulse rounded bg-[var(--bg-3)] motion-reduce:animate-none" />
        </div>
      </div>
      <div className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-[var(--bg-3)] motion-reduce:animate-none" />
    </div>
  );
}
