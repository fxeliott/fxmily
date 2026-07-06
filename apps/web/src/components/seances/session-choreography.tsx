import { ArrowRight, Shuffle, Zap } from 'lucide-react';

/**
 * SessionChoreography — the "how a séance unfolds" method primer (Server
 * Component, zero JS). Two stable ideas from Eliott's framework, made visual so
 * a member grasps the intraday PLAN without watching the replay:
 *
 *  1. The red thread — a séance rarely moves in a straight line: wait for an
 *     initial reaction in the OPPOSITE direction (the manipulation) before the
 *     real move. Shown as a two-phase principle.
 *  2. The New-York session windows (Europe/Paris) — what to expect hour by hour.
 *
 * These are method (not per-séance data), so the times are a typed constant and
 * the section is only ever rendered for the pre-session `analyse` slot (the
 * caller gates on it — a 20h debrief has no pre-session timeline). Direction-
 * agnostic on purpose: the principle holds whether the day is bullish or
 * bearish, so the visuals use neutral + brand tokens, never --ok/--bad.
 */

interface SessionWindow {
  time: string;
  label: string;
  hint: string;
}

/** Eliott's NY-session windows, Europe/Paris (mirror keyTakeaway "fenêtres horaires"). */
const WINDOWS: readonly SessionWindow[] = [
  { time: '13h–14h', label: 'Calme', hint: 'Peu d’activité attendue avant la séance.' },
  { time: '14h–15h', label: 'Manipulation', hint: 'Une première manipulation peut se former.' },
  { time: '15h–15h30', label: 'Pré-session', hint: 'Mise en place avant l’ouverture américaine.' },
  { time: '15h30', label: 'Ouverture US', hint: 'La session américaine démarre.' },
  { time: '15h30–16h', label: 'Open', hint: 'L’ouverture peut encore manipuler.' },
];

export function SessionChoreography() {
  return (
    <figure className="card-premium masthead-accent rounded-card m-0 border border-[var(--b-default)] bg-[var(--bg-1)] p-4 sm:p-5">
      <p className="t-body max-w-prose text-[var(--t-2)]">
        Une séance se lit rarement en ligne droite. La règle maîtresse&nbsp;: attendre une réaction
        initiale dans le sens inverse du mouvement final. On veut la manipulation d’abord, le vrai
        mouvement ensuite.
      </p>

      {/* The principle — two phases, direction-agnostic. Not an <ol> (the middle
          arrow is a decorative non-item); order is carried by the "Phase 1/2"
          labels. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
        <div className="rounded-control flex flex-1 items-start gap-2.5 border border-dashed border-[var(--b-strong)] bg-[var(--bg-2)] p-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-3)] text-[var(--t-3)]"
          >
            <Shuffle className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--t-3)]">Phase 1 · Manipulation</span>
            <span className="t-cap text-[var(--t-2)]">
              Le marché part d’abord dans le sens inverse pour piéger.
            </span>
          </span>
        </div>

        <span
          aria-hidden
          className="hidden shrink-0 items-center justify-center text-[var(--t-3)] sm:flex"
        >
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </span>

        <div className="rounded-control flex flex-1 items-start gap-2.5 border border-[var(--b-acc)] bg-[var(--acc-dim-2)] p-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--acc-dim)] text-[var(--acc-hi)]"
          >
            <Zap className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="t-eyebrow text-[var(--acc-hi)]">Phase 2 · Mouvement voulu</span>
            <span className="t-cap text-[var(--t-2)]">
              Puis le vrai momentum se déclenche, dans le bon sens.
            </span>
          </span>
        </div>
      </div>

      {/* The session windows — chronological, Europe/Paris. */}
      <div className="mt-5 flex flex-col gap-2">
        <span className="t-eyebrow text-[var(--t-3)]">
          Les fenêtres de la séance (heure de Paris)
        </span>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {WINDOWS.map((w, i) => (
            <li
              key={w.time}
              className="rounded-control relative flex flex-col gap-1 border border-[var(--b-default)] bg-[var(--bg-2)] p-3"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--acc-dim)] font-mono text-[9px] font-semibold text-[var(--acc-hi)] tabular-nums"
                >
                  {i + 1}
                </span>
                <span className="font-mono text-[12px] font-semibold text-[var(--t-1)] tabular-nums">
                  {w.time}
                </span>
              </span>
              <span className="t-cap font-medium text-[var(--t-2)]">{w.label}</span>
              <span className="t-cap text-[var(--t-3)]">{w.hint}</span>
            </li>
          ))}
        </ol>
      </div>

      <figcaption className="t-cap mt-4 text-[var(--t-3)]">
        Schéma type souvent observé&nbsp;: une première poussée qui manipule, une stagnation, une
        nouvelle manipulation vers l’ouverture, puis le vrai momentum. On attend et on s’adapte,
        sans anticiper la tendance de fond.
      </figcaption>
    </figure>
  );
}
