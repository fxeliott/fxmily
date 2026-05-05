import Image from 'next/image';
import Link from 'next/link';

import { findInvitationByToken } from '@/lib/auth/invitations';

import { OnboardingForm } from './onboarding-form';

export const metadata = {
  title: 'Bienvenue sur Fxmily',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function OnboardingWelcomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (tokenParam ?? '').trim();

  if (!token) {
    return <ErrorState reason="missing" />;
  }

  const lookup = await findInvitationByToken(token);
  if (!lookup.ok) {
    return <ErrorState reason={lookup.reason} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-4 py-10">
      <header className="flex flex-col items-center gap-3">
        <Image
          src="/logo.png"
          width={56}
          height={56}
          alt="Fxmily"
          className="rounded-lg"
          priority
        />
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Bienvenue sur Fxmily
        </h1>
        <p className="text-center text-sm text-[var(--muted)]">
          Crée ton compte pour activer ton accès.
        </p>
      </header>

      <OnboardingForm token={token} email={lookup.invitation.email} />
    </main>
  );
}

function ErrorState({ reason }: { reason: 'missing' | 'unknown' | 'expired' | 'already_used' }) {
  const message = (() => {
    switch (reason) {
      case 'missing':
        return "Ce lien est incomplet. Vérifie l'URL reçue par email.";
      case 'unknown':
        return "Ce lien d'invitation n'existe pas ou n'est plus valide.";
      case 'expired':
        return 'Ce lien a expiré. Demande à Eliot une nouvelle invitation.';
      case 'already_used':
        return 'Ce lien a déjà servi à créer un compte. Tu peux te connecter.';
    }
  })();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <h1 className="text-xl font-semibold text-[var(--foreground)]">Lien invalide</h1>
      <p className="text-sm text-[var(--muted)]">{message}</p>
      <Link
        href="/login"
        className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:border-[var(--accent)]"
      >
        Aller à la connexion
      </Link>
    </main>
  );
}
