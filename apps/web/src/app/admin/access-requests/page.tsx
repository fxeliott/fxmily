import { ArrowLeft, Inbox } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { AccessRequestRow } from '@/components/admin/access-request-row';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { listPendingAccessRequests } from '@/lib/access-request/service';
import { logAudit } from '@/lib/auth/audit';

export const metadata = {
  title: 'Demandes d’accès · Admin',
};

export const dynamic = 'force-dynamic';

function formatFullName(firstName: string, lastName: string): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : '—';
}

function formatDateLabel(iso: string): string {
  // Server-rendered, fixed Europe/Paris frame (no hydration drift, V1 single-TZ
  // cohort). Day-month-year + HH:mm.
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminAccessRequestsPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const pending = await listPendingAccessRequests();

  await logAudit({
    action: 'admin.access_requests.listed',
    userId: session.user.id,
    metadata: { count: pending.length },
  });

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 px-4 py-10">
      {/* S19.x — ambient mesh for admin-surface coherence (members/cards/reports). */}
      <DashboardAmbient />
      <header className="relative flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Retour au tableau
        </Link>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Pill tone="acc">ADMIN</Pill>
            <span className="t-eyebrow">Demandes d&apos;accès</span>
          </div>
          <h1
            className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Demandes en attente
          </h1>
          <p className="t-lead">
            {pending.length > 0 ? (
              <>
                <span className="font-mono text-[var(--t-1)] tabular-nums">{pending.length}</span>{' '}
                demande{pending.length > 1 ? 's' : ''} à étudier. Accepter mint une invitation et
                envoie un email premium ; refuser envoie un email de refus soigné, sans créer de
                compte.
              </>
            ) : (
              <>Aucune demande en attente pour le moment.</>
            )}
          </p>
        </div>
      </header>

      {pending.length === 0 ? (
        <Card primary className="py-2">
          <EmptyState
            icon={Inbox}
            headline="Boîte vide."
            lead="Les demandes envoyées depuis la page publique /rejoindre apparaîtront ici, à valider une par une."
            guides={[
              'Accepter crée une invitation (lien 7 jours) et envoie l’email premium.',
              'Refuser envoie un email de refus soigné. Aucun compte n’est créé.',
              'Les demandes traitées sont purgées automatiquement (RGPD).',
            ]}
            tip="Cohorte privée = qualité > quantité. Mieux vaut 30 traders sérieux que 300 curieux."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((req) => (
            <li key={req.id} className="wow-reveal">
              <AccessRequestRow
                id={req.id}
                fullName={formatFullName(req.firstName, req.lastName)}
                email={req.email}
                dateLabel={formatDateLabel(req.createdAt)}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
