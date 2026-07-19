'use server';

import { after } from 'next/server';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { runDataExportJob } from '@/lib/account/export-archive';
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

export async function requestDataExportAction(): Promise<RequestDataExportResult> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return { ok: false, error: 'unauthorized' };
  }
  const userId = session.user.id;

  try {
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
