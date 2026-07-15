import { ArrowDown, ArrowDownToLine, ArrowUp, Minus, Sparkles } from 'lucide-react';

import type { RankMovement } from '@/lib/leaderboard/service';

import { Pill } from '../ui/pill';

/**
 * RankMovementChip — the "how did I move" affordance next to the viewer's rank
 * (dashboard widget + MyRankCard). A SMALLER rank is BETTER, so a climb is
 * painted calm-positive (green, up arrow, "+N"); a slip down, and a member who
 * fell OUT of the board entirely ("dropped"), both stay muted, never alarming
 * red (SPEC §2 no-FOMO posture: a change is information, not a scolding).
 *
 * Server-safe (no client island): it only paints the already-derived
 * {@link RankMovement} from the leaderboard service. The visible label is terse
 * ("+2"), so a full sr-only sentence carries the meaning for assistive tech.
 * Honest across missed cron nights: the copy reads "depuis le dernier
 * classement", never "depuis hier".
 */

interface RankMovementChipProps {
  movement: RankMovement;
}

export function RankMovementChip({ movement }: RankMovementChipProps): React.ReactElement | null {
  const { direction, delta } = movement;

  // A member ranked for the very first time: the "Nouveau" chip is the welcome.
  if (direction === 'new') {
    return (
      <Pill tone="acc" className="tracking-normal normal-case">
        <Sparkles className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        <span aria-hidden="true">Nouveau</span>
        <span className="sr-only">Première apparition au classement.</span>
      </Pill>
    );
  }

  if (direction === 'up') {
    const places = `${delta} place${delta > 1 ? 's' : ''}`;
    return (
      <Pill tone="ok" className="tracking-normal normal-case">
        <ArrowUp className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
        <span aria-hidden="true">+{delta}</span>
        <span className="sr-only">{`Tu as gagné ${places} depuis le dernier classement.`}</span>
      </Pill>
    );
  }

  if (direction === 'down') {
    const lost = Math.abs(delta);
    const places = `${lost} place${lost > 1 ? 's' : ''}`;
    return (
      <Pill tone="mute" className="tracking-normal normal-case">
        <ArrowDown className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
        <span aria-hidden="true">{delta}</span>
        <span className="sr-only">{`Tu as perdu ${places} depuis le dernier classement.`}</span>
      </Pill>
    );
  }

  if (direction === 'dropped') {
    // Held a rank before, holds none now: the member fell out of the board
    // (complacent off-days shrank their window below the gate). Muted + calm,
    // never red. Mark Douglas tone: an exit is information; the way back is
    // check-ins (carried by the card/widget copy next to this chip).
    return (
      <Pill tone="mute" className="tracking-normal normal-case">
        <ArrowDownToLine className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
        <span aria-hidden="true">Sorti</span>
        <span className="sr-only">Tu es sorti du classement depuis le dernier calcul.</span>
      </Pill>
    );
  }

  // direction === 'same' — steady, held position.
  return (
    <Pill tone="mute" className="tracking-normal normal-case">
      <Minus className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
      <span aria-hidden="true">Stable</span>
      <span className="sr-only">Ta place n&apos;a pas changé depuis le dernier classement.</span>
    </Pill>
  );
}
