import type { SerializedTrainingDebrief } from '@/lib/training-debrief/service';

/**
 * V1.3 — TrainingDebrief landing timeline (SPEC §23.4, member, read-only).
 *
 * Calm cyan reflection cards — NO link (this jalon ships no debrief-detail
 * route, §23.6: annotation/detail is a separate later §21.6 follow-up). The
 * timeline is a recul mirror, not a scoreboard: no streak, no score, no
 * gamification (SPEC §23 calm invariant). Server Component.
 *
 * V1.9 TIER F perf — `Intl.DateTimeFormat` hoisted at module level so the
 * (≤12) rows don't each instantiate one.
 */

const FMT_SUBMITTED_AT_FR = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const FMT_WEEK_RANGE_DAY = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function FormattedRange({ weekStart }: { weekStart: string }) {
  const weekEnd = addDaysIso(weekStart, 6);
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return FMT_WEEK_RANGE_DAY.format(new Date(Date.UTC(y, m - 1, d)));
  };
  return (
    <>
      <time dateTime={weekStart}>{fmt(weekStart)}</time>
      <span aria-hidden="true"> → </span>
      <time dateTime={weekEnd}>{fmt(weekEnd)}</time>
    </>
  );
}

export function TrainingDebriefTimeline({
  debriefs,
}: {
  debriefs: readonly SerializedTrainingDebrief[];
}) {
  if (debriefs.length === 0) {
    return (
      <div
        className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
        data-empty="true"
      >
        <p className="t-body text-[var(--t-2)]">
          Aucun débrief pour l&apos;instant. Le dimanche soir est un bon moment pour prendre du
          recul sur ta semaine d&apos;entraînement.
        </p>
      </div>
    );
  }

  return (
    <ul className="dash-stagger flex flex-col gap-2.5" data-slot="training-debrief-timeline">
      {debriefs.map((d) => (
        <li
          key={d.id}
          className="rounded-card relative block overflow-hidden border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
        >
          {/* Liseré cyan décoratif (identité §21.7 training) — read-only, pas de
              hover-lift (la timeline est un miroir de recul, pas un scoreboard). */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--cy-edge)] to-transparent"
          />
          <header className="flex items-baseline justify-between gap-3">
            <p className="t-eyebrow text-[var(--cy)]">
              Semaine du <FormattedRange weekStart={d.weekStart} />
            </p>
            <p className="t-cap font-mono text-[var(--t-3)]">
              {FMT_SUBMITTED_AT_FR.format(new Date(d.submittedAt))}
            </p>
          </header>
          <dl className="mt-2 flex flex-col gap-1.5">
            <div>
              <dt className="sr-only">Forces de process</dt>
              <dd className="t-body line-clamp-2 text-[var(--t-2)]">
                <strong className="text-[var(--t-1)]">Forces :</strong> {d.processStrengthOne}
                {' · '}
                {d.processStrengthTwo}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Micro-ajustement</dt>
              <dd className="t-cap line-clamp-1 text-[var(--t-3)]">
                <span className="font-semibold">Ajustement :</span> {d.microAdjustment}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Leçon transversale</dt>
              <dd className="t-cap line-clamp-1 text-[var(--t-3)]">
                <span className="font-semibold">Leçon :</span> {d.transversalLesson}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
