import { AlertTriangle, ArrowLeft, Clock, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import {
  ACCOUNT_DELETION_GRACE_HOURS,
  ACCOUNT_HARD_PURGE_DAYS,
  deriveDeletionState,
} from '@/lib/account/deletion';
import { db } from '@/lib/db';

import { CancelDeletionForm } from './cancel-form';
import { DeleteAccountForm } from './delete-form';

/**
 * `/account/delete` — RGPD article 17 self-service erasure.
 *
 * Server Component renders one of two states (computed by
 * `deriveDeletionState` on a tiny `(status, deletedAt)` projection) :
 *
 *   - `active` → DeleteAccountForm (type SUPPRIMER + danger button).
 *   - `scheduled` → countdown + CancelDeletionForm.
 *
 * The materialised state should not be reachable here — once `status='deleted'`,
 * `auth()` already redirects to `/login` (status check in the route guard).
 * If we ever land in that race, redirect to home as a polite landing.
 */

export const metadata: Metadata = {
  title: 'Supprimer mon compte',
  description:
    'Supprime ton compte Fxmily. 24h de réflexion, hard-delete sous 30 jours, conformité RGPD article 17.',
};
export const dynamic = 'force-dynamic';

export default async function AccountDeletePage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/delete');
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { status: true, deletedAt: true },
  });
  if (!user) {
    redirect('/login?redirect=/account/delete');
  }

  const state = deriveDeletionState(user);

  // Defensive : this page should never serve a fully-materialised account.
  if (state.kind === 'materialised') {
    redirect('/');
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <Link
          href="/dashboard"
          className={btnVariants({ kind: 'ghost', size: 'm' })}
          aria-label="Retour au dashboard"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Dashboard
        </Link>
        <p className="mt-4 text-[11px] font-medium tracking-[0.18em] text-[var(--bad)] uppercase">
          RGPD · Article 17
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          Supprimer mon compte
        </h1>
      </header>

      {state.kind === 'scheduled' ? <ScheduledPanel state={state} /> : <ActiveAccountPanel />}

      <footer className="mt-10 border-t border-[var(--b-subtle)] pt-5 text-xs text-[var(--t-3)]">
        <p>
          Si tu cherches juste à <strong>récupérer tes données</strong> avant de partir, exporte
          tout en JSON depuis{' '}
          <Link
            href="/account/data"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            /account/data
          </Link>
          . Pas besoin de supprimer pour exporter.
        </p>
      </footer>
    </main>
  );
}

function ActiveAccountPanel(): React.ReactElement {
  return (
    <section
      aria-labelledby="delete-heading"
      className="rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--bad-dim)] text-[var(--bad)]"
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="delete-heading" className="text-base font-semibold text-[var(--t-1)]">
            Ce qui se passe quand tu valides
          </h2>
          {/*
            Numbering : the visible "1.", "2.", "3." spans are decorative —
            the `<ol>` element already conveys the order to assistive tech.
            `aria-hidden="true"` prevents the double-enumeration that would
            otherwise read "1. 1. Compte à rebours ..." (J10 Phase G a11y B1).
          */}
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--t-2)] [&>li]:flex [&>li]:gap-2">
            <li>
              <span aria-hidden="true" className="text-[var(--acc-hi)]">
                1.
              </span>
              <span>
                Compte à rebours de <strong>{ACCOUNT_DELETION_GRACE_HOURS}h</strong>. Tu peux
                annuler à n&apos;importe quel moment depuis cette page.
              </span>
            </li>
            <li>
              <span aria-hidden="true" className="text-[var(--acc-hi)]">
                2.
              </span>
              <span>
                À l&apos;expiration, ton compte passe en <em>soft-delete</em> : email, prénom, nom,
                image, mot de passe sont effacés. Tu es déconnecté.
              </span>
            </li>
            <li>
              <span aria-hidden="true" className="text-[var(--acc-hi)]">
                3.
              </span>
              <span>
                <strong>{ACCOUNT_HARD_PURGE_DAYS} jours</strong> plus tard, suppression définitive :
                trades, check-ins, scores, fiches reçues, abonnements push, logs. Plus rien ne
                reste.
              </span>
            </li>
          </ol>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-4">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--t-2)] uppercase">
          <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5 text-[var(--bad)]" />
          Action irréversible après {ACCOUNT_HARD_PURGE_DAYS} jours
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--t-3)]">
          Pour annuler après le compte à rebours, contacte{' '}
          <a
            href="mailto:eliot@fxmilyapp.com"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            eliot@fxmilyapp.com
          </a>{' '}
          dans les {ACCOUNT_HARD_PURGE_DAYS} jours qui suivent. Au-delà, la suppression est
          définitive : aucune sauvegarde ne sera restaurée.
        </p>
      </div>

      <div className="mt-6">
        <DeleteAccountForm />
      </div>
    </section>
  );
}

function ScheduledPanel({
  state,
}: {
  state: Extract<ReturnType<typeof deriveDeletionState>, { kind: 'scheduled' }>;
}): React.ReactElement {
  const hoursLeft = Math.ceil(state.msUntilMaterialisation / (60 * 60 * 1000));
  const formatted = state.scheduledAt.toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  return (
    <section
      aria-labelledby="scheduled-heading"
      className="rounded-2xl border border-[var(--b-acc)] bg-[var(--bg-1)] p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
        >
          <Clock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="scheduled-heading" className="text-base font-semibold text-[var(--t-1)]">
              Suppression programmée
            </h2>
            <Pill tone="acc">~{Math.max(1, hoursLeft)}h restantes</Pill>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--t-2)]">
            Ton compte sera soft-supprimé le{' '}
            <strong className="text-[var(--t-1)]">{formatted}</strong>. Tu peux toujours{' '}
            <strong>annuler</strong> jusque-là.
          </p>
          <p className="mt-2 text-xs text-[var(--t-3)]">
            Au passage du compte à rebours, tu seras déconnecté. Tu auras encore{' '}
            <strong>{ACCOUNT_HARD_PURGE_DAYS} jours</strong> pour contacter Eliot et restaurer le
            compte avant la suppression définitive.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <CancelDeletionForm />
      </div>
    </section>
  );
}
