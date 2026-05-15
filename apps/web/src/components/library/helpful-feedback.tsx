'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { setDeliveryHelpfulAction } from '@/app/library/actions';
import { cn } from '@/lib/utils';

interface HelpfulFeedbackProps {
  deliveryId: string;
  initialHelpful: boolean | null;
}

/**
 * Two-button helpful/not-helpful toggle on a delivery (J7 + J7.5 polish).
 *
 * Once the user has given an answer, clicking the same button is a no-op
 * (no retract — honest feedback shouldn't churn). Clicking the other button
 * flips.
 *
 * J7.5 polish premium :
 *   - `role="group"` + `aria-labelledby` so SR announces the question once.
 *   - sr-only `aria-live="polite"` confirms the answer change ("Réponse Oui
 *     enregistrée"). a11y H5 fix.
 *   - Framer Motion scale spring on tap + threshold-pulse on selection.
 *     Respects `prefers-reduced-motion`.
 */
export function HelpfulFeedback({ deliveryId, initialHelpful }: HelpfulFeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(initialHelpful);
  const [pending, startTransition] = useTransition();
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 1500);
  }

  function answer(value: boolean) {
    if (helpful === value) return; // no-op if same
    setHelpful(value); // optimistic
    announceFor(value ? 'Réponse « Oui » enregistrée' : 'Réponse « Pas vraiment » enregistrée');
    startTransition(async () => {
      const r = await setDeliveryHelpfulAction(deliveryId, value);
      if (!r.ok) {
        setHelpful(initialHelpful);
        announceFor('Échec, essaie à nouveau');
      }
    });
  }

  const tapAnim = prefersReducedMotion ? undefined : { scale: 0.96 };

  return (
    <div
      role="group"
      aria-labelledby="helpful-q"
      className="rounded-card flex flex-col gap-2 border border-[var(--b-default)] bg-[var(--bg-2)]/40 p-4"
    >
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>
      <p id="helpful-q" className="text-xs tracking-wide text-[var(--t-3)] uppercase">
        Cette fiche t&apos;a aidé&nbsp;?
      </p>
      <div className="flex gap-2">
        <motion.button
          type="button"
          onClick={() => answer(true)}
          disabled={pending}
          aria-pressed={helpful === true}
          {...(tapAnim ? { whileTap: tapAnim } : {})}
          className={cn(
            'rounded-pill inline-flex h-11 flex-1 items-center justify-center gap-2 px-4',
            'border text-sm font-medium transition-[border-color,background-color,box-shadow] duration-200',
            helpful === true
              ? 'border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)] shadow-[0_0_16px_-4px_var(--acc-glow)]'
              : 'border-[var(--b-default)] bg-[var(--bg-1)]/60 text-[var(--t-1)] hover:border-[var(--b-acc)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]',
            'disabled:opacity-50',
          )}
        >
          <ThumbsUp className="h-4 w-4" strokeWidth={1.75} />
          <span>Oui</span>
        </motion.button>
        <motion.button
          type="button"
          onClick={() => answer(false)}
          disabled={pending}
          aria-pressed={helpful === false}
          {...(tapAnim ? { whileTap: tapAnim } : {})}
          className={cn(
            'rounded-pill inline-flex h-11 flex-1 items-center justify-center gap-2 px-4',
            'border text-sm font-medium transition-[border-color,background-color,box-shadow] duration-200',
            helpful === false
              ? 'border-[oklch(0.834_0.158_80_/_0.40)] bg-[var(--warn-dim)] text-[var(--warn)]'
              : 'border-[var(--b-default)] bg-[var(--bg-1)]/60 text-[var(--t-1)] hover:border-[oklch(0.834_0.158_80_/_0.40)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--warn)]',
            'disabled:opacity-50',
          )}
        >
          <ThumbsDown className="h-4 w-4" strokeWidth={1.75} />
          <span>Pas vraiment</span>
        </motion.button>
      </div>
    </div>
  );
}
