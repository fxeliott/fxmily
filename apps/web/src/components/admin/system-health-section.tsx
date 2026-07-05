import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { AnimatedNumber } from '@/components/ui/animated-number';
import { Pill } from '@/components/ui/pill';

/**
 * S10(a) — presentational primitives for `/admin/health` (business-chain view).
 *
 * Posture §2 (mirror `member-attention.tsx` / system `SnapshotCard`): calm
 * coaching tones only — `acc` / `warn` / `mute`, NEVER a punitive red (`bad`).
 * A gap or a forgot count is « à suivre », never a fault. Every card carries its
 * own window sub-label so the surface can never mislead on the period it reads.
 *
 * Pure server components (zero client JS beyond the shared `AnimatedNumber`
 * count-up). Read-only display of counts handed down by the loader.
 */

export function HealthSection({
  icon: Icon,
  title,
  window,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Human window label, e.g. « 7 derniers jours ». */
  window: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-2xl border border-[var(--b-default)] bg-[var(--bg-1)] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--t-1)]">{title}</h2>
          <p className="mt-0.5 text-[11px] tracking-wide text-[var(--t-3)] uppercase">{window}</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </section>
  );
}

/**
 * One metric tile. Count-up value + label + sub-label. `tone` only colours the
 * value (acc default / warn for a signal-that-needs-eyes / mute for context) —
 * never red, never an alarm.
 *
 * Tour 13 — an optional `href` turns the tile into a link: the count stops being
 * a dead end and leads straight to the work (the members triage view or a
 * member's page). `linkLabel` names the destination for screen readers so « 3 »
 * never reads as a bare number. A tile with `href` gets a hover/focus affordance
 * + a corner arrow; a tile without stays a plain figure.
 */
export function HealthMetric({
  label,
  value,
  sublabel,
  tone = 'acc',
  href,
  linkLabel,
}: {
  label: string;
  value: number;
  sublabel: string;
  tone?: 'acc' | 'warn' | 'mute';
  /** Destination for the tile (members triage / member page). Omit → plain tile. */
  href?: string;
  /** Accessible name for the link, e.g. « Voir les membres à traiter ». */
  linkLabel?: string;
}): React.ReactElement {
  const accentClass =
    tone === 'warn'
      ? 'text-[var(--warn)]'
      : tone === 'mute'
        ? 'text-[var(--t-2)]'
        : 'text-[var(--acc-hi)]';

  const body = (
    <>
      <p className="flex items-center justify-between gap-2 text-[11px] font-medium tracking-wide text-[var(--t-3)] uppercase">
        {label}
        {href ? (
          <ArrowUpRight
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-[var(--t-4)] transition-colors group-hover/tile:text-[var(--acc-hi)]"
            strokeWidth={1.75}
          />
        ) : null}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${accentClass}`}>
        <AnimatedNumber value={value} />
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--t-4)]">{sublabel}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={linkLabel ?? `${label} : ${value}`}
        className="group/tile rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3 transition-colors hover:border-[var(--b-acc)] hover:bg-[var(--bg-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--b-subtle)] bg-[var(--bg-2)] p-3">{body}</div>
  );
}

/** Net-direction chip for score movements — calm up/steady, never punitive. */
export function NetDirectionPill({ net }: { net: number }): React.ReactElement {
  if (net > 0) {
    return (
      <Pill tone="acc">
        +<AnimatedNumber value={net} /> net
      </Pill>
    );
  }
  if (net < 0) {
    // A negative net is a "à suivre" signal (warn), never a red verdict.
    return (
      <Pill tone="warn">
        <AnimatedNumber value={net} /> net
      </Pill>
    );
  }
  return <Pill tone="mute">À l’équilibre</Pill>;
}
