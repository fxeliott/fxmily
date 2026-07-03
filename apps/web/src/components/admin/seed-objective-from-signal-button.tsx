'use client';

import { Check, Sprout } from 'lucide-react';
import { useState, useTransition } from 'react';

import { seedObjectiveFromSignalAction } from '@/app/admin/members/[id]/objective-from-signal-actions';
import { Btn } from '@/components/ui/btn';

/**
 * Tour 11 (FINDING 3) — bouton discret « En faire un objectif » sous un signal
 * faible (onglet profil admin). Convertit un signal PASSIF en engagement membre :
 * il sème un micro-objectif Mark Douglas curé (déterministe, ≤1 ouvert).
 *
 * 🛡️ FIREWALL §21.5 : le composant ne reçoit QUE le `dimensionId` (slug technique
 * opaque du signal), JAMAIS son texte. La server action dérive l'axe mental de ce
 * slug et joue une copie curée — le contenu du signal ne traverse jamais.
 *
 * Feedback optimiste sobre : le bouton devient « Objectif semé » (succès de
 * création) ou affiche calmement « Déjà un objectif ouvert » (invariant ≤1) via
 * une région `role="status"`. a11y : icône décorative `aria-hidden`, statut en
 * TEXTE (jamais color-only), spinner porté par `Btn` (`loading`), confirmation
 * annoncée poliment.
 */

type Phase = 'idle' | 'created' | 'already_open' | 'error';

export function SeedObjectiveFromSignalButton({
  memberId,
  dimensionId,
}: {
  memberId: string;
  dimensionId: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    setPhase('idle');
    startTransition(async () => {
      const result = await seedObjectiveFromSignalAction(memberId, dimensionId);
      if (result.ok) {
        setPhase(result.status === 'already_open' ? 'already_open' : 'created');
      } else {
        setPhase('error');
      }
    });
  };

  // Terminal success state — the loop is seeded (or one was already open). Show a
  // calm, self-describing confirmation instead of the button. Not color-only: the
  // meaning is carried by the text + icon, announced in a polite live region.
  if (phase === 'created') {
    return (
      <p
        role="status"
        className="inline-flex items-center gap-1.5 text-[12px] text-[var(--acc-hi)]"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        Objectif semé
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Btn type="button" kind="secondary" size="s" loading={isPending} onClick={onClick}>
        <Sprout className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        En faire un objectif
      </Btn>
      {phase === 'already_open' ? (
        <span role="status" className="text-[11px] text-[var(--t-3)]">
          Ce membre a déjà un objectif ouvert. Il le refermera avant d’en recevoir un nouveau.
        </span>
      ) : null}
      {phase === 'error' ? (
        <span role="status" className="text-[11px] text-[var(--t-3)]">
          Action impossible pour le moment, réessaie.
        </span>
      ) : null}
    </div>
  );
}
