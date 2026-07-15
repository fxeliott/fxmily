import { ShieldOff, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { LeaderboardList } from '@/components/leaderboard/leaderboard-list';
import { MyRankCard } from '@/components/leaderboard/my-rank-card';
import { Podium } from '@/components/leaderboard/podium';
import { QualifyingSection } from '@/components/leaderboard/qualifying-section';
import { splitBoardByRank } from '@/lib/leaderboard/ranking';
import { getLeaderboardBoard, getMyLeaderboardRank } from '@/lib/leaderboard/service';

/**
 * `/classement` — the member Leaderboard (SPEC §2 posture).
 *
 * Ranks EVERY active member on the ACT of working: assiduité, discipline,
 * régularité, travail de suivi. NEVER on trading performance / gains (firewall
 * §21.5). Server Component, auth-gated to active members. Reads a nightly
 * snapshot via `getLeaderboardBoard` (opted-out members are hidden from others
 * but always see their own row). All states are covered: full board, short
 * board, viewer not-yet-ranked, and the pre-first-snapshot empty state.
 */

export const metadata: Metadata = {
  title: 'Classement',
  description:
    'Le classement des membres Fxmily, basé sur le travail, la discipline et la régularité au quotidien. Jamais sur les gains de trading.',
};
export const dynamic = 'force-dynamic';

export default async function ClassementPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/classement');
  }

  const board = await getLeaderboardBoard(session.user.id);
  // Split the board by TRUE rank, never by array position: opted-out members are
  // hidden from `board.rows` while keeping their real rank number, so a positional
  // slice would promote a rank-4 member into an empty podium slot and mislabel
  // everyone below (see `splitBoardByRank`). `thirdScore` comes straight from the
  // service (true rank-3 score, even when that member is hidden), so the podium,
  // the list, MyRankCard and the "gap to podium" line all tell one honest story.
  const { podium: podiumRows, rest } = splitBoardByRank(board.rows);
  const thirdScore = board.thirdScore;
  const hasBoard = board.date !== null && board.rows.length > 0;
  // J3 SCOPE 1 — the public "En qualification" list. Deliberately visible to
  // every active member (SPEC §16) so the whole cohort sees itself from day one,
  // even before anyone is ranked. Opt-out members are already filtered server-side
  // (they only appear in their own viewer's list). Empty until the first snapshot,
  // so `qualifying` is [] when `board.date` is null.
  const hasQualifying = board.qualifying.length > 0;
  // Rank movement + top-3-entry come from the light `getMyLeaderboardRank`
  // (React.cache()-shared with the dashboard widget + AppShell slot, so this is
  // not a second board query). Only fetched when the viewer has a row to enrich.
  const myRank = board.me ? await getMyLeaderboardRank(session.user.id) : null;

  return (
    <main className="relative bg-[var(--bg)]">
      {/* Ambient anti-fade backplate (decorative, -z-10, reduced-motion-safe). */}
      <DashboardAmbient />
      <div className="page-stagger relative mx-auto w-full max-w-4xl px-4 py-6 sm:py-10 lg:px-8">
        <header className="mb-6">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--acc-hi)]">
            <Trophy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Classement
          </span>
          <h1
            className="f-display h-rise mt-1 leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)]"
            style={{
              fontFeatureSettings: '"ss01" 1',
              fontSize: 'clamp(1.875rem, 1.5rem + 1.6vw, 2.5rem)',
            }}
          >
            Le classement des membres
          </h1>
          <p className="t-lead mt-2 max-w-[62ch]">
            Ici, on se classe sur le travail, pas sur les gains. Ta place récompense ta présence, ta
            discipline et ta régularité au quotidien. Monte dans le top 3 en restant fidèle à ton
            process.
          </p>
        </header>

        {board.me ? (
          <div className="mb-8">
            <MyRankCard
              me={board.me}
              totalRanked={board.totalRanked}
              thirdScore={thirdScore}
              movement={myRank?.movement ?? null}
              enteredTop3={myRank?.enteredTop3 ?? false}
            />
          </div>
        ) : null}

        {hasBoard || hasQualifying ? (
          <>
            {hasBoard ? (
              <>
                {podiumRows.length > 0 ? <Podium top={podiumRows} /> : null}
                {rest.length > 0 ? <LeaderboardList rows={rest} /> : null}
              </>
            ) : null}
            {hasQualifying ? (
              <div className={hasBoard ? 'mt-8' : undefined}>
                <QualifyingSection rows={board.qualifying} />
              </div>
            ) : null}
          </>
        ) : (
          <EmptyBoard />
        )}

        <MethodologyNote />
      </div>
    </main>
  );
}

/** Pre-first-snapshot state: no member is ranked yet (cohort just started). */
function EmptyBoard(): React.ReactElement {
  return (
    <section
      aria-label="Classement à venir"
      className="rounded-card-lg card-premium flex flex-col items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="grid h-12 w-12 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
      >
        <Trophy className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <h2 className="text-[17px] font-semibold text-[var(--t-1)]">Le classement arrive bientôt</h2>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-[var(--t-3)]">
        Dès que les membres cumulent quelques jours de check-ins, le classement se remplit chaque
        nuit. Reviens demain, ou fais ton check-in du jour pour être parmi les premiers.
      </p>
    </section>
  );
}

/** Transparent methodology, so the ranking is understood, trusted, and pushes
 *  members to climb (the "justifié et mis en avant" requirement). */
function MethodologyNote(): React.ReactElement {
  return (
    <details className="rounded-card group mt-8 border border-[var(--b-subtle)] bg-[var(--bg-1)]/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-[var(--t-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] [&::-webkit-details-marker]:hidden">
        Comment le classement est calculé
        <span
          aria-hidden="true"
          className="text-[var(--t-4)] transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--b-subtle)] px-4 pt-3 pb-4 text-[13px] leading-relaxed text-[var(--t-3)]">
        <p>
          Ton score sur 100 combine quatre piliers, chacun avec son poids : l&apos;assiduité (35),
          la discipline (30), la régularité (20) et le travail de suivi (15). Un pilier que tu ne
          peux pas encore remplir n&apos;est jamais compté contre toi.
        </p>
        <p className="inline-flex items-start gap-2 text-[var(--t-2)]">
          <ShieldOff
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acc-hi)]"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span>
            Tes gains, tes pertes et tes performances de trading n&apos;entrent jamais dans le
            calcul. On mesure ce que tu contrôles, pas le résultat du marché.
          </span>
        </p>
        <p>
          Le classement se recalcule chaque nuit. Deux membres qui affichent le même score arrondi
          sont d&apos;abord départagés par leur score exact (au détail près, avant arrondi), puis
          par la plus longue série de check-ins, et enfin par l&apos;ancienneté dans la communauté.
        </p>
      </div>
    </details>
  );
}
