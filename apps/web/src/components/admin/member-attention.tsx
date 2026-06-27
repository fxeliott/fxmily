import { MessageSquare, Scale, TrendingDown } from 'lucide-react';

import { Pill } from '@/components/ui/pill';
import type { MemberAttention } from '@/lib/admin/attention-service';

/**
 * S7 §33-#2 — the per-member "à traiter" badges shown in the global members
 * list. Renders ONLY what needs the admin's eyes (uncommented recent trades,
 * open truth gaps, a dipping constancy score); a clean member shows nothing, so
 * rows that need attention pop out at a glance.
 *
 * POSTURE (SPEC §2): calm coaching signal, never an alarm. Tones stay amber/blue
 * (warn/acc), never red — an absent comment or a dip is "à suivre", not a fault.
 */
interface MemberAttentionBadgesProps {
  attention: MemberAttention | undefined;
}

export function MemberAttentionBadges({ attention }: MemberAttentionBadgesProps) {
  if (!attention) return null;
  const { tradesToComment, openDiscrepancies, constancyDeclining } = attention;
  if (tradesToComment === 0 && openDiscrepancies === 0 && !constancyDeclining) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5" aria-label="Points à traiter">
      {tradesToComment > 0 ? (
        <Pill tone="acc">
          <MessageSquare aria-hidden="true" className="h-2.5 w-2.5" />
          {tradesToComment} à commenter
        </Pill>
      ) : null}
      {openDiscrepancies > 0 ? (
        <Pill tone="warn">
          <Scale aria-hidden="true" className="h-2.5 w-2.5" />
          {openDiscrepancies} écart{openDiscrepancies > 1 ? 's' : ''}
        </Pill>
      ) : null}
      {constancyDeclining ? (
        <Pill tone="warn">
          <TrendingDown aria-hidden="true" className="h-2.5 w-2.5" />
          Constance en baisse
        </Pill>
      ) : null}
    </div>
  );
}
