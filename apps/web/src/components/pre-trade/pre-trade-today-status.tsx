import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import type { TodayPreTradeStatus } from '@/lib/pre-trade/service';

/**
 * P3 fix — surface the "pre-trade of the day submitted" state on /journal/new.
 *
 * WHY. After submitting the pre-trade questionnaire, nothing reflected it: the
 * member landed on /journal/new with no signal that the day's preparation was
 * recorded, and could redo it for nothing. This calm one-line recall closes
 * that loop.
 *
 * POSTURE §2 (Mark Douglas, BLOQUANT). No pressure, no red, no guilt. Two calm
 * states only:
 *   - done  → a quiet "fait" line + link to the recap (/patterns).
 *   - todo  → a quiet invitation to the pause + link to /pre-trade/new.
 * The invitation is NOT an alarm: `todo` uses the same neutral accent surface,
 * never a warning tone. The pre-trade is optional (ADR-003 friction-is-the-
 * feature, never mandatory), so "not done" is a neutral fact, not a failure.
 *
 * Pure presentational Server Component — the timezone-aware `HHhMM` label is
 * computed by {@link formatCheckTime}, unit-tested in isolation. The status is
 * fetched by the page (server) and passed in, so this component is DB-free.
 */

/**
 * Render a UTC instant as a compact French `HHhMM` wall-clock in the member's
 * timezone, e.g. `14h05`. Minutes are always 2-digit (a timestamp, not a slot
 * label) so `9h00` reads unambiguously. Falls back to UTC on a malformed tz
 * (mirrors the defensive posture of `lib/checkin/timezone`).
 */
export function formatCheckTime(iso: string, timezone: string): string {
  let tz = timezone;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // fr-FR renders hour zero-padded ("09") — strip the pad so we read "9h05".
  return `${String(Number(hour))}h${minute}`;
}

export function PreTradeTodayStatus({
  status,
  timezone,
}: {
  status: TodayPreTradeStatus;
  timezone: string;
}) {
  if (status.done && status.at) {
    const at = formatCheckTime(status.at, timezone);
    return (
      <div
        className="rounded-card mb-6 flex items-center gap-3 border border-[var(--ok-edge)] bg-[var(--ok-dim)] p-3"
        data-slot="pre-trade-today-status"
        data-state="done"
      >
        <span
          aria-hidden="true"
          className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--ok-edge)] bg-[var(--ok-dim)] text-[var(--ok)]"
        >
          <Check className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--t-1)]">
            Pré-trade du jour fait à {at}
          </span>
          <span className="text-[12px] leading-relaxed text-[var(--t-2)]">
            Ta préparation est enregistrée. Pas besoin de la refaire.
          </span>
        </div>
        <Link
          href="/patterns"
          className="focus-visible:rounded-control inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[var(--ok)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ok-edge)]"
          aria-label="Voir le récapitulatif de mes pré-trades"
        >
          Récap
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-card mb-6" data-slot="pre-trade-today-status" data-state="todo">
      <Link
        href="/pre-trade/new"
        className="focus-visible:rounded-card flex items-center gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim)] p-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        aria-label="Faire la pause pré-trade avant de saisir ton trade"
      >
        <span
          aria-hidden="true"
          className="rounded-control grid h-8 w-8 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc)] text-[var(--acc-fg)]"
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--t-1)]">Pense à ton pré-trade</span>
          <span className="text-[12px] leading-relaxed text-[var(--t-2)]">
            Une pause de 30 secondes avant d’entrer. Optionnel.
          </span>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--acc)]" aria-hidden="true" />
      </Link>
    </div>
  );
}
