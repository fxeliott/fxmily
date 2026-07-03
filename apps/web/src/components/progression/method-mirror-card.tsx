import { Compass } from 'lucide-react';

import type { MethodMirror, MethodRule } from '@/lib/method-mirror/compute';
import { cn } from '@/lib/utils';

/**
 * S24 — « Ta fidélité à la méthode ».
 *
 * Reflects the member's adherence to Eliott's HARD RULES over the trailing 30
 * days (execution window 13h–16h, one trade per day, 20h cut / 0 overnight,
 * targeting RR 3). The day-status of these rules is shown live by SessionTimeline
 * on the hub; THIS aggregates them over time — the "how faithful am I to the
 * method?" mirror that did not exist anywhere. Data derived at render from the
 * member's own trades (no new table).
 *
 * POSTURE §2 + anti-Black-Hat (§31.2). Each row is a PROCESS fact, never a market
 * call. The bands are calm — a low rate reads "à renforcer" in amber, NEVER red,
 * never a countdown. Below the sample floor (`hasEnough`), a pedagogical empty
 * state replaces fabricated rates.
 */

interface Band {
  /** value colour */ fg: string;
  /** bar fill colour */ bar: string;
  /** one-word calm verdict */ word: string;
}

function bandFor(rate: number | null): Band {
  if (rate === null) return { fg: 'text-[var(--t-4)]', bar: 'bg-[var(--b-strong)]', word: '-' };
  if (rate >= 80) return { fg: 'text-[var(--ok)]', bar: 'bg-[var(--ok)]', word: 'solide' };
  if (rate >= 50)
    return { fg: 'text-[var(--acc-hi)]', bar: 'bg-[var(--acc)]', word: 'en bonne voie' };
  // Calm amber — a nudge, not a red verdict (§31.2).
  return { fg: 'text-[var(--warn)]', bar: 'bg-[var(--warn)]', word: 'à renforcer' };
}

function MirrorRow({ rule }: { rule: MethodRule }) {
  const band = bandFor(rule.rate);
  const hasData = rule.rate !== null;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-[var(--t-1)]">{rule.label}</span>
        <span className={cn('f-mono text-[13px] font-semibold tabular-nums', band.fg)}>
          {hasData ? `${rule.rate}%` : '-'}
          {hasData ? (
            <span className="ml-1.5 text-[11px] font-medium text-[var(--t-4)]">{band.word}</span>
          ) : null}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-3)]"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rule.rate ?? undefined}
        aria-label={`${rule.label} : ${hasData ? `${rule.rate}% (${rule.good} sur ${rule.total})` : 'pas encore de donnée'}`}
      >
        {hasData ? (
          <div
            className={cn(
              'h-full w-full origin-left rounded-full transition-transform duration-500',
              band.bar,
            )}
            style={{ transform: `scaleX(${(rule.rate ?? 0) / 100})` }}
          />
        ) : null}
      </div>
      <span className="t-foot text-[var(--t-3)]">
        {rule.hint}
        {hasData ? <span className="text-[var(--t-4)]"> · {rule.total} relevés</span> : null}
      </span>
    </li>
  );
}

export function MethodMirrorCard({
  mirror,
  className = '',
}: {
  mirror: MethodMirror;
  className?: string;
}) {
  return (
    <section
      data-slot="method-mirror-card"
      aria-labelledby="method-mirror-heading"
      className={cn(
        'rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="t-eyebrow text-[var(--t-3)]">Ta fidélité à la méthode</span>
          <h2 id="method-mirror-heading" className="text-[15px] font-semibold text-[var(--t-1)]">
            Tes règles dures, sur {mirror.windowDays} jours
          </h2>
        </div>
        <span
          aria-hidden="true"
          className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]"
        >
          <Compass className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>

      {mirror.hasEnough ? (
        <>
          <ul className="flex flex-col gap-3.5">
            {mirror.rules.map((rule) => (
              <MirrorRow key={rule.key} rule={rule} />
            ))}
          </ul>
          <p className="t-foot border-t border-[var(--b-default)] pt-3 text-[var(--t-3)]">
            Un miroir, pas un verdict. La méthode se respecte un jour à la fois, chaque journée
            repart à zéro.
          </p>
        </>
      ) : (
        <p className="t-body leading-[1.5] text-[var(--t-2)]">
          Dès que tu auras journalisé quelques trades, tu verras ici, calmement, à quel point tu
          tiens les règles dures de la méthode : la fenêtre d’exécution, un trade par jour, la
          coupure de 20h, ta visée de RR et ta gestion (stop selon ta règle, break-even,
          sécurisation au TP). Un miroir pour progresser, jamais une sanction.
        </p>
      )}
    </section>
  );
}
