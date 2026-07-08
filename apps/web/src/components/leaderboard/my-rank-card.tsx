import { Compass, Crown, Sparkles, TrendingUp } from 'lucide-react';

import { MetricRing } from '@/components/dashboard/daily-completion-ring';
import { isLowScore, weakestPillar } from '@/lib/leaderboard/insights';
import type { LeaderboardRowView, RankMovement } from '@/lib/leaderboard/service';

import { Avatar } from '../ui/avatar';
import { Card } from '../ui/card';
import { Pill } from '../ui/pill';
import { PILLAR_META_BY_KEY } from './pillar-meta';
import { RankBreakdown } from './rank-breakdown';
import { RankMovementChip } from './rank-movement-chip';

/**
 * MyRankCard — the viewer's OWN standing, given pride of place at the top of
 * the board so every member lands first on "where do I sit, and what do I push
 * to climb ?". Three shapes, one calm frame (SPEC §2, no FOMO):
 *
 *   - ranked      → rank chip "N sur M", score ring, the pillar breakdown, and
 *                   a motivating next-step (climb to the podium, or hold it).
 *   - in-podium   → same, with a "tu es sur le podium" reinforcement.
 *   - not-yet     → insufficient data: a warm "presque là" instead of a rank,
 *                   pointing at the daily check-in as the way in.
 *
 * The gap-to-podium is computed from the real 3rd-place score passed by the
 * page, so the encouragement is honest ("il te manque N points"), never a
 * fabricated target.
 */

interface MyRankCardProps {
  me: LeaderboardRowView;
  totalRanked: number;
  /** Score of the current 3rd place, for the honest "gap to podium" line. */
  thirdScore: number | null;
  /** Rank delta since the viewer's previous ranked snapshot (movement chip). */
  movement?: RankMovement | null;
  /** True when this board is a fresh entry into the top 3 (celebration). */
  enteredTop3?: boolean;
}

export function MyRankCard({
  me,
  totalRanked,
  thirdScore,
  movement = null,
  enteredTop3 = false,
}: MyRankCardProps): React.ReactElement {
  const ranked = me.rank !== null && me.score !== null;
  const onPodium = ranked && me.rank !== null && me.rank <= 3;
  // Honest gap to the podium, in DISPLAYED (rounded) points. Ranking is decided
  // on the full-precision composite, so a rank-4 member can share the rounded
  // score of rank-3 (84.2 and 84.4 both show 84) or lose the podium purely on a
  // tie-break. Only surface the gap when it is STRICTLY positive: a rounded gap
  // of 0 (or a negative clamped away) must NOT render "il te manque 0 point pour
  // entrer dans le top 3" (self-contradictory for an off-podium member) — it
  // falls through to the generic "continue pour grimper" line instead.
  const rawGap =
    ranked && !onPodium && thirdScore !== null && me.score !== null ? thirdScore - me.score : null;
  const gapToPodium = rawGap !== null && rawGap > 0 ? rawGap : null;

  // Personalized signals (read-time, migration-free — same `breakdown` the card
  // already holds). `weakest` = the lever with the most room to climb, so the
  // motivation is "adapté pour chaque membre". `lowScore` = a genuinely low
  // composite → a calm, actionable alert (ambre `--warn`, never P&L-red): it
  // shows a member who is not doing the work WITHOUT shaming them (SPEC §31.2).
  const weakestKey = ranked ? weakestPillar(me.breakdown.parts) : null;
  const weakest = weakestKey ? PILLAR_META_BY_KEY[weakestKey] : null;
  // Never alert a podium member: rank 1-3 with a low composite is possible
  // (a small board where even the leader is early), and pairing "sur le podium"
  // with "ton score est bas" would be self-contradictory. The podium members
  // get the celebratory reinforcement instead; the alert is for everyone else.
  const lowScore = isLowScore(me.score, me.status) && !onPodium;

  return (
    <Card primary glass edge={false} className="dash-hero relative overflow-hidden p-5 sm:p-6">
      <div className="relative flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar
            url={me.avatarUrl}
            initials={me.initials}
            firstName={me.firstName}
            size={64}
            ring
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--acc-hi)]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              Ton classement
            </span>
            <p className="truncate text-[18px] font-semibold text-[var(--t-1)]">{me.firstName}</p>
            {ranked ? (
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={onPodium ? 'acc' : 'cy'} dot>
                  {onPodium ? (
                    <>
                      <Crown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                      Sur le podium
                    </>
                  ) : (
                    <>
                      {me.rank}
                      {ordinalSuffix(me.rank!)} sur {totalRanked}
                    </>
                  )}
                </Pill>
                {movement ? <RankMovementChip movement={movement} /> : null}
              </div>
            ) : (
              <Pill tone="warn" dot>
                Presque au classement
              </Pill>
            )}
          </div>
          {ranked ? (
            <div className="hidden shrink-0 sm:block">
              <MetricRing
                value={me.score ?? 0}
                max={100}
                suffix="/100"
                ariaLabel={`Ton score de travail : ${me.score} sur 100.`}
              />
            </div>
          ) : null}
        </div>

        {/* Fresh top-3 entry celebration (in-app echo, migration-free). Shown
            once the viewer newly reaches the podium, never re-fired while they
            simply hold it. */}
        {enteredTop3 ? (
          <div
            role="status"
            className="rounded-control flex items-center gap-2.5 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3 py-2.5"
          >
            <Sparkles
              className="h-4 w-4 shrink-0 text-[var(--acc-hi)]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-[13px] leading-relaxed font-medium text-[var(--t-1)]">
              Bravo, tu viens d&apos;entrer dans le top 3. Tiens ta place en restant fidèle à ton
              process.
            </p>
          </div>
        ) : null}

        {/* Low-score alert (in-app echo, migration-free). A calm, actionable
            nudge for a member genuinely not doing the work — ambre `--warn`,
            NEVER red `--bad` (which is reserved for P&L). It shows "if they're
            working" without ever shaming, and points at the one lever to restart
            with. Gated `!onPodium` (see `lowScore` above): a podium member is
            reinforced, never alerted, so the two messages can't contradict. */}
        {lowScore ? (
          <div
            role="status"
            className="rounded-control flex items-start gap-2.5 border border-[var(--warn-edge)] bg-[var(--warn-dim)] px-3 py-2.5"
          >
            <Compass
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn)]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-[13px] leading-relaxed text-[var(--t-1)]">
              Ton score de travail est bas en ce moment. Rien de grave, ça se rattrape vite.
              {weakest ? (
                <>
                  {' '}
                  Commence par <strong className="font-semibold">{weakest.label}</strong> :{' '}
                  {weakest.push}
                </>
              ) : (
                ' Un check-in aujourd’hui et tu repars.'
              )}
            </p>
          </div>
        ) : null}

        {/* Motivation line, honest + calm. Skipped for a low-score member — the
            warn block above already carries their personalized next step. */}
        {ranked && !lowScore ? (
          <p className="inline-flex items-start gap-2 text-[13px] leading-relaxed text-[var(--t-2)]">
            <TrendingUp
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acc-hi)]"
              strokeWidth={2}
              aria-hidden="true"
            />
            {onPodium ? (
              <span>
                Tu es dans le top 3. Continue ton travail au quotidien pour tenir ta place.
              </span>
            ) : (
              <span>
                {gapToPodium !== null ? (
                  <>
                    Il te manque{' '}
                    <strong className="font-semibold text-[var(--t-1)]">
                      {gapToPodium} point{gapToPodium > 1 ? 's' : ''}
                    </strong>{' '}
                    pour entrer dans le top 3.
                  </>
                ) : (
                  'Continue ton travail au quotidien pour grimper dans le classement.'
                )}
                {weakest ? (
                  <>
                    {' '}
                    Ton meilleur levier en ce moment :{' '}
                    <strong className="font-semibold text-[var(--t-1)]">
                      {weakest.label}
                    </strong>, {weakest.push}
                  </>
                ) : null}
              </span>
            )}
          </p>
        ) : !ranked ? (
          <p className="text-[13px] leading-relaxed text-[var(--t-2)]">
            Encore quelques jours de check-ins et ton nom apparaîtra au classement. Le classement
            mesure ton travail et ta régularité, pas tes résultats de trading.
          </p>
        ) : null}

        <div className="border-t border-[var(--b-subtle)] pt-4">
          <p className="t-eyebrow mb-3 text-[var(--t-3)]">Pourquoi ce classement</p>
          <RankBreakdown breakdown={me.breakdown} />
        </div>
      </div>
    </Card>
  );
}

/** French ordinal suffix: 1 → "re", everything else → "e". */
function ordinalSuffix(rank: number): string {
  return rank === 1 ? 're' : 'e';
}
