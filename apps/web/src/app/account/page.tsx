import { ArrowLeft, Bell, Database, Trash2, UserCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { deriveDeletionState } from '@/lib/account/deletion';
import { db } from '@/lib/db';

/**
 * `/account` hub — landing page for the three account-management sub-routes.
 *
 * Server Component, auth-gated to active members. Surfaces three card links :
 *  - `/account/notifications` (J9) — push toggles + per-category preferences
 *  - `/account/data` (J10) — RGPD article 20 export
 *  - `/account/delete` (J10) — RGPD article 17 erasure (with active state
 *    pill if a deletion is currently scheduled, so the user lands directly
 *    on the cancel UI from the hub)
 *
 * Why a hub : J10 Phase A shipped 3 self-service pages without a discovery
 * surface ; landing on `/account` returned 404. This closes the UX gap
 * before V1 ship.
 */

export const metadata: Metadata = {
  title: 'Mon compte',
  description:
    'Réglages compte Fxmily : notifications, export RGPD, suppression. Self-service complet.',
};
export const dynamic = 'force-dynamic';

export default async function AccountHubPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account');
  }

  // Pre-load the deletion state so the hub can flag a scheduled deletion
  // (the user just requested it, hasn't waited the 24h grace yet) — gives
  // them a one-click path to cancel without diving into /account/delete.
  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, deletedAt: true },
  });
  const deletionState = deriveDeletionState(userRow ?? { status: 'active', deletedAt: null });
  const isDeletionScheduled = deletionState.kind === 'scheduled';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <Link
          href="/dashboard"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour au dashboard"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Dashboard
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.18em] text-[var(--acc)] uppercase">
          Mon espace
        </p>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          <UserCircle aria-hidden="true" className="h-7 w-7 text-[var(--acc-hi)]" />
          Mon compte
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
          Tout ce que tu peux régler tout seul depuis l&apos;app — notifications, export de tes
          données, suppression du compte. Aucune action ici n&apos;exige Eliot.
        </p>
      </header>

      <ul className="grid gap-4 sm:grid-cols-2">
        <AccountCard
          href="/account/notifications"
          title="Notifications"
          description="Active ou coupe les notifications push, choisis par catégorie. Désactivable d'un clic à tout moment."
          icon={<Bell aria-hidden="true" className="h-5 w-5" />}
        />
        <AccountCard
          href="/account/data"
          title="Mes données"
          description="Exporte 100% de ton compte au format JSON (RGPD article 20). Téléchargement immédiat, sans friction."
          icon={<Database aria-hidden="true" className="h-5 w-5" />}
        />
        <AccountCard
          href="/account/delete"
          title="Supprimer mon compte"
          description={
            isDeletionScheduled
              ? 'Suppression programmée — annule depuis cette page tant que le compte à rebours 24h n’est pas écoulé.'
              : 'Soft-delete immédiat puis suppression définitive sous 30 jours (RGPD article 17). Compte à rebours 24h pour annuler.'
          }
          icon={<Trash2 aria-hidden="true" className="h-5 w-5" />}
          tone={isDeletionScheduled ? 'warn' : 'danger'}
          badge={isDeletionScheduled ? <Pill tone="warn">En cours · annulable</Pill> : undefined}
        />
      </ul>

      <footer className="mt-10 border-t border-[var(--b-subtle)] pt-5 text-xs text-[var(--t-3)]">
        <p>
          Une question ?{' '}
          <a
            href="mailto:eliot@fxmilyapp.com"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            eliot@fxmilyapp.com
          </a>
          . Voir aussi la{' '}
          <Link
            href="/legal/privacy"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            politique de confidentialité
          </Link>{' '}
          si tu veux savoir comment on traite tes données.
        </p>
      </footer>
    </main>
  );
}

interface AccountCardProps {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  tone?: 'acc' | 'warn' | 'danger';
  badge?: React.ReactNode;
}

function AccountCard({
  href,
  title,
  description,
  icon,
  tone = 'acc',
  badge,
}: AccountCardProps): React.ReactElement {
  const iconBg =
    tone === 'danger'
      ? 'bg-[var(--bad-dim)] text-[var(--bad)]'
      : tone === 'warn'
        ? 'bg-[var(--warn-dim)] text-[var(--warn)]'
        : 'bg-[var(--acc-dim)] text-[var(--acc-hi)]';
  const borderHover =
    tone === 'danger'
      ? 'hover:border-[var(--b-danger)]'
      : 'hover:border-[var(--b-acc)] hover:bg-[var(--acc-dim-2)]';

  return (
    <li>
      <Link
        href={href}
        className={`group block h-full rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 transition-colors ${borderHover}`}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${iconBg}`}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--t-1)]">{title}</h2>
              {badge ?? null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">{description}</p>
          </div>
        </div>
      </Link>
    </li>
  );
}
