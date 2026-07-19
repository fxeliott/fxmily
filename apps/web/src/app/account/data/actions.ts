'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { reapStaleExportJobs, runDataExportJob } from '@/lib/account/export-archive';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';
import type { DataExportStatus } from '@/generated/prisma/enums';

/**
 * J6 (admin-scale, scope 6) — request an asynchronous RGPD export.
 *
 * Creates a `DataExportJob` and runs the heavy archive build (JSON + photos)
 * OUTSIDE the request via `after()` (J6 §6 "généré hors requête HTTP"). Dedup:
 * a member with a still-running job reuses it rather than spawning a duplicate
 * archive. The member is notified (`data_export_ready`) once the zip is flushed;
 * meanwhile `/account/data` polls the job status.
 */

export type RequestDataExportResult =
  | { ok: true; jobId: string; status: DataExportStatus; alreadyRunning: boolean }
  | { ok: false; error: 'unauthorized' | 'failed' };

/**
 * Min interval between two FULL archive rebuilds for one member. The
 * pending/processing dedup already blocks CONCURRENT builds; this bounds
 * back-to-back ones (a scripted loop re-requesting the instant each job flips to
 * `ready`) that would otherwise re-zip the member's whole media+JSON corpus on
 * every call. A member's data can't meaningfully change within the window, so
 * handing back the fresh archive is correct, not a degradation.
 */
const EXPORT_REBUILD_COOLDOWN_MS = 60_000;

export async function requestDataExportAction(): Promise<RequestDataExportResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const userId = session.user.id;

  try {
    // Self-heal FIRST: reap any zombie job (a pending/processing row whose
    // off-request build died with a server restart). Without this, the dedup
    // below would keep reusing the zombie and the member could NEVER start a new
    // export. Best-effort — a reap failure just falls through to the dedup.
    await reapStaleExportJobs(userId);

    // Dedup — reuse a job that is still pending/processing instead of stacking a
    // second concurrent archive for the same member.
    const existing = await db.dataExportJob.findFirst({
      where: { userId, status: { in: ['pending', 'processing'] } },
      select: { id: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { ok: true, jobId: existing.id, status: existing.status, alreadyRunning: true };
    }

    // Cooldown — if the member just completed an export (a `ready` job within the
    // window), hand back that fresh archive instead of rebuilding. Caps the
    // CPU/disk churn a rapid re-request loop could drive; the download link the
    // panel already shows keeps working.
    const recentReady = await db.dataExportJob.findFirst({
      where: {
        userId,
        status: 'ready',
        completedAt: { gte: new Date(Date.now() - EXPORT_REBUILD_COOLDOWN_MS) },
      },
      select: { id: true },
      orderBy: { completedAt: 'desc' },
    });
    if (recentReady) {
      return { ok: true, jobId: recentReady.id, status: 'ready', alreadyRunning: true };
    }

    const job = await db.dataExportJob.create({ data: { userId }, select: { id: true } });
    await logAudit({
      action: 'account.data.export_job.requested',
      userId,
      metadata: { jobId: job.id },
    });

    // Run OUT of the request lifecycle — the response returns immediately, the
    // archive builds in the background on the persistent Node server.
    after(async () => {
      await runDataExportJob(job.id);
    });

    revalidatePath('/account/data');
    return { ok: true, jobId: job.id, status: 'pending', alreadyRunning: false };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
