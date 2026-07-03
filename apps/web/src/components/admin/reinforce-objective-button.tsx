'use client';

import { BellRing, Check } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { reinforceObjectiveAction } from '@/app/admin/members/[id]/reinforce-objective-actions';
import { Btn } from '@/components/ui/btn';

/**
 * Tour 11 (chantier G, FINDING 4) — bouton « Renforcer » discret sur une ligne
 * de « Suivi des corrections » (open-et-ancienne ou « Pas tenu »).
 *
 * Un clic pose une note admin PRIVÉE pré-remplie référençant l'objectif (jamais
 * vue du membre, SPEC §7.7). Feedback sobre inline : « Note posée » (§31.2, ton
 * factuel). Une fois posée, le bouton se fige sur l'état de confirmation pour
 * éviter le double-envoi accidentel de la même relance.
 *
 * a11y : `role="status"` + `aria-live="polite"` annonce le résultat aux lecteurs
 * d'écran (statut en TEXTE, jamais color-only) ; l'icône est décorative
 * (`aria-hidden` via le Btn). Pattern carbone `NoteDeleteButton` (useTransition +
 * live region + cleanup au démontage).
 */
export function ReinforceObjectiveButton({
  memberId,
  objectiveId,
}: {
  memberId: string;
  objectiveId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 3000);
  }

  function onReinforce() {
    if (done || pending) return;
    startTransition(async () => {
      const r = await reinforceObjectiveAction(memberId, objectiveId);
      if (r.ok) {
        setDone(true);
        announceFor('Note de relance posée dans les notes admin.');
      } else {
        announceFor('Échec de la relance, réessaie dans un instant.');
      }
    });
  }

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <Btn
        type="button"
        kind="secondary"
        size="s"
        onClick={onReinforce}
        loading={pending}
        disabled={pending || done}
        aria-label={done ? 'Note de relance posée' : 'Renforcer cette correction'}
      >
        {done ? (
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        ) : (
          <BellRing className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        )}
        {done ? 'Note posée' : 'Renforcer'}
      </Btn>
    </>
  );
}
