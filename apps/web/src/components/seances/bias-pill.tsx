import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { Pill } from '@/components/ui/pill';
import { biasMeta } from '@/lib/seances/derive';

/**
 * Normalised bias badge (Server Component). Non-chromatic encoding (icon + text,
 * never colour alone — WCAG 1.4.1): haussier→ok/up, baissier→bad/down,
 * neutre→mute/flat. Posture §2: qualifies what Eliott SAID, not a live signal.
 */
export function BiasPill({ bias }: { bias: string | null }) {
  const meta = biasMeta(bias);
  const Icon = meta.dir === 'up' ? TrendingUp : meta.dir === 'down' ? TrendingDown : Minus;
  return (
    <Pill tone={meta.tone}>
      <Icon className="h-2.5 w-2.5" strokeWidth={2.25} aria-hidden="true" />
      {meta.label}
    </Pill>
  );
}
