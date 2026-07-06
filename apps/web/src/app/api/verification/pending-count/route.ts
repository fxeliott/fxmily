import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { countPendingProofs } from '@/lib/verification/service';

/**
 * Tour 15 — light poll endpoint for `/verification`.
 *
 * The `ProofAnalysisPoller` on the verification page used to `router.refresh()`
 * on a timer, which re-runs the whole Server Component (7 DB reads per tick).
 * This endpoint answers a single, tiny question — « how many of MY proofs are
 * still `ocrStatus=pending`? » — with one indexed `count`. The client polls
 * this cheap number and only triggers a full refresh when it CHANGES (a verdict
 * just landed), so the expensive re-render happens once per result, not on
 * every tick.
 *
 * Auth : active member session only. The count is scoped to `session.user.id`,
 * so a member can never read another member's queue. No PII in the payload —
 * just a number.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pending = await countPendingProofs(session.user.id);

  return NextResponse.json({ pending }, { headers: { 'Cache-Control': 'no-store' } });
}
