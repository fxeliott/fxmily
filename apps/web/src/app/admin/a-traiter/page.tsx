import {
  Activity,
  ArrowLeft,
  ClipboardCheck,
  MessageSquarePlus,
  ScaleIcon,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { DashboardAmbient } from '@/components/dashboard/dashboard-ambient';
import { Pill } from '@/components/ui/pill';
import { TriageSection, type TriageRow } from '@/components/admin/a-traiter/triage-section';
import {
  getTriageQueueCounts,
  listOpenDiscrepancies,
  listRecentBehavioralSignals,
  listStaleOpenTrades,
  listUncommentedClosedTrades,
  BEHAVIORAL_SIGNAL_RECENT_DAYS,
  STALE_OPEN_TRADE_HOURS,
} from '@/lib/admin/attention-service';

export const metadata = {
  title: 'À traiter · Admin',
};

export const dynamic = 'force-dynamic';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const R_FMT = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DIRECTION_LABEL = { long: 'Long', short: 'Short' } as const;

/** Cuids only — a forged pagination param degrades to page 1, never a 500.
 *  Mirror of the member-detail page `parseCursor`. */
function parseCursor(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

/** Build a « voir plus » href that advances ONE section's cursor while keeping
 *  the other sections on their current page. */
function moreHref(
  current: {
    tc?: string | undefined;
    to?: string | undefined;
    ec?: string | undefined;
    sg?: string | undefined;
  },
  key: 'tc' | 'to' | 'ec' | 'sg',
  next: string,
): string {
  const params = new URLSearchParams();
  const merged = { ...current, [key]: next };
  if (merged.tc) params.set('tc', merged.tc);
  if (merged.to) params.set('to', merged.to);
  if (merged.ec) params.set('ec', merged.ec);
  if (merged.sg) params.set('sg', merged.sg);
  const qs = params.toString();
  return qs ? `/admin/a-traiter?${qs}` : '/admin/a-traiter';
}

interface AtraiterPageProps {
  searchParams: Promise<{ tc?: string; to?: string; ec?: string; sg?: string }>;
}

/**
 * Tour 13 — `/admin/a-traiter` : the coach's unified work queue.
 *
 * `attention-service` computes per-member + cohort COUNTS, surfaced on the
 * members strip and the hub. But nothing listed the underlying rows cohort-wide,
 * so the coach saw a number then hunted member-by-member (4 clicks / trade).
 * This page turns the counts into an actionable list: three sections, each row a
 * direct link to the surface where the coach acts, oldest-first (the natural
 * work order), cursor-paginated so it scales with the cohort.
 *
 * Auth : same gate as every `/admin/*` page (`auth()` → admin role → /login).
 */
export default async function AtraiterPage({ searchParams }: AtraiterPageProps) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'admin') redirect('/login');

  const { tc: rawTc, to: rawTo, ec: rawEc, sg: rawSg } = await searchParams;
  const cursors = {
    tc: parseCursor(rawTc),
    to: parseCursor(rawTo),
    ec: parseCursor(rawEc),
    sg: parseCursor(rawSg),
  };

  const [counts, uncommented, staleOpen, gaps, signals] = await Promise.all([
    getTriageQueueCounts(),
    listUncommentedClosedTrades({ cursor: cursors.tc }),
    listStaleOpenTrades({ cursor: cursors.to }),
    listOpenDiscrepancies({ cursor: cursors.ec }),
    listRecentBehavioralSignals({ cursor: cursors.sg }),
  ]);

  const uncommentedRows: TriageRow[] = uncommented.items.map((t) => {
    const r = t.realizedR;
    return {
      id: t.id,
      href: t.href,
      title: `${t.memberLabel} · ${t.pair} ${DIRECTION_LABEL[t.direction]}`,
      meta: `Clôturé le ${DATE_FMT.format(new Date(t.closedAt))}`,
      ariaLabel: `Commenter le trade ${t.pair} de ${t.memberLabel}`,
      trailing:
        r === null ? (
          <span className="f-mono text-[12px] text-[var(--t-4)] tabular-nums">-</span>
        ) : (
          // Red/green here reflects the trade's OWN realized outcome (allowed);
          // the queue chrome itself never uses red (SPEC §2).
          <span
            className={[
              'f-mono text-[12px] font-semibold tabular-nums',
              r > 0 ? 'text-[var(--ok)]' : r < 0 ? 'text-[var(--bad)]' : 'text-[var(--t-3)]',
            ].join(' ')}
          >
            {r > 0 ? '+' : ''}
            {R_FMT.format(r)}R
          </span>
        ),
    };
  });

  const staleRows: TriageRow[] = staleOpen.items.map((t) => ({
    id: t.id,
    href: t.href,
    title: `${t.memberLabel} · ${t.pair} ${DIRECTION_LABEL[t.direction]}`,
    meta: `Ouvert depuis le ${DATE_FMT.format(new Date(t.enteredAt))}`,
    ariaLabel: `Voir le trade encore ouvert ${t.pair} de ${t.memberLabel}`,
    trailing: (
      <Pill tone="warn" dot>
        Ouvert
      </Pill>
    ),
  }));

  const gapRows: TriageRow[] = gaps.items.map((d) => ({
    id: d.id,
    href: d.href,
    title: `${d.memberLabel} · ${d.label}`,
    meta: `Détecté le ${DATE_FMT.format(new Date(d.detectedAt))}`,
    ariaLabel: `Traiter l'écart de ${d.memberLabel}`,
  }));

  const signalRows: TriageRow[] = signals.items.map((s) => ({
    id: s.id,
    href: s.href,
    title: s.memberLabel,
    // The signals are the already-stored `triggeredBy` labels (« 3 trades
    // perdants consécutifs sur 24h »…). Join the distinct recent ones, then the
    // most-recent date — factual, never a verdict (SPEC §2).
    meta: `${s.signals.join(' · ')} · dernier signal le ${DATE_FMT.format(new Date(s.latestAt))}`,
    ariaLabel: `Ouvrir la fiche de ${s.memberLabel} (${s.signals.length} signal${
      s.signals.length > 1 ? 'aux' : ''
    } récent${s.signals.length > 1 ? 's' : ''})`,
    trailing: (
      <Pill tone="acc" dot>
        {s.signals.length} signal{s.signals.length > 1 ? 'aux' : ''}
      </Pill>
    ),
  }));

  const allClear = counts.total === 0;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-[var(--w-app)] flex-col gap-6 px-4 py-8 lg:px-8 2xl:px-12">
      <DashboardAmbient />

      <header className="relative flex flex-col gap-4">
        <Link
          href="/admin"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Console
        </Link>
        <div className="flex flex-col gap-1.5">
          <span className="t-eyebrow-lg inline-flex items-center gap-1.5 text-[var(--t-3)]">
            <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={2} />
            File de travail
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="f-display h-rise text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-[var(--t-1)] sm:text-[32px]"
              style={{ fontFeatureSettings: '"ss01" 1' }}
            >
              À traiter
            </h1>
            {counts.total > 0 ? <Pill tone="acc">{counts.total} au total</Pill> : null}
          </div>
          <p className="t-lead max-w-prose">
            Tout ce qui attend ton regard, réuni au même endroit et rangé du plus ancien au plus
            récent. Chaque ligne mène directement là où tu agis.
          </p>
        </div>
      </header>

      {allClear ? (
        <div className="rounded-card relative flex flex-col items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-6 py-16 text-center shadow-[var(--sh-card)]">
          <span className="rounded-control grid h-11 w-11 place-items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
            <ClipboardCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <p className="text-[15px] font-semibold text-[var(--t-1)]">Tout est traité</p>
          <p className="t-cap max-w-sm text-[var(--t-3)]">
            Aucun trade à commenter, aucun trade resté ouvert, aucun écart en attente. La file est
            vide, beau travail.
          </p>
        </div>
      ) : (
        <div className="relative flex flex-col gap-4">
          <TriageSection
            icon={MessageSquarePlus}
            title="Trades à commenter"
            tone="acc"
            count={counts.uncommentedClosed}
            rows={uncommentedRows}
            shownCount={uncommentedRows.length}
            moreHref={
              uncommented.nextCursor ? moreHref(cursors, 'tc', uncommented.nextCursor) : null
            }
            emptyLabel="Chaque trade clôturé a reçu ton retour. Rien à commenter pour l'instant."
          />

          <TriageSection
            icon={Timer}
            title="Trades encore ouverts"
            tone="warn"
            count={counts.staleOpen}
            rows={staleRows}
            shownCount={staleRows.length}
            moreHref={staleOpen.nextCursor ? moreHref(cursors, 'to', staleOpen.nextCursor) : null}
            emptyLabel={`Aucun trade laissé ouvert au-delà de ${STALE_OPEN_TRADE_HOURS} heures. Les positions sont bien clôturées.`}
          />

          <TriageSection
            icon={ScaleIcon}
            title="Écarts ouverts"
            tone="cy"
            count={counts.openDiscrepancies}
            rows={gapRows}
            shownCount={gapRows.length}
            moreHref={gaps.nextCursor ? moreHref(cursors, 'ec', gaps.nextCursor) : null}
            emptyLabel="Aucun écart entre le déclaré et la réalité en attente. Tout est réconcilié."
          />

          <TriageSection
            icon={Activity}
            title="Signaux comportementaux"
            tone="acc"
            count={counts.behavioralSignals}
            rows={signalRows}
            shownCount={signalRows.length}
            moreHref={signals.nextCursor ? moreHref(cursors, 'sg', signals.nextCursor) : null}
            emptyLabel={`Aucun signal comportemental détecté ces ${BEHAVIORAL_SIGNAL_RECENT_DAYS} derniers jours. Le climat est calme.`}
          />
        </div>
      )}
    </main>
  );
}
