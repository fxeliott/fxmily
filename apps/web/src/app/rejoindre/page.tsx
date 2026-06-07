import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { RequestAccessForm } from '@/components/access-request/request-access-form';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

export const metadata = {
  title: 'Rejoindre Fxmily',
  description: 'Demande ton accès à la cohorte privée Fxmily — le journal qui ignore le marché.',
  // V1 closed cohort — no SEO discovery (mirror /login).
  robots: { index: false, follow: false },
};

/**
 * Public self-service access-request landing (V2.5 — the front door).
 *
 * Reachable WITHOUT auth (added to `PUBLIC_EXACT` in `auth.config.ts`). An
 * already-logged-in user is bounced to /dashboard (no point requesting access).
 * Premium, mobile-first DS-v2 dark : brand → eyebrow → heading → form → calm
 * cohort note + link back to /login.
 */
export default async function RejoindrePage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <main className="aurora relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="orb pointer-events-none absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full opacity-20"
        style={{
          background: 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.20) 0%, transparent 70%)',
        }}
      />

      <section className="relative z-10 flex w-full max-w-md flex-col gap-6">
        <Link
          href="/"
          className="flex items-center justify-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <div className="grid h-8 w-8 place-items-center rounded-[6px] border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[12px] font-bold text-[var(--acc)]">
            F
          </div>
          <span className="f-display text-[15px] font-semibold tracking-[-0.01em]">Fxmily</span>
        </Link>

        <Card primary className="px-6 py-7">
          <header className="mb-6 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Pill tone="acc">COHORTE PRIVÉE</Pill>
              <span className="t-eyebrow">Demande d&apos;accès</span>
            </div>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              Rejoindre Fxmily
            </h1>
            <p className="t-lead">
              Le seul journal qui mesure ton plan, ta discipline et ton mental — pas les bougies.
              Laisse tes coordonnées : ta demande sera étudiée et tu recevras un email dès
              qu&apos;elle est acceptée.
            </p>
          </header>

          <RequestAccessForm />
        </Card>

        <div className="rounded-control flex items-start gap-2.5 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 py-2.5">
          <ShieldCheck
            className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--acc)]"
            strokeWidth={1.75}
          />
          <p className="t-cap text-[var(--t-2)]">
            Accès sur validation. Tes coordonnées ne servent qu&apos;à traiter ta demande et ne sont
            jamais partagées.
          </p>
        </div>

        <p className="text-center text-[11px] text-[var(--t-4)]">
          Déjà membre ?{' '}
          <Link href="/login" className="text-[var(--acc)] underline-offset-2 hover:underline">
            Se connecter
          </Link>
        </p>
      </section>
    </main>
  );
}
