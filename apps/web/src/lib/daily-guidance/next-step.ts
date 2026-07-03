import type { GuidanceAction } from './service';

/**
 * Cross-page wayfinding derivation for the NextStepRail (§32-2 extended
 * beyond the dashboard). Pure function over the day's `GuidanceAction[]`
 * (already ordered + `timing`-tagged by `getDailyGuidance`) and the pathname
 * of the page hosting the rail.
 *
 * Three outcomes:
 *   - `{ kind: 'now' }` — the current action lives on ANOTHER page: link it.
 *   - `{ kind: 'here-next' }` — the member is already on the current action's
 *     surface: quiet ack, and link the NEXT pending action if there is one.
 *   - `{ kind: 'all-done' }` — nothing pending at all.
 *
 * Anti-Black-Hat §31.2: this is pure wayfinding — the derivation carries no
 * counter, no urgency, and treats `missed` exactly like `todo` (the calm
 * catch-up tone belongs to the dashboard panel, not to a nav rail).
 */

export interface NextStepDerivation {
  kind: 'now' | 'here-next' | 'all-done';
  /** The action the rail links to. `null` for all-done or here-with-no-next. */
  target: GuidanceAction | null;
  /** True when the hosting page IS the current action's surface. */
  onCurrentSurface: boolean;
}

/** "You are here" test: exact route or a sub-route of the action's href. */
function isOnActionSurface(action: GuidanceAction, currentPath: string): boolean {
  return action.href === currentPath || currentPath.startsWith(`${action.href}/`);
}

export function deriveNextStep(
  actions: readonly GuidanceAction[],
  currentPath: string,
): NextStepDerivation {
  const pending = actions.filter((a) => a.state === 'todo' || a.state === 'missed');
  const current = pending.find((a) => a.timing === 'current') ?? pending[0] ?? null;
  if (!current) return { kind: 'all-done', target: null, onCurrentSurface: false };

  if (!isOnActionSurface(current, currentPath)) {
    return { kind: 'now', target: current, onCurrentSurface: false };
  }

  const next =
    pending.find((a) => a.timing === 'next') ?? pending.find((a) => a !== current) ?? null;
  return { kind: 'here-next', target: next, onCurrentSurface: true };
}
