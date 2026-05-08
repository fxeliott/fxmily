import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { logAudit } from '@/lib/auth/audit';
import { TooManySubscriptionsError, upsertPushSubscription } from '@/lib/push/service';
import { pushSubscriptionInputSchema } from '@/lib/schemas/push-subscription';

/**
 * J9 — `pushsubscriptionchange` re-subscribe endpoint.
 *
 * Wired by `public/sw.js:217` : when Firefox (or any browser that fires the
 * event) detects that the subscription has been invalidated by the push
 * service (e.g. VAPID key rotation, server endpoint expiration), the SW
 * subscribes again with the same `applicationServerKey` and POSTs the new
 * `subscription.toJSON()` here.
 *
 * Why a route handler (vs a Server Action) :
 * - Service Workers can't invoke Next.js Server Actions natively (the action
 *   is bound to a React form id that the SW doesn't have).
 * - A plain JSON POST works from anywhere, including the SW context.
 * - CSRF protection : we rely on the session cookie + Zod-validated body. The
 *   SW always sends `credentials: 'include'`, so the cookie reaches us.
 *
 * Auth posture (defense in depth) :
 * 1. `auth()` re-check — must have an active session.
 * 2. `session.user.status === 'active'` — suspended members can't re-up.
 * 3. Zod-validate the body — rejects malformed shapes.
 * 4. Upsert is keyed by `(userId, endpoint)` — no cross-user write possible
 *    (caller owns userId via session).
 *
 * Audit : emits `push.subscription.updated` (Firefox-spec re-subscribe is
 * functionally an update of the same logical row, not a new device).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = pushSubscriptionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }

  const ua = req.headers.get('user-agent');

  let id: string;
  let created: boolean;
  try {
    const result = await upsertPushSubscription(userId, parsed.data, ua);
    id = result.id;
    created = result.created;
  } catch (err) {
    if (err instanceof TooManySubscriptionsError) {
      return NextResponse.json({ error: 'too_many_devices' }, { status: 400 });
    }
    throw err;
  }

  await logAudit({
    action: created ? 'push.subscription.created' : 'push.subscription.updated',
    userId,
    metadata: {
      subscriptionId: id,
      via: 'pushsubscriptionchange',
    },
  });

  return NextResponse.json({ ok: true, created }, { status: 200 });
}

export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
