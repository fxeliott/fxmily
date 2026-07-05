import {
  Activity,
  ArrowRight,
  BookOpen,
  Compass,
  NotebookPen,
  Sparkles,
  Sunrise,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { Card } from '@/components/ui/card';
import { btnVariants } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

/**
 * FirstRunWelcome — S9.1 "wave wow" greeting for a brand-new member
 * (0 trades, 0 streak). Server component, zero JS: the staggered reveal rides
 * the CSS `.wow-rise` keyframe (`--rise-delay`), neutralised by the global
 * `prefers-reduced-motion` filet (AT members land on the final state instantly).
 *
 * Posture (Mark Douglas, non-toxic): warm, oriented toward the FIRST real
 * action — no score, no streak guilt, no "don't break the chain". Three calm
 * next steps (routine du matin / premier trade / entretien de profilage),
 * framed as a practice the member owns. Brand blue only.
 */
const STEPS = [
  {
    icon: Sunrise,
    title: 'Pose ta routine du matin',
    body: 'Trois minutes pour cadrer ton état avant le marché. C’est le socle de la discipline.',
  },
  {
    icon: NotebookPen,
    title: 'Logge ton premier trade',
    body: 'Capture ton plan et ton intention. Le journal est un miroir, jamais un juge.',
  },
  {
    icon: Sparkles,
    title: 'Apprends à te connaître',
    body: 'Un entretien guidé : l’app cerne ton profil pour t’accompagner au plus juste. À ton rythme.',
  },
  {
    icon: Activity,
    title: 'Suis tes habitudes',
    body: 'Sommeil, sport, méditation : tes cinq piliers alimentent ton exécution. Le module habitudes en garde le miroir.',
  },
] as const;

export function FirstRunWelcome({
  needsProfile = false,
  todayIsOff = false,
}: {
  needsProfile?: boolean;
  /**
   * Tour 14 — when the member's TODAY is an off day, the welcome never leads
   * with "commence ton check-in" (a jour off owes nothing, §31.2): the check-in
   * CTA steps back to secondary and a calm line names the off day. The profil /
   * journal / guide steps stay available (they are not day-bound).
   */
  todayIsOff?: boolean;
}) {
  // On an off day the check-in never leads as the primary CTA (the day is a
  // pont, not a first-gesture push). The profile still leads when it's missing.
  const checkinKind = needsProfile || todayIsOff ? 'secondary' : 'primary';
  return (
    <Card
      primary
      glass
      className="wow-rise rounded-card-lg overflow-hidden p-6 sm:p-7"
      style={{ '--rise-delay': '60ms' } as CSSProperties}
    >
      <div className="flex flex-col gap-5">
        <div
          className="wow-rise flex items-center gap-3"
          style={{ '--rise-delay': '120ms' } as CSSProperties}
        >
          <span
            aria-hidden
            className="celebrate-halo grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[0_0_24px_-6px_oklch(0.62_0.19_254_/_0.5)]"
          >
            <Compass className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--acc-hi)]">Bienvenue</span>
            <h2 className="t-h2 text-[var(--t-1)]">Ton espace est prêt.</h2>
          </div>
        </div>

        <p
          className="wow-rise t-lead max-w-prose"
          style={{ '--rise-delay': '180ms' } as CSSProperties}
        >
          Ici, on construit la régularité avant la performance. Pas de chiffres à battre
          aujourd’hui, juste un premier geste à poser. Commence par où tu veux, à ton rythme.
        </p>

        {/* Tour 14 — off day : on ne pousse jamais le check-in du jour, on
            nomme calmement le repos. Le membre garde profil / trade / guide sous
            la main pour découvrir l'app sans pression (§31.2). */}
        {todayIsOff ? (
          <p
            className="wow-rise t-cap rounded-control w-fit border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2 text-[var(--t-3)]"
            style={{ '--rise-delay': '210ms' } as CSSProperties}
          >
            Aujourd’hui est un jour off : rien à remplir. Tu peux découvrir l’app tranquillement,
            ton premier check-in attendra un jour de trading.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="wow-rise rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-1)]/60 p-4"
                style={{ '--rise-delay': `${240 + i * 70}ms` } as CSSProperties}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]"
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <h3 className="text-[14px] font-semibold text-[var(--t-1)]">{step.title}</h3>
                </div>
                <p className="t-cap text-[var(--t-3)]">{step.body}</p>
              </div>
            );
          })}
        </div>

        <div
          className="wow-rise flex flex-wrap items-center gap-2"
          style={{ '--rise-delay': '400ms' } as CSSProperties}
        >
          {/* S19.2 — §28 : when no profile exists yet, the onboarding interview
              becomes the primary first step (it personalises all coaching), with
              the daily gestures right after. Otherwise the daily check-in leads. */}
          {needsProfile ? (
            <Link
              href="/onboarding/interview"
              className={cn(btnVariants({ kind: 'primary', size: 'm' }))}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              Commencer par mon profil
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          <Link
            href="/checkin/morning"
            className={cn(btnVariants({ kind: checkinKind, size: 'm' }))}
          >
            <Sunrise className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Commencer mon check-in
            {checkinKind === 'primary' ? (
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            ) : null}
          </Link>
          <Link href="/journal/new" className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}>
            <NotebookPen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Logger un trade
          </Link>
          {needsProfile ? null : (
            <Link
              href="/onboarding/interview"
              className={cn(btnVariants({ kind: 'secondary', size: 'm' }))}
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              Faire mon profil
            </Link>
          )}
          <Link
            href="/guide"
            className="inline-flex items-center gap-1.5 px-1 text-[13px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Comment ça marche
          </Link>
        </div>
      </div>
    </Card>
  );
}
