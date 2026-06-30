import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { auth } from '@/auth';
import { BrandMark } from '@/components/brand/brand-mark';
import { Card } from '@/components/ui/card';

import { LoginAurora } from '../login/login-aurora';
import { ForgotForm } from './forgot-form';

export const metadata = {
  title: 'Mot de passe oublié',
  // Phase T security — V1 closed cohort, no SEO discovery.
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  // Already signed in? A reset request is pointless — send them home.
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
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
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Mot de passe oublié
            </h1>
            <p className="t-body text-center text-[var(--t-3)]">
              Indique ton email, on t&apos;envoie un lien de réinitialisation.
            </p>
          </header>

          <ForgotForm />
        </Card>

        <p
          className="wow-rise text-center text-[11px] text-[var(--t-4)] tabular-nums"
          style={{ '--rise-delay': '170ms' } as CSSProperties}
        >
          Cohorte privée · accès uniquement par invitation
        </p>
      </section>
    </main>
  );
}
