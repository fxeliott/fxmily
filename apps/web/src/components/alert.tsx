import type { ReactNode } from 'react';

/**
 * Status / error inline banner used on auth pages. Tokenizes the colors via
 * the design-system CSS vars (`--success` / `--danger` / `--accent`), so the
 * J10 palette refresh hits one place instead of N hardcoded shades.
 */

type AlertTone = 'success' | 'danger' | 'info';

interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
  /**
   * `alert` for errors (assertive, interrupts the screen reader); `status`
   * for success messages (polite). Default picks the right one per tone.
   */
  role?: 'alert' | 'status';
  className?: string;
}

const TONE_CLASSES: Record<AlertTone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-accent/30 bg-accent/10 text-accent',
};

export function Alert({ tone, children, role, className }: AlertProps) {
  const resolvedRole = role ?? (tone === 'danger' ? 'alert' : 'status');
  // `role="alert"` is assertive by default — passing `aria-live="polite"`
  // alongside is redundant. We only set `aria-live="polite"` for the
  // status-tone variant.
  const ariaLive = resolvedRole === 'status' ? 'polite' : undefined;

  return (
    <div
      role={resolvedRole}
      {...(ariaLive ? { 'aria-live': ariaLive } : {})}
      className={`rounded-md border px-3 py-2 text-sm ${TONE_CLASSES[tone]} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
