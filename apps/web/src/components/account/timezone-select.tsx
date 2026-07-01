'use client';

import { Check, Globe2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { updateTimezoneAction } from '@/app/account/timezone/actions';
import { isSupportedTimezone, timezoneCityLabel, type TimezoneOptionGroup } from '@/lib/timezones';

/**
 * `<TimezoneSelect>` — F2 member timezone picker (`/account/timezone`).
 *
 * Native `<select>` with per-region `<optgroup>`s (mobile-first: the OS picker
 * is the best long-list UX + fully accessible). Auto-saves on change in a
 * transition, optimistically (revert + inline error on failure), mirroring
 * `<PreferencesGrid>`. A "détecter automatiquement" affordance reads the
 * browser timezone (`Intl…resolvedOptions().timeZone`) and a calm live preview
 * shows the member their current local time in the selected zone.
 *
 * Posture §2 / no-FOMO: factual copy, no urgency. The preview/detection are
 * helpers, never a nag.
 */

type Props = {
  initialTimezone: string;
  groups: TimezoneOptionGroup[];
};

function formatNowIn(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(new Date());
  } catch {
    return null;
  }
}

export function TimezoneSelect({ initialTimezone, groups }: Props): React.ReactNode {
  const [selected, setSelected] = useState(initialTimezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  const [localTime, setLocalTime] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Browser timezone — read after mount only (avoids SSR/CSR hydration drift):
  // the browser zone doesn't exist on the server, so this MUST set state post-
  // mount rather than at render. Repo canon for that case (cf. the wizards).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetected(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDetected(null);
    }
  }, []);

  // Live local-time preview for the selected zone. Client-only (null on SSR so
  // server/client markup matches), refreshed each minute so it stays honest
  // without a heavy ticking clock. The initial post-mount set is the same
  // hydration-safe pattern as `detected` above.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalTime(formatNowIn(selected));
    const id = setInterval(() => setLocalTime(formatNowIn(selected)), 60_000);
    return () => clearInterval(id);
  }, [selected]);

  // If the persisted value isn't in the offered groups (legacy/alias), surface
  // it as a standalone option so the picker always shows the real current value.
  const knownInGroups = groups.some((g) => g.options.some((o) => o.value === initialTimezone));

  function persist(next: string): void {
    if (next === selected) return;
    const previous = selected;
    setSelected(next);
    setError(null);
    setSaved(false);
    startTransition(() => {
      void updateTimezoneAction({ timezone: next }).then((result) => {
        if (result.ok) {
          setSaved(true);
        } else {
          setSelected(previous);
          setError('Échec de l’enregistrement — réessaie.');
        }
      });
    });
  }

  // Offer detection only when the browser zone differs AND is one we accept —
  // otherwise the auto-save would just fail the server allowlist.
  const showDetect = detected !== null && detected !== selected && isSupportedTimezone(detected);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="t-eyebrow text-[var(--t-3)]">Ton fuseau horaire</span>
        {/* NEVER `disabled` during the auto-save transition: disabling the
            focused control blurs it and drops focus to <body> (WCAG 2.4.3 Focus
            Order). Canon mirror of `<PreferencesGrid>` — optimistic update +
            revert-on-failure keeps the control interactive throughout. */}
        <select
          value={selected}
          onChange={(e) => persist(e.target.value)}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? 'tz-help tz-error' : 'tz-help'}
          className="rounded-control h-11 border border-[var(--b-default)] bg-[var(--bg-1)] px-3 text-[13px] text-[var(--t-1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          {!knownInGroups && (
            <option value={initialTimezone}>{timezoneCityLabel(initialTimezone)}</option>
          )}
          {groups.map((group) => (
            <optgroup key={group.region} label={group.label}>
              {group.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {localTime !== null && (
        <p className="text-sm text-[var(--t-2)]">
          Il est actuellement <span className="font-medium text-[var(--t-1)]">{localTime}</span>{' '}
          chez toi.
        </p>
      )}

      {showDetect && detected !== null && (
        <button
          type="button"
          onClick={() => persist(detected)}
          disabled={isPending}
          className="rounded-control inline-flex h-11 w-fit items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-4 text-[13px] font-medium text-[var(--acc-hi)] transition hover:bg-[var(--acc-dim-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
        >
          <Globe2 aria-hidden="true" className="h-4 w-4" />
          Détecter automatiquement ({timezoneCityLabel(detected)})
        </button>
      )}

      <p id="tz-help" className="text-xs text-[var(--t-3)]">
        Tes check-ins, rappels et l’ensemble de ton espace s’affichent à l’heure de ce fuseau. Le
        changement est pris en compte immédiatement.
      </p>

      <div aria-live="polite" className="min-h-5">
        {isPending && <p className="text-sm text-[var(--t-3)]">Enregistrement…</p>}
        {saved && !isPending && (
          <p className="inline-flex items-center gap-1.5 text-sm text-[var(--ok)]">
            <Check aria-hidden="true" className="h-4 w-4" />
            Fuseau horaire enregistré.
          </p>
        )}
      </div>

      {error !== null && (
        <p id="tz-error" role="alert" className="text-sm text-[var(--bad)]">
          {error}
        </p>
      )}
    </div>
  );
}
