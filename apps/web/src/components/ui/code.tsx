import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * `<Code>` — DS v2 inline code primitive (J10 Phase I — UI designer T3-6).
 *
 * Three callsites previously re-declared `rounded bg-[var(--bg-2)] px-1.5
 * py-0.5 font-mono text-[11-12px]` independently :
 *  - `LegalLayout` prose ramp
 *  - `/account/data` form helper text
 *  - `/account/delete` type-to-confirm input label
 *
 * One source of truth keeps drift at bay when DS tokens move.
 */
export function Code({
  className,
  ...props
}: ComponentPropsWithoutRef<'code'>): React.ReactElement {
  return (
    <code
      className={cn(
        'rounded bg-[var(--bg-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--t-1)] sm:text-[12px]',
        className,
      )}
      {...props}
    />
  );
}
