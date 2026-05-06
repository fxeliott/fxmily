'use client';

import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Btn } from '@/components/ui/btn';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  /** Bold one-liner describing the failure (no blame). */
  headline: ReactNode;
  /** Plain remediation paragraph — what the user can do. */
  action?: ReactNode;
  /** Technical cause string (collapsed by default behind a caret toggle). */
  cause?: string;
  /** Retry handler. If provided, shows the retry button. */
  onRetry?: () => void;
  className?: string;
}

/**
 * ErrorState — pattern non-blocking :
 *   icon alert halo bad + headline + remediation +
 *   collapsible technical cause + retry button
 *
 * Le détail technique est REPLIÉ par défaut (caret toggle) — le user
 * normal n'a pas besoin de voir le HTTPError 503 / request-id, mais
 * il est disponible pour le support.
 *
 * Posture déculpabilisante : "synchronisation impossible" > "vous n'avez pas pu".
 */
export function ErrorState({ headline, action, cause, onRetry, className }: ErrorStateProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      data-slot="error-state"
      className={cn('flex flex-col items-center px-6 py-8 text-center', className)}
    >
      {/* Strate 1 : icon alert halo bad */}
      <div className="relative mb-4">
        <div aria-hidden className="absolute inset-0 rounded-full bg-[var(--bad-dim-2)] blur-xl" />
        <div className="relative grid h-12 w-12 place-items-center rounded-full border border-[var(--b-danger)] bg-[var(--bg-2)] text-[var(--bad)]">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>

      {/* Strate 2 : headline */}
      <h3 className="t-h3 text-[var(--t-1)]">{headline}</h3>

      {/* Strate 3 : remediation */}
      {action ? <p className="t-body mt-1 max-w-[36ch] text-[var(--t-3)]">{action}</p> : null}

      {/* Strate 4 : caret toggle for cause */}
      {cause ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="error-cause"
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-[var(--t-4)] transition-colors hover:text-[var(--t-2)]"
        >
          {open ? (
            <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
          )}
          <span>{open ? 'Masquer' : 'Afficher'} le détail technique</span>
        </button>
      ) : null}

      {open && cause ? (
        <pre
          id="error-cause"
          className="rounded-control mt-2 max-w-[42ch] overflow-auto border border-[var(--b-default)] bg-[var(--bg)] px-3 py-2 text-left font-mono text-[10px] text-[var(--t-3)]"
        >
          {cause}
        </pre>
      ) : null}

      {/* Strate 5 : retry */}
      {onRetry ? (
        <div className="mt-4">
          <Btn kind="secondary" size="s" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            Réessayer
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
