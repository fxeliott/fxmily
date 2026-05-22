import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PublicTradeForm } from '@/components/admin/track-record/public-trade-form';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * `/admin/track-record/new` — form de création d'un PublicTrade.
 *
 * Auth gate role=admin + status=active. Wrap `<PublicTradeForm />` (mode
 * create — pas de `trade` prop). Le form redirige vers la list au succès
 * (Server Action `createPublicTradeAction` appelle `redirect`).
 */
export default async function AdminTrackRecordNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'admin' || session.user.status !== 'active') {
    redirect('/login');
  }

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
          <Pill tone="mute">Nouveau trade</Pill>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Ajouter un trade public
        </h1>
        <p className="text-sm text-[var(--t-3)]">
          Renseigne au minimum l&apos;instrument, la date d&apos;entrée, le risque % et le statut.
          Les invariants lifecycle (clôture ⇒ exitedAt + R requis) sont validés au submit.
        </p>
      </header>

      <Card className="p-6">
        <PublicTradeForm />
      </Card>
    </main>
  );
}
