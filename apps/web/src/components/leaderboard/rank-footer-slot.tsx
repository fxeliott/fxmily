import { Trophy } from 'lucide-react';
import Link from 'next/link';

import { Avatar } from '@/components/ui/avatar';
import { getMyLeaderboardRank } from '@/lib/leaderboard/service';

/**
 * RankFooterSlot — the member's standing pinned into the navigation chrome
 * (sidebar desktop + drawer mobile), just above the user footer, so "où je me
 * situe" and, above all, the member's own FACE (their uploaded photo) stay
 * visible on EVERY authenticated page. This is the "leaderboard mis en avant sur
 * chaque compte" + "photo de profil pour créer plus de liens" requirement made
 * omnipresent. Tapping it lands on `/classement`.
 *
 * Async Server Component mounted from the root layout (the `rankSlot` prop of
 * AppShell), under <Suspense fallback={null}> so the chrome flushes without
 * waiting. `getMyLeaderboardRank` is React.cache()-ed → the dashboard widget and
 * `/classement` reuse the same query (zero extra cost). Renders null before the
 * first-ever board exists (no snapshot yet), so there is no empty noise.
 *
 * POSTURE §2 : a calm, motivating anchor, never a counter or an urgency. The
 * avatar degrades to a calm initials disc when no photo is set.
 */
export async function RankFooterSlot({ userId }: { userId: string }) {
  const mine = await getMyLeaderboardRank(userId);
  if (!mine) return null;

  const ranked = mine.rank !== null && mine.score !== null;
  const label = ranked ? `${ordinal(mine.rank!)} sur ${mine.totalRanked}` : 'Bientôt classé';

  return (
    <div className="px-3 pb-2">
      <Link
        href="/classement"
        data-slot="rank-footer"
        aria-label={ranked ? `Ton classement : ${label}` : 'Bientôt classé au classement'}
        className="rounded-control group flex items-center gap-2.5 border border-[var(--b-default)] bg-[var(--bg-2)] px-2.5 py-2 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <span className="relative shrink-0">
          <Avatar
            url={mine.avatarUrl}
            initials={mine.initials}
            firstName={mine.firstName}
            size={30}
          />
          <span
            aria-hidden="true"
            className="absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full border-2 border-[var(--bg-2)] bg-[var(--acc-btn)] text-[var(--acc-fg)]"
          >
            <Trophy className="h-2 w-2" strokeWidth={2.5} />
          </span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="t-eyebrow text-[var(--t-3)] transition-colors group-hover:text-[var(--acc-hi)]">
            Classement
          </span>
          <span className="truncate text-[12px] font-semibold text-[var(--t-1)]">{label}</span>
        </span>
      </Link>
    </div>
  );
}

/** French ordinal: 1 → "1re", everything else → "Ne". */
function ordinal(rank: number): string {
  return rank === 1 ? '1re' : `${rank}e`;
}
