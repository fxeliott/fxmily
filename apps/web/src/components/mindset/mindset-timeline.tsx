import { computeMindsetProfile } from '@/lib/mindset/profile';
import type { SerializedMindsetCheck } from '@/lib/mindset/service';

/**
 * V1.5 — MindsetCheck landing timeline (SPEC §27.4, member, read-only).
 *
 * Calm reflection log — NO link (this jalon ships no check-detail route) and
 * NO scoreboard: no streak, no rank, no fanfare (anti Black-Hat §27.7). Each
 * row surfaces a STRENGTH ("point d'appui" = the highest dimension), never a
 * deficit, and an honest overall — `null` reads "en cours de constitution",
 * NEVER a fabricated 0 (§27.4). DS-v2 NEUTRAL (no cyan, no `.v18-theme`).
 * Server Component; the profile is computed PURELY per row (no DB).
 *
 * V1.9 TIER F perf — `Intl.DateTimeFormat` hoisted at module level so the
 * (≤12) rows don't each instantiate one.
 */

const FMT_UPDATED_AT_FR = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const FMT_DAY_FR = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return FMT_DAY_FR.format(new Date(Date.UTC(y, m - 1, d)));
}

interface RowReading {
  /** Honest overall 0–100, or null ("en cours") — never a fake 0. */
  overall: number | null;
  /** Highest-scoring dimension label (a strength), or null if none scored. */
  strengthLabel: string | null;
}

function readingOf(check: SerializedMindsetCheck): RowReading {
  const profile = computeMindsetProfile(check.instrumentVersion, check.responses);
  if (!profile) return { overall: null, strengthLabel: null };
  let strength: { label: string; score: number } | null = null;
  for (const dim of profile.dimensions) {
    if (dim.score !== null && (strength === null || dim.score > strength.score)) {
      strength = { label: dim.label, score: dim.score };
    }
  }
  return { overall: profile.overall, strengthLabel: strength?.label ?? null };
}

export function MindsetTimeline({ checks }: { checks: readonly SerializedMindsetCheck[] }) {
  if (checks.length === 0) {
    return (
      <div
        className="rounded-card-lg border border-dashed border-[var(--b-strong)] p-6 text-center"
        data-empty="true"
      >
        <p className="t-body text-[var(--t-2)]">
          Aucune auto-évaluation pour l&apos;instant. Le lundi est un bon moment pour faire le point
          sur ton état d&apos;esprit de la semaine — sans bonne ni mauvaise réponse.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5" data-slot="mindset-timeline">
      {checks.map((c) => {
        const { overall, strengthLabel } = readingOf(c);
        return (
          <li
            key={c.id}
            className="rounded-card block border border-[var(--b-default)] bg-[var(--bg-1)] p-4"
          >
            <header className="flex items-baseline justify-between gap-3">
              <p className="t-eyebrow-lg text-[var(--t-3)]">
                Semaine du <time dateTime={c.weekStart}>{fmtDay(c.weekStart)}</time>
                <span aria-hidden="true"> → </span>
                <time dateTime={c.weekEnd}>{fmtDay(c.weekEnd)}</time>
              </p>
              <p className="t-cap font-mono text-[var(--t-3)]">
                {FMT_UPDATED_AT_FR.format(new Date(c.updatedAt))}
              </p>
            </header>
            <dl className="mt-2 flex flex-col gap-1.5">
              <div>
                <dt className="sr-only">Profil global</dt>
                <dd className="t-body text-[var(--t-2)]">
                  <strong className="text-[var(--t-1)]">Profil :</strong>{' '}
                  {overall === null ? (
                    <span className="text-[var(--t-3)]">en cours de constitution</span>
                  ) : (
                    <span className="font-mono text-[var(--acc)]">{overall}/100</span>
                  )}
                </dd>
              </div>
              {strengthLabel ? (
                <div>
                  <dt className="sr-only">Point d&apos;appui</dt>
                  <dd className="t-cap text-[var(--t-3)]">
                    <span className="font-semibold">Point d&apos;appui :</span> {strengthLabel}
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
