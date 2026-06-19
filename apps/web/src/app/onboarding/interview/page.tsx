import { ArrowLeft, ArrowRight, Compass, MessageCircleHeart } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { startInterviewFormAction } from '@/app/onboarding/interview/actions';
import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { getInterviewForUser } from '@/lib/onboarding-interview/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Entretien onboarding',
};

export const dynamic = 'force-dynamic';

/**
 * V2.4 Phase B — `/onboarding/interview` landing (M3 directive 2026-05-27).
 *
 * Server Component, DS-v2 lime neutral (Round 3 decision verrouillée vs V18
 * REFLECT blue+black). Auth gate `status='active'` (carbone V1.5/V1.8/V2.3).
 *
 * Routing decisions :
 *   - `completed` → redirect `/dashboard` (interview is one-shot V1).
 *   - `started` / `in_progress` → redirect `/onboarding/interview/new`
 *     (resume in-flight — the wizard handles partial answers).
 *   - `null` (no row yet) → render hero + CTA `<form>` posting to
 *     `startInterviewAction` which redirects to `/new` on success.
 *
 * Posture §2 explicit in copy : "30 questions, 30 minutes, calme et honnête".
 * No XP/streak/gamification (anti Black-Hat). Mark Douglas framing —
 * the interview is a mirror, not a test.
 */
export default async function OnboardingInterviewLandingPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const interview = await getInterviewForUser(session.user.id);

  if (interview?.status === 'completed') {
    redirect('/dashboard');
  }
  if (interview?.status === 'started' || interview?.status === 'in_progress') {
    redirect('/onboarding/interview/new');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Tableau de bord
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} />
            Onboarding · Entretien profilage
          </span>
          <h1 className="t-h1 text-[var(--t-1)]">Apprends à te connaître en profondeur.</h1>
        </div>
      </header>

      <section
        aria-labelledby="oil-intro-heading"
        className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
      >
        <h2 id="oil-intro-heading" className="sr-only">
          Présentation de l&apos;entretien
        </h2>
        <p className="t-body text-[var(--t-2)]">
          Cet entretien d&apos;onboarding sert à mieux te connaître — ton trading, ton profil
          mental, tes routines.{' '}
          <span className="text-[var(--t-1)]">
            Il n&apos;y a pas de bonne ni de mauvaise réponse.
          </span>{' '}
          Eliott lit chaque réponse personnellement et l&apos;IA en tire un profil descriptif pour
          personnaliser ton coaching.
        </p>
        <p className="t-body text-[var(--t-2)]">
          Compte <span className="text-[var(--t-1)]">environ 30 minutes</span>, répartis sur une ou
          deux sessions selon ton rythme. Tes réponses sont sauvegardées au fur et à mesure — tu
          peux quitter et reprendre à tout moment. Sois honnête, pas idéaliste : la valeur de
          l&apos;exercice dépend uniquement de ça.
        </p>

        <ul className="t-body flex flex-col gap-2 text-[var(--t-2)]">
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1 text-[var(--acc)]">
              ·
            </span>
            <span>
              <span className="text-[var(--t-1)]">30 questions</span> sur ton parcours, tes
              routines, ton rapport au risque et au plan.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1 text-[var(--acc)]">
              ·
            </span>
            <span>
              <span className="text-[var(--t-1)]">3 phases</span> — échauffement, cœur de
              l&apos;entretien, clôture réflexive.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1 text-[var(--acc)]">
              ·
            </span>
            <span>
              <span className="text-[var(--t-1)]">Confidentiel</span> — analyse IA locale (pas
              d&apos;API tierce), profil descriptif pour Eliott uniquement.
            </span>
          </li>
        </ul>
      </section>

      <form action={startInterviewFormAction} className="flex w-full">
        <button
          type="submit"
          className={cn(btnVariants({ kind: 'primary', size: 'l' }), 'w-full justify-center')}
        >
          <MessageCircleHeart className="h-4 w-4" strokeWidth={1.75} />
          Commencer mon entretien
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </form>
    </main>
  );
}
