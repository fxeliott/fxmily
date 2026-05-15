import { ArrowLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listMyDeliveries } from '@/lib/cards/service';

export const dynamic = 'force-dynamic';

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export default async function InboxPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const deliveries = await listMyDeliveries(session.user.id, { take: 50 });
  const unread = deliveries.filter((d) => !d.seenAt);
  const read = deliveries.filter((d) => d.seenAt);

  return (
    <main className="container mx-auto max-w-3xl px-4 pt-6 pb-24 md:pt-10">
      <div className="mb-6 flex flex-col gap-3">
        <Link
          href="/library"
          className="rounded-pill border-border text-muted hover:border-acc/40 hover:text-foreground focus-visible:outline-acc inline-flex h-11 w-fit items-center gap-1.5 border px-3 text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Retour au catalogue</span>
        </Link>
        <div className="flex items-center gap-2">
          <Sparkles className="text-acc h-5 w-5" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">Tes fiches reçues</h1>
        </div>
        <p className="text-muted text-sm">
          Quand le système détecte un pattern (3 pertes consécutives, FOMO, etc.), il te pousse la
          fiche Mark Douglas la plus pertinente. Tu retrouves ici l&apos;historique complet.
        </p>
      </div>

      {deliveries.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Sparkles}
            headline="Aucune fiche poussée pour l'instant"
            lead="Le système n'a pas encore détecté de pattern qui justifie une fiche. Continue ton process — le coaching arrive quand il est utile."
            tip="Tu peux toujours parcourir tout le catalogue dans /library."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {unread.length > 0 && (
            <section aria-labelledby="unread-heading">
              <h2
                id="unread-heading"
                className="text-acc mb-3 text-xs font-semibold tracking-wide uppercase"
              >
                Non lues ({unread.length})
              </h2>
              <ul className="flex flex-col gap-3">
                {unread.map((d) => (
                  <DeliveryItem key={d.id} delivery={d} unread />
                ))}
              </ul>
            </section>
          )}
          {read.length > 0 && (
            <section aria-labelledby="read-heading">
              <h2
                id="read-heading"
                className="text-muted mb-3 text-xs font-semibold tracking-wide uppercase"
              >
                Déjà lues
              </h2>
              <ul className="flex flex-col gap-3">
                {read.map((d) => (
                  <DeliveryItem key={d.id} delivery={d} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function DeliveryItem({
  delivery: d,
  unread = false,
}: {
  delivery: Awaited<ReturnType<typeof listMyDeliveries>>[number];
  unread?: boolean;
}) {
  const Icon = CATEGORY_ICON[d.cardCategory];
  const tone = CATEGORY_TONE[d.cardCategory];
  return (
    <li>
      <Card interactive className="p-4">
        <Link href={`/library/${d.cardSlug}`} className="block">
          <div className="flex items-start gap-3">
            <span
              className="bg-acc-dim text-acc inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              aria-hidden
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={tone}>{CATEGORY_LABEL[d.cardCategory]}</Pill>
                {unread && (
                  <Pill tone="acc" dot="live">
                    Non lue
                  </Pill>
                )}
              </div>
              <h3 className="text-base leading-snug font-semibold">{d.cardTitle}</h3>
              <p className="text-muted text-xs">{d.triggeredBy}</p>
              <p className="text-muted text-[10px] tracking-wide uppercase">
                {DT.format(new Date(d.createdAt))}
              </p>
            </div>
          </div>
        </Link>
      </Card>
    </li>
  );
}
