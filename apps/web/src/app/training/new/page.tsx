import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { TrainingFormWizard } from '@/components/training/training-form-wizard';
import { getTrainingSessionMeta } from '@/lib/training/training-session-service';

export const metadata = {
  title: 'Nouveau backtest · Entraînement',
};

export const dynamic = 'force-dynamic';

interface NewTrainingTradePageProps {
  searchParams: Promise<{ sessionId?: string }>;
}

/** A forged/foreign/stale `?sessionId` must degrade to a standalone backtest,
 * never crash or leak — mirror of the journal cursor-parse canon. */
function parseSessionId(value: string | undefined): string | undefined {
  return value && /^[a-z0-9]{20,40}$/i.test(value) ? value : undefined;
}

export default async function NewTrainingTradePage({ searchParams }: NewTrainingTradePageProps) {
  const session = await auth();
  // Defense-in-depth, mirroring the modern member-wizard canon (track/review):
  // symmetric with `createTrainingTradeAction`'s own status gate.
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const { sessionId: rawSessionId } = await searchParams;
  const sessionIdCandidate = parseSessionId(rawSessionId);

  // Resolve the parent session ONLY if it belongs to the member and is still
  // open. An ended/foreign/stale id silently drops to a standalone backtest
  // (the Server Action re-enforces ownership on submit regardless).
  const parentSession = sessionIdCandidate
    ? await getTrainingSessionMeta(sessionIdCandidate, session.user.id)
    : null;
  const activeSession = parentSession && !parentSession.isEnded ? parentSession : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <TrainingFormWizard
        sessionId={activeSession?.id ?? null}
        sessionLabel={activeSession?.label ?? null}
      />
    </main>
  );
}
