import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * J6 (admin-scale, scope 6) — download-route authorization gate.
 *
 * Member-access negative tests (J6 pièges: every new endpoint proven against a
 * foreign seat). The heavy archive module is mocked — this suite only asserts
 * the auth / BOLA / readiness branches, never the streaming path.
 */

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: { dataExportJob: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/auth/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/account/export-archive', () => ({
  openExportReadStream: vi.fn(),
  buildExportZipFilename: (jobId: string) => `fxmily-export-${jobId.slice(-6)}.zip`,
}));

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { GET } from '@/app/api/account/data/export/[jobId]/route';

const JOB_ID = 'jobabc1234';
const req = (): NextRequest =>
  new NextRequest(`http://localhost/api/account/data/export/${JOB_ID}`);
const params = Promise.resolve({ jobId: JOB_ID });

function asSession(value: unknown): void {
  vi.mocked(auth).mockResolvedValue(value as never);
}
function asJob(value: unknown): void {
  vi.mocked(db.dataExportJob.findUnique).mockResolvedValue(value as never);
}

describe('GET /api/account/data/export/[jobId] — access gate', () => {
  beforeEach(() => {
    vi.mocked(auth).mockReset();
    vi.mocked(db.dataExportJob.findUnique).mockReset();
  });

  it('401 when unauthenticated', async () => {
    asSession(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    // Never even looked up the job.
    expect(db.dataExportJob.findUnique).not.toHaveBeenCalled();
  });

  it('401 when the account is not active (suspended)', async () => {
    asSession({ user: { id: 'me', status: 'suspended' } });
    const res = await GET(req(), { params });
    expect(res.status).toBe(401);
  });

  it('404 (not 403) when the job belongs to ANOTHER member — BOLA', async () => {
    asSession({ user: { id: 'me', status: 'active' } });
    asJob({ id: JOB_ID, userId: 'someone-else', status: 'ready' });
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('404 when the job does not exist', async () => {
    asSession({ user: { id: 'me', status: 'active' } });
    asJob(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it('409 when the owned job is not ready yet', async () => {
    asSession({ user: { id: 'me', status: 'active' } });
    asJob({ id: JOB_ID, userId: 'me', status: 'processing' });
    const res = await GET(req(), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_ready', status: 'processing' });
  });
});
