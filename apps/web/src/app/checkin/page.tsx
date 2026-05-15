import { ArrowLeft, ArrowRight, Check, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { StreakCard } from '@/components/checkin/streak-card';
import { TrendCard } from '@/components/checkin/trend-card';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { getCheckinStatus, getLast7Days, getStreak } from '@/lib/checkin/service';
import { formatLocalDate } from '@/lib/checkin/timezone';
import { cn } from '@/lib/utils';

export const metadata = {
  title: 'Check-in quotidien · Fxmily',
};

// Reads cookies (auth) + DB — must be dynamic so each member sees fresh state.
export const dynamic = 'force-dynamic';

interface CheckinLandingPageProps {
  searchParams: Promise<{ slot?: string; done?: string }>;
}

export default async function CheckinLandingPage({ searchParams }: CheckinLandingPageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const userId = session.user.id;
  // J5.5 — read timezone from the JWT-backed session (default Europe/Paris).
  const timezone = session.user.timezone || 'Europe/Paris';

  const [status, streak, last7] = await Promise.all([
    getCheckinStatus(userId, timezone),
    getStreak(userId, timezone),
    getLast7Days(userId, timezone),
  ]);

  const params = await searchParams;
  const justDone = params.done === '1';
  const justDoneSlot = params.slot === 'morning' || params.slot === 'evening' ? params.slot : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Retour au tableau
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow">{formatLocalDate(status.today)}</span>
          <h1
            className="f-display text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
            style={{ fontFeatureSettings: '"ss01" 1' }}
          >
            Check-in quotidien
          </h1>
          <p className="t-lead">
            Deux temps : matin pour cadrer, soir pour réfléchir. Trois minutes chacun. C&apos;est ce
            qui construit le score discipline.
          </p>
        </div>
      </header>

      {justDone && justDoneSlot ? <DoneBanner slot={justDoneSlot} streak={streak.current} /> : null}

      <StreakCard streak={streak.current} todayFilled={streak.todayFilled} />

      <TrendCard days={last7} />

      <section className="grid gap-4 sm:grid-cols-2">
        <SlotCard slot="morning" submitted={status.morningSubmitted} href="/checkin/morning" />
        <SlotCard slot="evening" submitted={status.eveningSubmitted} href="/checkin/evening" />
      </section>

      <section>
        <Card className="flex flex-col gap-2 p-5">
          <span className="t-eyebrow">Pourquoi deux fois par jour ?</span>
          <p className="t-body text-[var(--t-2)]">
            Le matin capture ton état physique et ton intention <em>avant</em> le marché. Le soir
            mesure ce qui s&apos;est passé : discipline, stress, émotions. Croisés sur 30 jours, ces
            deux signaux révèlent les patterns qui dégradent ton edge.
          </p>
          <p className="t-cap text-[var(--t-4)]">
            Tu peux passer un slot — mais le streak ne tient que si tu en fais au moins un par jour.
          </p>
        </Card>
      </section>
    </main>
  );
}

function SlotCard({
  slot,
  submitted,
  href,
}: {
  slot: 'morning' | 'evening';
  submitted: boolean;
  href: '/checkin/morning' | '/checkin/evening';
}) {
  const isMorning = slot === 'morning';
  const Icon = isMorning ? Sun : Moon;
  const title = isMorning ? 'Matin' : 'Soir';
  const sub = isMorning ? 'Sommeil · routine · intention' : 'Discipline · stress · journal';

  return (
    <Link href={href} className="block">
      <Card
        interactive
        className={cn(
          'relative flex flex-col gap-3 p-5 transition-all',
          submitted && 'border-[var(--b-acc)] bg-[var(--acc-dim-2)]',
        )}
      >
        <div className="flex items-start justify-between">
          <div className="rounded-control grid h-10 w-10 shrink-0 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          {submitted ? (
            <Pill tone="acc" dot="live">
              FAIT
            </Pill>
          ) : (
            <Pill tone="cy">À FAIRE</Pill>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="t-h3 text-[var(--t-1)]">{title}</h3>
          <p className="t-cap text-[var(--t-3)]">{sub}</p>
        </div>
        <div className="mt-1 flex items-center justify-between text-[12px] text-[var(--t-3)]">
          <span>{submitted ? 'Voir / éditer' : '~3 minutes'}</span>
          {submitted ? (
            <Check className="h-4 w-4 text-[var(--acc)]" strokeWidth={2} />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </div>
      </Card>
    </Link>
  );
}

function DoneBanner({ slot, streak }: { slot: 'morning' | 'evening'; streak: number }) {
  const word = slot === 'morning' ? 'matin' : 'soir';
  // Fixed broken sentence ("À ce soir pour le matin (demain) check-in.") flagged
  // by the J5 content audit. Now grammatically clean and slot-aware.
  const followUp = slot === 'morning' ? 'On se retrouve ce soir.' : 'On se retrouve demain matin.';
  return (
    <div
      role="status"
      className="confirm-flash rounded-card border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <Check className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="flex flex-1 flex-col leading-tight">
          <span className="text-[13px] font-semibold text-[var(--t-1)]">
            Check-in {word} enregistré · streak {streak} jour{streak > 1 ? 's' : ''}
          </span>
          <span className="t-cap text-[var(--t-3)]">{followUp}</span>
        </div>
      </div>
    </div>
  );
}
