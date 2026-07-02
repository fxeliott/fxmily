import { ArrowUpRight, Check, CircleDot, Info, RotateCcw } from 'lucide-react';
import Link from 'next/link';

import type { GuidanceAction } from '@/lib/daily-guidance/service';
import type { ProcessObjective } from '@/lib/objectives/service';
import { cn } from '@/lib/utils';

/**
 * « Ce que tu dois faire » (jalon J4). Traduit la destination en gestes concrets :
 * un LEVIER prioritaire (la dimension la plus faible encore sous la cible) puis
 * la liste des actions guidées du jour (todo d'abord). Chaque action pointe vers
 * sa page. Posture §2 : aucune injonction culpabilisante, ton calme.
 */

const STATE_META: Record<
  GuidanceAction['state'],
  { label: string; Icon: typeof Check; cls: string; dot: string }
> = {
  todo: { label: 'À faire', Icon: CircleDot, cls: 'text-[var(--acc-hi)]', dot: 'bg-[var(--acc)]' },
  done: { label: 'Fait', Icon: Check, cls: 'text-[var(--ok)]', dot: 'bg-[var(--ok)]' },
  info: { label: 'Info', Icon: Info, cls: 'text-[var(--t-3)]', dot: 'bg-[var(--t-4)]' },
  // S6 §32-2 — a calm amber catch-up, NEVER red/punitive (anti-Black-Hat §31.2).
  missed: {
    label: 'À rattraper',
    Icon: RotateCcw,
    cls: 'text-[var(--warn)]',
    dot: 'bg-[var(--warn)]',
  },
};

export function NextSteps({
  actions,
  focus,
}: {
  actions: ReadonlyArray<GuidanceAction>;
  focus: ProcessObjective | null;
}) {
  return (
    <section
      aria-labelledby="next-steps-title"
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-5 lg:p-6"
    >
      <h2 id="next-steps-title" className="t-eyebrow">
        Ce que tu dois faire
      </h2>

      {focus ? (
        <div className="rounded-card flex items-start gap-3 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-4">
          <span
            aria-hidden="true"
            className="rounded-control grid h-9 w-9 shrink-0 place-items-center border border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <ArrowUpRight className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] leading-tight font-semibold text-[var(--t-1)]">
              Ton levier du moment : {focus.label}
            </span>
            <span className="t-cap leading-snug text-[var(--t-2)]">
              {focus.hint}, {focus.gap} point{(focus.gap ?? 0) > 1 ? 's' : ''} avant la Maîtrise.
              Les gestes ci-dessous le renforcent.
            </span>
          </div>
        </div>
      ) : null}

      {actions.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {actions.map((action) => {
            const meta = STATE_META[action.state];
            return (
              <li key={action.key}>
                <Link
                  href={action.href}
                  className={cn(
                    'rounded-card group flex items-center gap-3 border border-[var(--b-default)] bg-[var(--bg-2)] p-3 transition-all duration-200',
                    'hover:-translate-y-px hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)]',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)]',
                      meta.cls,
                    )}
                  >
                    <meta.Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-[var(--t-1)]">
                        {action.title}
                      </span>
                      <span className={cn('t-mono-cap shrink-0', meta.cls)}>{meta.label}</span>
                    </span>
                    <span className="t-cap truncate text-[var(--t-3)]">{action.detail}</span>
                  </span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-[var(--t-4)] transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--acc-hi)]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-body text-[var(--t-2)]">
          Rien d’urgent dans l’immédiat, continue ta routine. Chaque check-in et chaque trade
          journalisé fait avancer tes objectifs.
        </p>
      )}
    </section>
  );
}
