import { Brain, Moon as MoonIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';
import type { DayPoint } from '@/lib/checkin/service';

interface TrendCardProps {
  /** 7 latest day points, oldest → newest. */
  days: readonly DayPoint[];
}

/**
 * 7-day mini analytics on the /checkin landing (J5 audit UI N2 polish).
 *
 * Two micro-charts side-by-side: sleep hours (cyan) and average mood
 * (lime). Wraps the existing `<Sparkline>` primitive that was sitting
 * unused in the design system. Bands are computed live so the user gets
 * an immediate visual signal of what their week looks like beyond the
 * current day.
 *
 * Empty-state friendly: if no day was filled, show a discreet "à
 * démarrer" hint instead of a flat 0-line chart.
 *
 * Data anchor (Mark Douglas + Steenbarger): regularity matters more than
 * any single point; a 7-day window is short enough to act on (this week
 * vs last week) and long enough to filter noise (vs single-day bias).
 */
export function TrendCard({ days }: TrendCardProps) {
  const sleepValues = days.map((d) => d.sleepHours).filter((v): v is number => v != null);
  const moodValues = days.map((d) => d.moodScore).filter((v): v is number => v != null);

  const filledDays = days.filter((d) => d.filled).length;
  const sleepAvg = sleepValues.length
    ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length
    : null;
  const moodAvg = moodValues.length
    ? moodValues.reduce((a, b) => a + b, 0) / moodValues.length
    : null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="t-eyebrow">Tendance 7 jours</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--t-3)]">
          {filledDays}/7 jours filled
        </span>
      </div>

      {filledDays === 0 ? (
        <p className="t-body text-[var(--t-3)]">
          Aucun check-in cette semaine — ta tendance s’écrira ici à partir de ton premier
          enregistrement.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TrendCell
            icon={<MoonIcon className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Sommeil"
            unit="h"
            avg={sleepAvg}
            avgFmt={(v) => v.toFixed(1)}
            data={sleepValues}
            color="var(--cy)"
          />
          <TrendCell
            icon={<Brain className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Humeur moyenne"
            unit="/10"
            avg={moodAvg}
            avgFmt={(v) => v.toFixed(1)}
            data={moodValues}
            color="var(--acc)"
          />
        </div>
      )}
    </Card>
  );
}

function TrendCell({
  icon,
  label,
  unit,
  avg,
  avgFmt,
  data,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  unit: string;
  avg: number | null;
  avgFmt: (v: number) => string;
  data: number[];
  color: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[var(--t-3)]">
        {icon}
        <span className="t-eyebrow">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="f-mono text-[20px] font-bold tabular-nums leading-none tracking-[-0.02em]"
          style={{ color: avg == null ? 'var(--t-3)' : color }}
        >
          {avg == null ? '—' : avgFmt(avg)}
        </span>
        {avg != null ? (
          <span className="font-mono text-[10px] tabular-nums text-[var(--t-3)]">{unit}</span>
        ) : null}
      </div>
      {data.length >= 2 ? (
        <Sparkline
          data={data}
          color={color}
          fill
          showLastDot
          width={140}
          height={32}
          strokeWidth={1.5}
          ariaLabel={`${label} sur 7 jours, dernière valeur ${avgFmt(data[data.length - 1]!)}`}
        />
      ) : (
        <div className="t-cap text-[var(--t-3)]">
          {data.length === 1 ? '1 point — courbe à venir' : '—'}
        </div>
      )}
    </div>
  );
}
