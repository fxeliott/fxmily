import { ArrowRight, Camera } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { AvatarSettings } from '@/components/account/avatar-settings';
import { btnVariants } from '@/components/ui/btn';
import { db } from '@/lib/db';
import { selectStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';

/**
 * `/onboarding/photo` — the profile-photo step, shown right after a member
 * creates their account (the onboarding `signIn` lands here before the
 * interview). Authenticated, and entirely SKIPPABLE: a photo builds the bond on
 * the leaderboard but is never required. Continuing or skipping both go to the
 * onboarding interview, the natural next step.
 */

export const metadata = {
  title: 'Ta photo',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

function initialsOf(firstName: string | null, lastName: string | null): string {
  const a = firstName?.trim().charAt(0) ?? '';
  const b = lastName?.trim().charAt(0) ?? '';
  const s = `${a}${b}`.toUpperCase();
  return s.length > 0 ? s : '?';
}

function avatarUrlOf(avatarKey: string | null, image: string | null): string | null {
  if (avatarKey) {
    try {
      return selectStorage().getReadUrl(avatarKey);
    } catch {
      // Malformed key never breaks the step.
    }
  }
  return image ?? null;
}

export default async function OnboardingPhotoPage(): Promise<React.ReactElement> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const userRow = await db.user.findUnique({
    where: { id: session.user.id },
    select: { firstName: true, lastName: true, avatarKey: true, image: true },
  });

  const url = avatarUrlOf(userRow?.avatarKey ?? null, userRow?.image ?? null);
  const initials = initialsOf(userRow?.firstName ?? null, userRow?.lastName ?? null);
  const firstName = userRow?.firstName?.trim() || 'Membre';

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-72 [mask-image:radial-gradient(60%_60%_at_50%_0%,#000,transparent)]"
        style={{
          background:
            'radial-gradient(48% 60% at 50% 0%, oklch(0.62 0.19 254 / 0.18) 0%, transparent 72%)',
        }}
      />
      <header className="page-stagger flex flex-col gap-1.5">
        <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
          <Camera className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Onboarding · Ta photo
        </span>
        <h1 className="f-display h-rise t-h1 text-[var(--t-1)]">Mets un visage sur ton prénom.</h1>
        <p className="t-body mt-1 max-w-[52ch] text-[var(--t-2)]">
          Ta photo apparaît sur le classement des membres, à côté de ton prénom. Elle aide la
          communauté à se reconnaître. Tu peux la mettre maintenant ou plus tard depuis tes
          paramètres, c&apos;est toi qui vois.
        </p>
      </header>

      <section
        aria-label="Choisir ma photo"
        className="wow-rise rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-5"
        style={{ '--rise-delay': '120ms' } as CSSProperties}
      >
        <AvatarSettings initialUrl={url} initials={initials} firstName={firstName} />
      </section>

      <div
        className="wow-rise flex flex-col-reverse items-center gap-3 sm:flex-row sm:justify-between"
        style={{ '--rise-delay': '180ms' } as CSSProperties}
      >
        <Link
          href="/onboarding/interview"
          className="text-[13px] font-medium text-[var(--t-3)] underline underline-offset-2 transition-colors hover:text-[var(--t-1)]"
        >
          Passer pour l&apos;instant
        </Link>
        <Link
          href="/onboarding/interview"
          className={cn(
            btnVariants({ kind: 'primary', size: 'l' }),
            'w-full justify-center sm:w-auto',
          )}
        >
          Continuer
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
