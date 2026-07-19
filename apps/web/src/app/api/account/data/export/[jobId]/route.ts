import { Readable } from 'node:stream';

import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { buildExportZipFilename, openExportReadStream } from '@/lib/account/export-archive';
import { logAudit } from '@/lib/auth/audit';
import { db } from '@/lib/db';

/**
 * `GET /api/account/data/export/[jobId]` — download a ready async RGPD export
 * (J6 admin-scale, scope 6). Streams the zip from the uploads volume; the bytes
 * never buffer whole in RAM (`Readable.toWeb` on a disk read stream).
 *
 * Defenses (mirror the interactive J10 export route):
 *   - Auth required (active session). Suspended/deleted accounts get 401.
 *   - BOLA: a job that is missing OR not owned by the caller returns 404 — never
 *     reveal another member's export exists. This is the member-access negative
 *     test target (J6 pièges: every new endpoint proven against a foreign seat).
 *   - Not-ready jobs get 409 (with the current status), never a partial file.
 *   - `Cache-Control: no-store` so nothing snapshots the member's data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  const job = await db.dataExportJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true },
  });
  // BOLA: 404 whether the job is missing or owned by someone else.
  if (!job || job.userId !== session.user.id) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (job.status !== 'ready') {
    return NextResponse.json({ error: 'not_ready', status: job.status }, { status: 409 });
  }

  let stream;
  let size;
  try {
    ({ stream, size } = await openExportReadStream(jobId));
  } catch {
    // The job row says ready but the file is gone (volume pruned / TTL sweep).
    return NextResponse.json({ error: 'export_not_found' }, { status: 410 });
  }

  await logAudit({
    action: 'account.data.exported',
    userId: session.user.id,
    userAgent: req.headers.get('user-agent'),
    metadata: { jobId, byteSize: size, via: 'async_job' },
  });

  const webStream = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${buildExportZipFilename(jobId)}"`,
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
}
