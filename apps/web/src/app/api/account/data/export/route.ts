import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { buildExportFilename, buildUserDataExport, summariseExport } from '@/lib/account/export';
import { logAudit } from '@/lib/auth/audit';
import { env } from '@/lib/env';

/**
 * `POST /api/account/data/export` — RGPD article 20 portability download.
 *
 * Why a route handler instead of a Server Action :
 *   - Server Actions in Next 16 are RPC-style and can't natively stream a
 *     `Content-Disposition: attachment` response. Wrapping the JSON in a
 *     `Blob` client-side requires an island, which we want to avoid.
 *   - A POST route lets the page submit a vanilla `<form>` and the browser
 *     downloads the JSON directly — no client JS needed.
 *
 * Defenses :
 *   - Auth required (active session). Suspended/deleted accounts get 401.
 *   - Same-origin Origin / Referer check (CSRF defence-in-depth on top of
 *     SameSite=Lax cookies). Hetzner cron + iOS WebView edge cases are
 *     covered by the audit log row regardless.
 *   - GET → 405 (download must be a deliberate POST).
 *   - `Cache-Control: no-store` so an intermediate caches don't snapshot
 *     the user's data.
 *
 * Audit row : `account.data.exported` with the `summariseExport` counts
 * (no PII in metadata — just row counts so we can detect a runaway export
 * loop in admin dashboards later).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // Strict same-origin check (J10 Phase G hardening — security-auditor T1.2 +
  // code-reviewer B3) : modern browsers ALWAYS send Origin on cross-site
  // POSTs and same-origin POSTs to authenticated endpoints. The previous
  // "skip if both null" lenience was OWASP-misaligned : a corp proxy that
  // strips Origin/Referer (rare but real, esp. on enterprise WebViews) +
  // an attacker-controlled <form action="..."> would clear the gate while
  // SameSite=Lax STILL forwards the auth cookie on a top-level POST
  // navigation. We now require either Origin OR Referer matching, and
  // reject with 403 when both are absent.
  const expectedOrigin = new URL(env.AUTH_URL).origin;
  const actualOrigin = req.headers.get('origin') ?? originFromReferer(req.headers.get('referer'));
  if (!actualOrigin || actualOrigin !== expectedOrigin) {
    return NextResponse.json({ error: 'origin_mismatch' }, { status: 403 });
  }

  let snapshot;
  try {
    snapshot = await buildUserDataExport(userId);
  } catch (err) {
    console.error('[account.data.export] build failed', err);
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const summary = summariseExport(snapshot);
  await logAudit({
    action: 'account.data.exported',
    userId,
    userAgent: req.headers.get('user-agent'),
    metadata: { ...summary },
  });

  const body = JSON.stringify(snapshot, null, 2);
  const filename = buildExportFilename(snapshot, userId);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      // Tag the response so a curl debugger can see the snapshot version
      // without reading the body.
      'X-Fxmily-Export-Schema': String(snapshot.schemaVersion),
    },
  });
}

export function GET(): NextResponse {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
