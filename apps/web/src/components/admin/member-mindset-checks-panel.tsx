import { Brain } from 'lucide-react';

import { MindsetDashboard } from '@/components/mindset/mindset-dashboard';
import { MindsetTimeline } from '@/components/mindset/mindset-timeline';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { CURRENT_MINDSET_INSTRUMENT_VERSION } from '@/lib/mindset/instrument';
import type { MindsetDashboardData } from '@/lib/mindset/service';

/**
 * V1.5 — admin READ-ONLY mindset section (SPEC §27.4) for the member detail
 * `?tab=mindset`. Reuses the EXACT member-facing premium dashboard (radar +
 * per-dimension trends + strengths-based reading) + the timeline — both are
 * action-free by construction (NO form, NO mutation: lecture seule, §27.4).
 * Same isolation posture as the rest of the §21.6 surface (§21.5/§27.7: the
 * profile/trend are computed PURELY from the member's own mindset rows, never
 * a real-edge read). DS-v2 NEUTRAL (no cyan, no `.v18-theme`).
 */
export function MemberMindsetChecksPanel({ data }: { data: MindsetDashboardData }) {
  if (data.recent.length === 0) {
    return (
      <Card primary className="py-2">
        <EmptyState
          icon={Brain}
          headline="Aucune auto-évaluation mindset pour ce membre."
          lead="Le profil mental apparaîtra ici dès qu'il aura rempli sa première auto-évaluation hebdomadaire."
        />
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-slot="member-mindset-checks">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="t-h2 text-[var(--t-1)]">Mindset hebdo</h2>
        <p className="t-cap text-[var(--t-3)]">
          {data.recent.length} affichée{data.recent.length > 1 ? 's' : ''}
        </p>
      </div>

      <MindsetDashboard
        latestProfile={data.latestProfile}
        trend={data.trend}
        instrumentVersion={CURRENT_MINDSET_INSTRUMENT_VERSION}
      />

      <MindsetTimeline checks={data.recent} />
    </section>
  );
}
