import { ArrowLeft, Heart } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverLift } from '@/components/ui/hover-lift';
import { Pill } from '@/components/ui/pill';
import { listMyFavorites } from '@/lib/cards/service';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const favorites = await listMyFavorites(session.user.id);

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto w-full max-w-3xl px-4 pt-6 pb-24 md:pt-10">
        {/* Hero header */}
        <header className="mb-6 flex flex-col gap-3">
          <Link
            href="/library"
            className="rounded-pill border-border text-muted hover:border-acc/40 hover:text-foreground focus-visible:outline-acc inline-flex h-11 w-fit items-center gap-1.5 border px-3 text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Retour au catalogue</span>
          </Link>
          <div className="flex items-center gap-2">
            <span
              className="bg-acc-dim text-acc inline-flex h-9 w-9 items-center justify-center rounded-full shadow-[var(--acc-glow)]"
              aria-hidden
            >
              <Heart className="fill-acc h-4 w-4" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Mes favoris</h1>
          </div>
          <p className="text-muted max-w-2xl text-sm leading-relaxed">
            Les fiches que tu as marquées comme essentielles. Tu peux y revenir aussi souvent que
            besoin — la répétition est la voie de l&apos;intégration.
          </p>
          <DrawnRule className="mt-1 max-w-[220px]" />
        </header>

        {favorites.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={Heart}
              headline="Pas encore de favori"
              lead="Ouvre une fiche et clique sur le cœur pour l'ajouter ici. Tu y reviendras quand tu en auras besoin."
              tip="Les fiches Mark Douglas demandent plusieurs lectures pour s'intégrer. Le rappel a sa place dans le process."
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {favorites.map((f) => {
              const Icon = CATEGORY_ICON[f.cardCategory];
              const tone = CATEGORY_TONE[f.cardCategory];
              return (
                <li key={f.cardId}>
                  <HoverLift className="block">
                    <Card
                      interactive
                      className="focus-within:ring-acc p-4 focus-within:ring-2 focus-within:ring-offset-2"
                    >
                      <Link href={`/library/${f.cardSlug}`} className="block">
                        <div className="flex items-center gap-3">
                          <span
                            className="bg-acc-dim text-acc inline-flex h-8 w-8 items-center justify-center rounded-full"
                            aria-hidden
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="flex flex-1 flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Pill tone={tone}>{CATEGORY_LABEL[f.cardCategory]}</Pill>
                            </div>
                            <h2 className="text-base leading-snug font-semibold">{f.cardTitle}</h2>
                          </div>
                        </div>
                      </Link>
                    </Card>
                  </HoverLift>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
