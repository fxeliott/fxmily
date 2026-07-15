import { CalendarCheck, CalendarClock, CalendarOff, TriangleAlert } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import type { MemberOffDayAdminSummary } from '@/lib/checkin/off-days-admin';

interface MemberOffDaysPanelProps {
  summary: MemberOffDayAdminSummary;
}

/**
 * Off-days admin panel — member detail page tab (J3 "classement pour tous",
 * SCOPE 4). Read-only view of the member's self-declared off days in the
 * forward window the cap is enforced on. It closes the "visible admin" half of
 * the SPEC "Done quand" criterion: a member who declares off days past the free
 * cap (a reason then becomes MANDATORY at the action layer) shows up here as an
 * over-cap declaration, and the admin can read the reasons attached.
 *
 * The score/rank stays 100 % behavioral (SPEC firewall) — this surface only
 * exposes DECLARATIONS to curb leaderboard gaming, never trading performance.
 */
export function MemberOffDaysPanel({ summary }: MemberOffDaysPanelProps) {
  const { cap, horizonDays, windowCount, overCap, upcoming } = summary;

  if (upcoming.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={CalendarCheck}
          headline="Aucun jour off déclaré pour ce membre."
          lead={`Rien de prévu sur les ${horizonDays} prochains jours. Un membre déclare un jour off quand il sait qu'il ne tradera pas, sans casser sa série ni sa présence.`}
          guides={[
            `Jusqu'à ${cap} jours off sur ${horizonDays} jours restent libres, sans justification.`,
            'Au-delà du plafond, une raison devient obligatoire à la déclaration.',
            'Les déclarations atypiques (au-dessus du plafond) apparaissent ici.',
          ]}
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card primary className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="acc">JOURS OFF</Pill>
          <span className="t-eyebrow-lg text-[var(--t-3)]">
            Fenêtre {horizonDays} jours · anti-triche du classement
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={overCap ? 'warn' : 'mute'}>
            {overCap ? (
              <TriangleAlert className="h-2.5 w-2.5" strokeWidth={2} />
            ) : (
              <CalendarClock className="h-2.5 w-2.5" strokeWidth={2} />
            )}
            {windowCount} / {cap} jours off
          </Pill>
          {overCap ? (
            <span className="text-xs text-[var(--warn)]">
              Au-dessus du plafond libre : déclaration atypique à examiner.
            </span>
          ) : (
            <span className="text-xs text-[var(--t-3)]">
              Sous le plafond libre : rythme normal.
            </span>
          )}
        </div>
      </Card>

      <ul className="flex flex-col gap-2">
        {upcoming.map((entry) => {
          const hasReason = entry.reason !== null && entry.reason.length > 0;
          return (
            <li
              key={entry.date}
              className="rounded-card flex flex-col gap-1.5 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 shadow-[var(--sh-card)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <CalendarOff className="h-3.5 w-3.5 text-[var(--t-3)]" strokeWidth={1.75} />
                <span className="text-[13px] font-semibold text-[var(--t-1)]">{entry.label}</span>
                {hasReason ? <Pill tone="acc">MOTIVÉ</Pill> : <Pill tone="mute">LIBRE</Pill>}
              </div>
              {hasReason ? (
                <p className="text-[13px] leading-snug text-[var(--t-2)]">{entry.reason}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
