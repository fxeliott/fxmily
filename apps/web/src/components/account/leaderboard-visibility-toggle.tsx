'use client';

import { useState, useTransition } from 'react';

import { updateLeaderboardOptOutAction } from '@/app/account/visibilite/actions';

/**
 * `<LeaderboardVisibilityToggle>` — the member's RGPD control over their
 * presence on the public `/classement`, rendered on `/account/visibilite`.
 *
 * Framed AFFIRMATIVELY ("Je participe au classement") rather than as an opt-out
 * checkbox : the switch ON = visible to others, which is the motivating default
 * (SPEC §2 — the leaderboard exists to create links). The underlying column is
 * `leaderboardOptOut`, so the switch value is the NEGATION (`visible =
 * !optOut`), and the action is called with `!next`.
 *
 * Server-authoritative : the parent Server Component reads the current column
 * and seeds `initialOptOut`; the write goes through `updateLeaderboardOptOut
 * Action` (auth + active + boolean re-checked there) and we re-sync from its
 * result. Optimistic flip, reverted on failure. `aria-live` announces the
 * outcome for assistive tech.
 *
 * A11y (WCAG 2.2 AA) : a real `role="switch"` with `aria-checked` + an explicit
 * `aria-labelledby` (a `<label for>` does not name a `<button>`) and an
 * `aria-describedby` so assistive tech reads the ON/OFF consequence alongside the
 * name, focus-visible ring via tokens, motion limited to the thumb (respects
 * `motion-reduce`).
 */

interface Props {
  /** Current `User.leaderboardOptOut` value (server-authoritative). */
  initialOptOut: boolean;
}

export function LeaderboardVisibilityToggle({ initialOptOut }: Props): React.ReactElement {
  const [visible, setVisible] = useState(!initialOptOut);
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !visible;
    // Optimistic flip, reverted if the action reports a failure.
    setVisible(next);
    startTransition(async () => {
      // `visible` is the negation of the persisted column, so opt-out = !next.
      const res = await updateLeaderboardOptOutAction(!next);
      if (res.ok) {
        setMessage(
          next
            ? 'Tu apparais de nouveau sur le classement des membres.'
            : "Tu n'apparais plus sur le classement des autres membres. Ton rang reste visible pour toi seul.",
        );
      } else {
        setVisible(!next);
        setMessage("La modification n'a pas pu être enregistrée. Réessaie dans un instant.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="rounded-card flex items-start justify-between gap-4 border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
        <label htmlFor="leaderboard-visibility-switch" className="min-w-0 flex-1 cursor-pointer">
          <span
            id="leaderboard-visibility-label"
            className="block text-sm font-medium text-[var(--t-1)]"
          >
            Je participe au classement des membres
          </span>
          <span
            id="leaderboard-visibility-desc"
            className="mt-1 block text-sm leading-relaxed text-[var(--t-2)]"
          >
            Activé, ton prénom et ta photo apparaissent sur le classement pour les autres membres.
            Désactive-le pour rester discret : tu continues de voir ton propre rang, mais personne
            d&apos;autre ne te voit dans la liste.
          </span>
        </label>
        <button
          type="button"
          role="switch"
          id="leaderboard-visibility-switch"
          aria-labelledby="leaderboard-visibility-label"
          aria-describedby="leaderboard-visibility-desc"
          aria-checked={visible}
          onClick={toggle}
          disabled={isPending}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--b-acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-1)] focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none ${
            visible
              ? 'border-[var(--b-acc)] bg-[var(--acc)]'
              : 'border-[var(--b-default)] bg-[var(--bg-3)]'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${
              visible ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Live region — the write outcome is announced. */}
      <p aria-live="polite" className="min-h-5 text-sm text-[var(--t-2)]">
        {message}
      </p>
    </div>
  );
}
