import { Target } from 'lucide-react';
import Link from 'next/link';

import { getOpenMicroObjective } from '@/lib/coaching/micro-objective';

/**
 * MicroObjectivePillSlot — tour 10. Le micro-objectif OUVERT du membre, épinglé
 * dans le chrome de navigation (sidebar desktop + drawer mobile) : le « sur quoi
 * je travaille en ce moment » reste visible sur TOUTES les pages, pas seulement
 * sur /dashboard et /objectifs. Cliquer mène à /objectifs (la boucle de suivi
 * « l'as-tu tenu ? » y vit déjà).
 *
 * Server Component async monté depuis le root layout (slot `pill` d'AppShell),
 * sous <Suspense fallback={null}> : le chrome flush sans attendre la requête.
 * `getOpenMicroObjective` est React.cache()-é → les pages qui l'affichent déjà
 * ne re-paient pas la requête. Rend null sans objectif ouvert (zéro bruit).
 *
 * POSTURE §33.2 : un rappel calme d'intention, jamais un compteur ni une
 * urgence. Copie CURÉE déterministe (héritée du micro-objectif) → pas
 * d'AIGeneratedBanner (précédent : micro-objective-card.tsx).
 */
export async function MicroObjectivePillSlot({ userId }: { userId: string }) {
  const objective = await getOpenMicroObjective(userId);
  if (!objective) return null;

  return (
    <div className="px-3 pb-2">
      <Link
        href="/objectifs"
        data-slot="micro-objective-pill"
        className="rounded-control group flex items-center gap-2.5 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] px-2.5 py-2 transition-colors hover:bg-[var(--acc-dim)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        <Target
          className="h-[18px] w-[18px] shrink-0 text-[var(--acc)] transition-transform duration-200 group-hover:scale-110"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="flex min-w-0 flex-col">
          <span className="t-eyebrow text-[var(--acc-hi)]">Micro-objectif</span>
          <span className="truncate text-[12px] font-medium text-[var(--t-1)]">
            {objective.title}
          </span>
        </span>
      </Link>
    </div>
  );
}
