'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState, useTransition } from 'react';

import { setDeliveryHelpfulAction } from '@/app/library/actions';
import { cn } from '@/lib/utils';

interface HelpfulFeedbackProps {
  deliveryId: string;
  initialHelpful: boolean | null;
}

/**
 * Two-button helpful/not-helpful toggle on a delivery (J7).
 *
 * Replaces the binary semantics with explicit two-button UI: clicking the
 * already-active button keeps it selected (no toggle-off — once you've given
 * an honest opinion, retracting it would be churn). Clicking the other button
 * flips the answer.
 */
export function HelpfulFeedback({ deliveryId, initialHelpful }: HelpfulFeedbackProps) {
  const [helpful, setHelpful] = useState<boolean | null>(initialHelpful);
  const [pending, startTransition] = useTransition();

  function answer(value: boolean) {
    if (helpful === value) return; // no-op if same
    setHelpful(value); // optimistic
    startTransition(async () => {
      const r = await setDeliveryHelpfulAction(deliveryId, value);
      if (!r.ok) {
        setHelpful(initialHelpful);
      }
    });
  }

  return (
    <div className="rounded-card border-border bg-bg-2/40 flex flex-col gap-2 border p-4">
      <p className="text-muted text-xs uppercase tracking-wide">Cette fiche t&apos;a aidé&nbsp;?</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={pending}
          aria-pressed={helpful === true}
          className={cn(
            'rounded-pill inline-flex h-11 flex-1 items-center justify-center gap-2 px-4',
            'border text-sm font-medium transition-all',
            helpful === true
              ? 'border-acc/40 bg-acc/15 text-acc'
              : 'border-border bg-background/60 text-foreground hover:border-acc/40',
            'focus-visible:outline-acc focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:opacity-50',
          )}
        >
          <ThumbsUp className="h-4 w-4" />
          <span>Oui</span>
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={pending}
          aria-pressed={helpful === false}
          className={cn(
            'rounded-pill inline-flex h-11 flex-1 items-center justify-center gap-2 px-4',
            'border text-sm font-medium transition-all',
            helpful === false
              ? 'border-warn/40 bg-warn/15 text-warn'
              : 'border-border bg-background/60 text-foreground hover:border-warn/40',
            'focus-visible:outline-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            'disabled:opacity-50',
          )}
        >
          <ThumbsDown className="h-4 w-4" />
          <span>Pas vraiment</span>
        </button>
      </div>
    </div>
  );
}
