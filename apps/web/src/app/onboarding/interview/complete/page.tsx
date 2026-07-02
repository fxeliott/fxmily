import { ArrowRight, Compass, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { btnVariants } from '@/components/ui/btn';
import { getInterviewForUser } from '@/lib/onboarding-interview/service';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Entretien terminé',
};

export const dynamic = 'force-dynamic';

/**
 * V2.4 Phase B — `/onboarding/interview/complete` calm reveal (M3 directive).
 *
 * Server Component, DS-v3 accent-blue neutral. Surfaced post-`finalizeInterviewAction`
 * redirect. Mark Douglas posture : no fanfare, no badge unlock, no XP — calm
 * reveal "ton entretien est posé, ton profil sera analysé dans les 24h".
 *
 * Routing : an unauthenticated/inactive user is bounced. A completed
 * interview must exist (else redirect to landing — defensive against direct
 * URL access). Once completed, the page is idempotent — refreshing it
 * shows the same calm reveal indefinitely.
 */
export default async function OnboardingInterviewCompletePage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const interview = await getInterviewForUser(session.user.id);
  if (!interview || interview.status !== 'completed') {
    redirect('/onboarding/interview');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-stretch gap-6 px-4 py-12">
      <section
        className="rounded-card-lg relative flex flex-col items-start gap-5 border border-[var(--b-acc)] bg-[var(--bg-2)] p-6 sm:p-8"
        aria-labelledby="oic-heading"
      >
        {/* Calm reveal halo — discreet brand glow anchored to the badge, decorative,
            zero-JS, sits behind the content, never punitive (Mark Douglas). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-8 h-40 [mask-image:radial-gradient(55%_60%_at_24%_0%,#000,transparent)]"
          style={{
            background:
              'radial-gradient(42% 60% at 24% 0%, oklch(0.62 0.19 254 / 0.16) 0%, transparent 72%)',
          }}
        />

        <div
          aria-hidden="true"
          className="celebrate-pop celebrate-halo rounded-pill relative flex h-12 w-12 items-center justify-center border"
          style={{
            background: 'var(--acc-dim)',
            borderColor: 'var(--b-acc)',
            color: 'var(--acc)',
            boxShadow: 'var(--acc-glow)',
          }}
        >
          <Sparkles className="h-5 w-5" strokeWidth={2.2} />
        </div>

        <div
          className="wow-rise flex flex-col gap-2"
          style={{ '--rise-delay': '120ms' } as CSSProperties}
        >
          <p className="t-eyebrow-lg text-[var(--t-3)]">Entretien terminé</p>
          <h1 id="oic-heading" className="f-display t-h1 text-[var(--t-1)]">
            Merci pour ton honnêteté.
          </h1>
        </div>

        <p
          className="wow-rise t-body text-[var(--t-2)]"
          style={{ '--rise-delay': '210ms' } as CSSProperties}
        >
          Tu as terminé tes 30 questions. Eliott lit chaque réponse personnellement. L&apos;IA va
          maintenant analyser l&apos;ensemble pour en tirer un profil descriptif qui servira à
          personnaliser ton coaching.
        </p>
        <p
          className="wow-rise t-body text-[var(--t-2)]"
          style={{ '--rise-delay': '290ms' } as CSSProperties}
        >
          <span className="text-[var(--t-1)]">
            Ton profil sera disponible dans les prochaines 24h
          </span>{' '}
          sur ta page profil. Tu peux y retourner quand tu veux, pas besoin de rester là.
        </p>

        <div
          className="wow-rise flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:gap-3"
          style={{ '--rise-delay': '370ms' } as CSSProperties}
        >
          <Link href="/profile" className={cn(btnVariants({ kind: 'primary', size: 'l' }))}>
            Voir mon profil
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </Link>
          {/* S19.1 — ferme la boucle profil -> plan : oriente le membre vers son
              espace plan (axes + roadmap) plutot que vers un cul-de-sac dashboard.
              Posture Mark Douglas : invitation calme, aucune pression. */}
          <Link href="/objectifs" className={cn(btnVariants({ kind: 'secondary', size: 'l' }))}>
            <Compass className="h-4 w-4" strokeWidth={1.75} />
            Découvrir mon plan
            <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
          </Link>
        </div>
      </section>

      <p className="t-cap text-center text-[var(--t-3)]">
        Tu peux refermer cette page sans perdre tes réponses, tout est enregistré.
      </p>
    </main>
  );
}
