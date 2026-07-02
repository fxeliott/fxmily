import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { LoginAurora } from '@/app/login/login-aurora';
import { BrandMark } from '@/components/brand/brand-mark';
import { btnVariants } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { findResetTokenByToken } from '@/lib/auth/password-reset';

import { ResetForm } from './reset-form';

export const metadata = {
  title: 'Réinitialiser le mot de passe',
  // Phase T security — V1 closed cohort, no SEO discovery.
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (tokenParam ?? '').trim();

  if (!token) {
    return <InvalidTokenView reason="missing" />;
  }

  // Validate freshness/single-use BEFORE rendering the form, so a stale link
  // shows a clear recovery path instead of a form that will only fail on submit.
  const lookup = await findResetTokenByToken(token);
  if (!lookup.ok) {
    return <InvalidTokenView reason={lookup.reason} />;
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-10">
      <LoginAurora />

      <section className="relative z-10 flex w-full max-w-sm flex-col gap-6">
        <Link
          href="/"
          className="wow-rise flex items-center justify-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="grid h-8 w-8 place-items-center rounded-[6px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <BrandMark className="w-[19px]" />
          </div>
          <span className="f-display text-[15px] font-semibold tracking-[-0.01em]">Fxmily</span>
        </Link>

        <Card
          primary
          className="wow-rise px-6 py-7"
          style={{ '--rise-delay': '90ms' } as CSSProperties}
        >
          <header className="mb-6 flex flex-col items-center gap-2">
            <div className="relative mb-1.5">
              <div
                aria-hidden
                className="absolute inset-0 rounded-full bg-[var(--acc-dim)] blur-xl"
              />
              <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--bg-2)] text-[var(--acc)]">
                <KeyRound className="h-5 w-5" strokeWidth={1.75} />
              </div>
            </div>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Nouveau mot de passe
            </h1>
            <p className="t-body text-center text-[var(--t-3)]">
              Choisis un nouveau mot de passe pour ton compte.
            </p>
          </header>

          <ResetForm token={token} />
        </Card>

        <p
          className="wow-rise text-center text-[11px] text-[var(--t-4)] tabular-nums"
          style={{ '--rise-delay': '170ms' } as CSSProperties}
        >
          Ce lien expire 30&nbsp;minutes après l&apos;envoi
        </p>
      </section>
    </main>
  );
}

function InvalidTokenView({
  reason,
}: {
  reason: 'missing' | 'unknown' | 'expired' | 'already_used';
}) {
  const headline = reason === 'already_used' ? 'Lien déjà utilisé' : 'Lien invalide';

  const action = (() => {
    switch (reason) {
      case 'missing':
        return "Ce lien est incomplet. Vérifie l'URL reçue par email. Elle doit contenir un token complet.";
      case 'unknown':
        return "Ce lien de réinitialisation n'existe pas ou n'est plus valide. Refais une demande.";
      case 'expired':
        return 'Les liens de réinitialisation expirent au bout de 30 minutes. Refais une demande.';
      case 'already_used':
        return 'Ce lien a déjà servi à changer un mot de passe. Refais une demande si besoin.';
    }
  })();

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-10">
      <LoginAurora />
      <section className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-5">
        <Card primary className="py-2">
          <ErrorState headline={headline} action={action} />
        </Card>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/forgot-password" className={btnVariants({ kind: 'primary', size: 'm' })}>
            Refaire une demande
          </Link>
          <Link href="/login" className={btnVariants({ kind: 'secondary', size: 'm' })}>
            Aller à la connexion
          </Link>
        </div>
      </section>
    </main>
  );
}
