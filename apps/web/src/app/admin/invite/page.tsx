import { ArrowLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';

import { InviteForm } from './invite-form';

export const metadata = {
  title: 'Inviter un membre · Fxmily Admin',
};

export default async function AdminInvitePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'admin') redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-4">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Retour au tableau
        </Link>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Pill tone="acc">ADMIN</Pill>
            <span className="t-eyebrow">Invitations</span>
          </div>
          <h1
            className="f-display h-rise text-[28px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Inviter un membre
          </h1>
          <p className="t-lead">
            Le membre recevra un email avec un lien personnel valable{' '}
            <span className="font-mono tabular-nums text-[var(--t-1)]">7 jours</span>. Le lien est
            unique et ne peut servir qu&apos;une seule fois.
          </p>
        </div>
      </header>

      <Card className="px-6 py-6">
        <InviteForm />
      </Card>

      <div className="rounded-control flex items-start gap-2.5 border border-[oklch(0.789_0.139_217_/_0.30)] bg-[var(--cy-dim)] px-3 py-2.5">
        <Send className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--cy)]" strokeWidth={1.75} />
        <p className="t-cap text-[var(--t-2)]">
          Si Resend n&apos;est pas configuré en dev, le lien d&apos;invitation est loggué dans la
          console serveur — utile pour tester localement sans envoyer d&apos;email.
        </p>
      </div>
    </main>
  );
}
