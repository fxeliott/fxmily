import { ArrowLeft, Database, Download, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { btnVariants } from '@/components/ui/btn';
import { Code } from '@/components/ui/code';
import { Pill } from '@/components/ui/pill';
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
    'Exporte l’intégralité de tes données Fxmily au format JSON. Téléchargement immédiat, sans friction.',
};
export const dynamic = 'force-dynamic';

export default async function AccountDataPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login?redirect=/account/data');
  }
  const userId = session.user.id;

  // Live counts — give the user an honest preview of what they're about to
  // download. Cheap aggregate queries; no actual rows materialised. Session 21:
  // the preview now mirrors the full export (the behavioural / psychological
  // surface), so "l'intégralité" on the page is literally true.
  const [
    tradeCount,
    checkinCount,
    scoreCount,
    deliveryCount,
    favoriteCount,
    reportCount,
    pushCount,
    auditCount,
    weeklyReviewCount,
    reflectionCount,
    habitCount,
    trainingTradeCount,
    trainingDebriefCount,
    trainingSessionCount,
    monthlyDebriefCount,
    mindsetCount,
    preTradeCount,
    onboardingCount,
    profileCount,
    calendarCount,
    questionnaireCount,
    meetingCount,
    proofCount,
    brokerCount,
    discrepancyCount,
    constancyCount,
    alertCount,
  ] = await Promise.all([
    db.trade.count({ where: { userId } }),
    db.dailyCheckin.count({ where: { userId } }),
    db.behavioralScore.count({ where: { userId } }),
    db.markDouglasDelivery.count({ where: { userId } }),
    db.markDouglasFavorite.count({ where: { userId } }),
    db.weeklyReport.count({ where: { userId } }),
    db.pushSubscription.count({ where: { userId } }),
    db.auditLog.count({ where: { userId } }),
    db.weeklyReview.count({ where: { userId } }),
    db.reflectionEntry.count({ where: { userId } }),
    db.habitLog.count({ where: { userId } }),
    db.trainingTrade.count({ where: { userId } }),
    db.trainingDebrief.count({ where: { userId } }),
    db.trainingSession.count({ where: { memberId: userId } }),
    db.monthlyDebrief.count({ where: { userId } }),
    db.mindsetCheck.count({ where: { userId } }),
    db.preTradeCheck.count({ where: { userId } }),
    db.onboardingInterview.count({ where: { userId } }),
    db.memberProfile.count({ where: { userId } }),
    db.adaptiveCalendar.count({ where: { userId } }),
    db.weeklyScheduleQuestionnaire.count({ where: { userId } }),
    db.meetingAttendance.count({ where: { userId } }),
    db.mt5AccountProof.count({ where: { memberId: userId } }),
    db.brokerAccount.count({ where: { memberId: userId } }),
    db.discrepancy.count({ where: { memberId: userId } }),
    db.constancyScore.count({ where: { memberId: userId } }),
    db.alert.count({ where: { memberId: userId } }),
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
      description: 'Rapports générés à destination de l’admin (sortie du moteur Claude local).',
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
      description: 'Actions sensibles (login, export, suppression), IP non incluse (hash sel).',
    },
    {
      label: 'Réflexions & revues',
      count: weeklyReviewCount + reflectionCount,
      description: 'Revues hebdo du dimanche + entrées de réflexion (méthode ABC d’Ellis).',
    },
    {
      label: 'Habitudes',
      count: habitCount,
      description: 'Sommeil, sport, nutrition, caféine, méditation (module TRACK).',
    },
    {
      label: 'Auto-évaluations mindset',
      count: mindsetCount,
      description: 'QCM hebdomadaire d’auto-évaluation du mindset (déterministe).',
    },
    {
      label: 'Checks pré-trade',
      count: preTradeCount,
      description:
        'Pauses anti-FOMO avant trade (4 questions, ~30s) et leur lien éventuel au trade.',
    },
    {
      label: 'Mode Entraînement',
      count: trainingTradeCount + trainingDebriefCount + trainingSessionCount,
      description: 'Backtests TradingView, sessions d’entraînement et débriefs dédiés.',
    },
    {
      label: 'Débriefs mensuels IA',
      count: monthlyDebriefCount,
      description: 'Synthèses mensuelles générées par le moteur Claude local.',
    },
    {
      label: 'Profil d’accompagnement',
      count: onboardingCount + profileCount,
      description:
        'Entretien d’onboarding + profil psychologique/process généré (posture Mark Douglas).',
    },
    {
      label: 'Calendrier adaptatif',
      count: calendarCount + questionnaireCount,
      description: 'Questionnaires hebdo de disponibilité + calendriers personnels générés.',
    },
    {
      label: 'Présence aux réunions',
      count: meetingCount,
      description: 'Déclarations de présence aux réunions Fxmily.',
    },
    {
      label: 'Vérification & honnêteté',
      count: proofCount + brokerCount + discrepancyCount + constancyCount + alertCount,
      description:
        'Preuves MT5 téléversées, comptes détectés, écarts déclaratifs, score de constance et alertes.',
    },
  ];

  return (
    <main className="relative bg-[var(--bg)]">
      {/* S19.1 ambient anti-fade backplate (decorative, -z-10, reduced-motion-safe). */}
      <DashboardAmbient />
      <div className="dash-stagger relative mx-auto w-full max-w-5xl px-4 py-6 sm:py-10 lg:px-8">
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
          <h1 className="t-h1 mt-2 text-[var(--t-1)]">Mes données</h1>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-[var(--t-2)]">
            Tu peux télécharger l&apos;intégralité de tes données Fxmily à n&apos;importe quel
            moment, au format JSON. Le fichier reste lisible (indenté), téléchargement immédiat,
            aucune attente.
          </p>
        </header>

        <section
          aria-labelledby="export-summary-heading"
          className="glow-edge rounded-card-lg relative border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--acc-dim)] to-[var(--cy-dim)] text-[var(--acc-hi)] ring-1 ring-[var(--b-acc)] ring-inset"
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

          <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              // Hover affordance on every section tile : cool border + lift
              // (compositor-only transform), reduced-motion safe.
              <li
                key={s.label}
                className="rounded-card border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3 transition-[border-color,background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--b-acc)] hover:bg-[var(--bg-1)] hover:shadow-[var(--sh-card)] motion-reduce:transform-none motion-reduce:transition-none"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--t-1)]">{s.label}</p>
                  {/* Neutral COUNT badge in cool §21.7 cyan (never a CTA). */}
                  <Pill tone="cy">{s.count}</Pill>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--t-3)]">
                  {s.description}
                </p>
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
      </div>
    </main>
  );
}
