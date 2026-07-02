import type { ConstancyScoreView } from '@/lib/verification/constancy';

/**
 * S4 — constancy trajectory on `/verification` (brief §29 « voir l'évolution »,
 * §31 le score de constance est un livrable de tête). The `ConstancyScoreCard`
 * answers « où j'en suis cette semaine » ; this answers « comment ça bouge ».
 * Closes the asymmetry with the behavioral scores, which already get a
 * trajectory (`ScoreTrendChart` on `/progression`).
 *
 * Posture §33.2 (anti Black-Hat, BLOQUANT) : factual line, never punitive — no
 * red/green verdict, no streak, no « tu as chuté ». A fixed 0→100 y-scale keeps
 * the level honest (a line near the top = high constancy). Native server-rendered
 * SVG, 0-JS (mirrors the card's `ScoreBreakdown` canon) and fully fluid via
 * `viewBox` + `w-full` — no fixed-width sparkline, scales from iPhone SE up.
 */

// `h.periodStart` is a UTC-midnight PIN of the cohort's shared civil week, not a
// per-member instant — format in the UTC frame so the week label is stable for
// every member (Europe/Paris rolled the day back for negative-offset members).
const PERIOD_FMT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const VB_W = 300;
const VB_H = 64;
const PAD = 6;

export function ConstancyTrend({ history }: { history: readonly ConstancyScoreView[] }) {
  // < 2 weeks → no trajectory yet ; the snapshot card already carries the state.
  if (history.length < 2) return null;

  const values = history.map((h) => Math.round(h.value));
  const first = history[0]!;
  const last = history[history.length - 1]!;

  const n = values.length;
  const x = (i: number) => (i / (n - 1)) * (VB_W - PAD * 2) + PAD;
  // Fixed 0→100 scale: vertical position reads as the real score level (honest,
  // §33.2), never min/max-stretched to dramatize a tiny weekly wobble.
  const y = (v: number) => VB_H - PAD - (v / 100) * (VB_H - PAD * 2);

  const points = values.map((v, i) => [x(i), y(v)] as const);
  const line = points
    .map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${(VB_W - PAD).toFixed(1)} ${VB_H} L${PAD} ${VB_H} Z`;

  // Terminal point ("où tu en es maintenant") emphasised by a crisp HTML dot
  // OVERLAID on the SVG. The SVG uses preserveAspectRatio="none" (non-uniform
  // scale) so an in-SVG <circle> would render as an ellipse — an HTML overlay
  // positioned by % stays a true circle at any width. Static + calm (no pulse,
  // §33.2): it marks the latest level, never dramatises it.
  const [lastX, lastY] = points[points.length - 1]!;
  const lastLeftPct = (lastX / VB_W) * 100;
  const lastTopPct = (lastY / VB_H) * 100;

  return (
    <div className="rounded-card flex flex-col gap-3 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 transition-colors hover:border-[var(--cy-edge)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-eyebrow text-[var(--t-3)]">Ton évolution</span>
        <span className="t-cap text-[var(--t-4)]">
          {n} semaine{n > 1 ? 's' : ''} suivie{n > 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative h-16 w-full">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Évolution de ton score de constance sur ${n} semaines : de ${values[0]} sur 100 (semaine du ${PERIOD_FMT.format(first.periodStart)}) à ${values[n - 1]} sur 100 (semaine du ${PERIOD_FMT.format(last.periodStart)}).`}
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="constancy-trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--cy)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--cy)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#constancy-trend-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--cy)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Terminal dot — crisp HTML overlay (true circle despite the SVG's
            non-uniform scale). The contrast ring lifts it off the area fill.
            Static + calm, no pulse (§33.2): it marks "où tu en es", never
            dramatises it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cy)] ring-[3px] ring-[var(--bg-1)]"
          style={{ left: `${lastLeftPct}%`, top: `${lastTopPct}%` }}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="t-foot text-[var(--t-4)]">
          Semaine du {PERIOD_FMT.format(first.periodStart)}
        </span>
        <span className="t-foot text-[var(--t-4)]">
          Semaine du {PERIOD_FMT.format(last.periodStart)}
        </span>
      </div>
    </div>
  );
}
