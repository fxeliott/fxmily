import { ArrowLeft, Heart } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listMyFavorites } from '@/lib/cards/service';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const favorites = await listMyFavorites(session.user.id);

  return (
    <main className="container mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <div className="mb-6 flex flex-col gap-3">
        <Link
          href="/library"
          className="rounded-pill border-border text-muted hover:border-acc/40 hover:text-foreground inline-flex h-9 w-fit items-center gap-1.5 border px-3 text-xs font-medium transition-all"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Retour au catalogue</span>
        </Link>
        <div className="flex items-center gap-2">
          <Heart className="fill-acc text-acc h-5 w-5" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Mes favoris</h1>
        </div>
        <p className="text-muted text-sm">
          Les fiches que tu as marquées comme essentielles. Tu peux y revenir aussi souvent que
          besoin — la répétition est la voie de l&apos;intégration.
        </p>
      </div>

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
                <Card interactive className="p-4">
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
                        <h2 className="text-base font-semibold leading-snug">{f.cardTitle}</h2>
                      </div>
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
