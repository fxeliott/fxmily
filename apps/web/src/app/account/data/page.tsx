import { ArrowLeft, Database, Download, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { Code } from '@/components/ui/code';
import { db } from '@/lib/db';

/**
 * `/account/data` — RGPD article 20 portability + transparency.
 *
 * Server Component. Renders :
 *  - a one-paragraph summary of what the JSON contains;
 *  - the exact list of sections (counts pulled live so the user sees a
 *    truthful preview before clicking "Télécharger");
 *  - a vanilla `<form action="/api/account/data/export" method="POST">`
 *    button — the route handler responds with `Content-Disposition:
 *    attachment` so the browser downloads the JSON without navigation.
 *
 * No client JS — the only interaction is a form submit. Keeps the page
 * tiny and accessible (every assistive tech understands a submit button).
 */

export const metadata: Metadata = {
  title: 'Mes données',
  description:
    'Exporte 100% de tes données Fxmily au format JSON. Téléchargement immédiat, sans friction.',
};
export const dynamic = 'force-dynamic';

export default async function AccountDataPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/data');
  }
  const userId = session.user.id;

  // Live counts — give the user an honest preview of what they're about to
  // download. Cheap aggregate queries; no actual rows materialised.
  const [
    tradeCount,
    checkinCount,
    scoreCount,
    deliveryCount,
    favoriteCount,
    reportCount,
    pushCount,
    auditCount,
  ] = await Promise.all([
    db.trade.count({ where: { userId } }),
    db.dailyCheckin.count({ where: { userId } }),
    db.behavioralScore.count({ where: { userId } }),
    db.markDouglasDelivery.count({ where: { userId } }),
    db.markDouglasFavorite.count({ where: { userId } }),
    db.weeklyReport.count({ where: { userId } }),
    db.pushSubscription.count({ where: { userId } }),
    db.auditLog.count({ where: { userId } }),
  ]);

  const sections: Array<{ label: string; count: number; description: string }> = [
    {
      label: 'Compte',
      count: 1,
      description: 'Email, profil, fuseau, dates de connexion (mot de passe exclu).',
    },
    {
      label: 'Trades',
      count: tradeCount,
      description: 'Journal complet : entrée, sortie, R planifié et réalisé, screenshots clés.',
    },
    {
      label: 'Check-ins',
      count: checkinCount,
      description: 'Routine matin/soir, mood, sommeil, intentions, gratitude.',
    },
    {
      label: 'Scores',
      count: scoreCount,
      description: 'Snapshots quotidiens des 4 dimensions comportementales (rolling 30j).',
    },
    {
      label: 'Fiches Mark Douglas reçues',
      count: deliveryCount,
      description: 'Historique des fiches diffusées et leur état (vue, dismiss, helpful).',
    },
    {
      label: 'Fiches Mark Douglas favorites',
      count: favoriteCount,
      description: 'Tes favoris manuels.',
    },
    {
      label: 'Rapports hebdo IA',
      count: reportCount,
      description: 'Rapports générés à destination de l’admin (sortie Claude Sonnet).',
    },
    {
      label: 'Notifications push',
      count: pushCount,
      description:
        'Endpoints (sans clés cryptographiques) + dernière activité, pour audit personnel.',
    },
    {
      label: "Logs d'audit",
      count: auditCount,
      description: 'Actions sensibles (login, export, suppression) — IP non incluse (hash sel).',
    },
  ];

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
          RGPD · Article 20
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--t-1)] sm:text-3xl">
          Mes données
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
          Tu peux télécharger l&apos;intégralité de tes données Fxmily à n&apos;importe quel moment,
          au format JSON. Le fichier reste lisible (indenté), téléchargement immédiat, aucune
          attente.
        </p>
      </header>

      <section
        aria-labelledby="export-summary-heading"
        className="rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <Database className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="export-summary-heading" className="text-base font-semibold text-[var(--t-1)]">
              Ce que contient l&apos;export
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--t-3)]">
              Format : <Code>application/json</Code> · Schéma versionné · Champs sensibles exclus
              (mot de passe, clés push, hash IP).
            </p>
          </div>
        </div>

        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {sections.map((s) => (
            <li
              key={s.label}
              className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-[var(--t-1)]">{s.label}</p>
                <span className="font-mono text-xs text-[var(--acc-hi)]">{s.count}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--t-3)]">{s.description}</p>
            </li>
          ))}
        </ul>

        <form action="/api/account/data/export" method="POST" className="mt-6">
          <button
            type="submit"
            className={btnVariants({ kind: 'primary', size: 'l' })}
            aria-label="Télécharger l’export JSON de mes données"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Télécharger l&apos;export JSON
          </button>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--t-3)]">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-[var(--acc-hi)]" />
            Chaque export est tracé dans tes logs (action <Code>account.data.exported</Code>).
          </p>
        </form>
      </section>

      <section className="mt-8 text-xs text-[var(--t-3)]">
        <p>
          Tu veux plutôt <strong>supprimer ton compte</strong> ? Voir{' '}
          <Link
            href="/account/delete"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            /account/delete
          </Link>
          . Plus de détails dans la{' '}
          <Link
            href="/legal/privacy"
            className="text-[var(--acc-hi)] underline underline-offset-2 hover:text-[var(--acc)]"
          >
            politique de confidentialité
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
