import { ArrowLeft, CheckCircle2, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { DrawnRule } from '@/components/dashboard/drawn-rule';
import { TrackingWizard } from '@/components/tracking/tracking-wizard';
import { getAxisLabel } from '@/lib/tracking/axes';
import { computeOccurrenceKey } from '@/lib/tracking/cadence';
import {
  getTrackingEntry,
  resolveCurrentInstrument,
  type SerializedTrackingEntry,
} from '@/lib/tracking/service';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Mon suivi',
};

/**
 * V2 S2 — `/tracking/[instrument]` : the universal tracking-engine capture
 * surface (member-facing). RSC, mirror of `/mindset/new` :
 *
 *   - auth re-check → /login (defence-in-depth on top of the action's check) ;
 *   - resolve the CURRENT instrument from the slug, `notFound()` on an unknown
 *     key (a stale link never renders a broken wizard) ;
 *   - the occurrence slot is SERVER-derived from the cadence (Europe/Paris,
 *     anti-tamper §27.3 mirror) — the client never computes it ;
 *   - prefill from the existing capture for this occurrence (re-submit edits in
 *     place, DoD case 7 — no broken double-tap) ;
 *   - `?done=1` shows a calm, non-judgemental acknowledgement (§31.2 — never a
 *     streak/score reveal).
 *
 * Posture §2 : the instrument is CLOSED ; this page surfaces only process /
 * psychology signals, never market content.
 */
export default async function TrackingInstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ instrument: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ instrument: instrumentKey }, { done }] = await Promise.all([params, searchParams]);

  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const instrument = resolveCurrentInstrument(instrumentKey);
  if (!instrument) notFound();

  const timezone = session.user.timezone ?? 'Europe/Paris';

  // Server-derived occurrence for scheduled cadences (anti-tamper). per_trade /
  // manual instruments are event-bound and aren't surfaced by this recurring
  // page, so there is no shipped path here that needs a nonce.
  const scheduled = instrument.cadence.kind === 'daily' || instrument.cadence.kind === 'weekly';
  const occurrenceKey = scheduled
    ? computeOccurrenceKey(instrument.cadence, new Date(), timezone)
    : 'current';

  const existing: SerializedTrackingEntry | null = scheduled
    ? await getTrackingEntry(session.user.id, instrument.key, occurrenceKey)
    : null;

  const justSubmitted = done === '1';

  return (
    <main className="relative flex min-h-dvh w-full flex-col bg-[var(--bg)]">
      <DashboardAmbient />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4">
          <Link
            href="/dashboard"
            className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Mon tableau de bord
          </Link>

          <div className="flex flex-col gap-1.5">
            <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={2} />
              Suivi · {getAxisLabel(instrument.axis)}
            </span>
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              {existing ? `Reprendre · ${instrument.title}` : instrument.title}
            </h1>
          </div>
          <DrawnRule className="max-w-[220px]" />
        </header>

        {justSubmitted ? (
          <div
            role="status"
            aria-live="polite"
            data-slot="tracking-done"
            className="rounded-card flex items-start gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-4"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--acc)]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-[13px] leading-relaxed text-[var(--t-2)]">
              C&apos;est noté — ton suivi est enregistré. Tu peux ajuster tes réponses tant que la
              période est en cours ; rien n&apos;est figé, c&apos;est juste un repère pour toi.
            </p>
          </div>
        ) : null}

        <TrackingWizard
          instrument={instrument}
          occurrenceKey={occurrenceKey}
          {...(existing ? { prefill: existing } : {})}
        />
      </div>
    </main>
  );
}
