import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PartialsSection } from '@/components/admin/track-record/partials-section';
import { PublicTradeForm } from '@/components/admin/track-record/public-trade-form';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { getPublicTradeById } from '@/lib/admin/public-trade-service';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface AdminTrackRecordEditPageProps {
  params: Promise<{ id: string }>;
}

/**
 * `/admin/track-record/[id]/edit` — form d'édition + sub-section partials.
 *
 * Auth gate role=admin + status=active. `getPublicTradeById` charge le trade
 * + ses partials triées chronologiquement. `<PublicTradeForm trade={...}>`
 * en mode edit, `<PartialsSection>` séparée pour les legs.
 */
export default async function AdminTrackRecordEditPage({ params }: AdminTrackRecordEditPageProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login');
  }

  const { id } = await params;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
    notFound();
  }

  const trade = await getPublicTradeById(id);
  if (!trade) notFound();

  return (
    <main className="container mx-auto max-w-3xl px-4 pt-6 pb-24 md:pt-10">
      <header className="mb-6 flex flex-col gap-3">
        <Link
          href="/admin/track-record"
          className={cn(btnVariants({ kind: 'ghost', size: 's' }), 'inline-flex w-fit gap-1.5')}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
          Retour à la liste
        </Link>
        <div className="flex items-center gap-2">
          <Pill tone="acc">Admin</Pill>
          <Pill tone="mute">Édition</Pill>
          <Pill tone="cy">#{trade.ordinal}</Pill>
          {!trade.isPublished ? <Pill tone="warn">Brouillon</Pill> : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {trade.instrument}{' '}
          <span className="text-base font-normal text-[var(--t-3)]">· trade #{trade.ordinal}</span>
        </h1>
        <p className="text-sm text-[var(--t-3)]">
          Modifie les champs et clique Enregistrer. `resultPercent` est recalculé automatiquement
          (risque % × R).
        </p>
      </header>

      <Card className="mb-6 p-6">
        <PublicTradeForm trade={trade} />
      </Card>

      <PartialsSection publicTradeId={trade.id} initialPartials={trade.partials} />
    </main>
  );
}
