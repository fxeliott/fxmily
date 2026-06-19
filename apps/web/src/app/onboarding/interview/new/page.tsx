import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { OnboardingInterviewWizard } from '@/components/onboarding/onboarding-interview-wizard';
import { db } from '@/lib/db';
import { getInterviewForUser } from '@/lib/onboarding-interview/service';

export const metadata = {
  title: 'Entretien',
};

export const dynamic = 'force-dynamic';

/**
 * V2.4 Phase B — `/onboarding/interview/new` host wizard (M3 directive).
 *
 * Server Component, DS-v2 lime neutral. Reads server-truth interview state +
 * existing answers from Prisma, derives `initialStep` (= answers.length, first
 * unanswered Q), passes to `<OnboardingInterviewWizard>`.
 *
 * Routing decisions :
 *   - No active interview → redirect `/onboarding/interview` (defensive
 *     caller). The landing page's CTA is the canonical entry point.
 *   - Completed → redirect `/dashboard` (no editing post-finalize V1 —
 *     instrument is one-shot per §27.7 longitudinal validity).
 *   - In-flight (`started` or `in_progress`) → render wizard, resume at first
 *     unanswered question.
 *
 * Posture §27.7 — answers are read directly via Prisma `narrow select` (3 fields
 * only : questionIndex + questionKey + answerText) for data-minimality. The
 * dette héritée Phase A.1 `questionText: ''` placeholder doesn't affect the
 * wizard (it has the instrument client-side via `ONBOARDING_INSTRUMENT_V1`).
 */
export default async function OnboardingInterviewNewPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') redirect('/login');

  const interview = await getInterviewForUser(session.user.id);
  if (!interview) {
    redirect('/onboarding/interview');
  }
  if (interview.status === 'completed') {
    redirect('/dashboard');
  }

  // Load existing answers (narrow select — data-minimality §16).
  const answerRows = await db.onboardingInterviewAnswer.findMany({
    where: { userId: session.user.id, interviewId: interview.id },
    select: { questionIndex: true, answerText: true },
    orderBy: { questionIndex: 'asc' },
  });

  // Build a sparse map { questionIndex → answerText } so non-contiguous
  // skipped questions don't pull subsequent indices forward.
  const initialAnswers: Record<number, string> = {};
  for (const row of answerRows) {
    initialAnswers[row.questionIndex] = row.answerText;
  }
  // First unanswered question = the smallest index from 0..29 not in the map.
  let initialStep = 0;
  for (let i = 0; i < 30; i++) {
    if (initialAnswers[i] === undefined) {
      initialStep = i;
      break;
    }
    initialStep = i + 1;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/onboarding/interview"
          className="inline-flex w-fit items-center gap-1.5 text-[12px] text-[var(--t-3)] transition-colors hover:text-[var(--t-1)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Présentation
        </Link>
      </header>

      <OnboardingInterviewWizard initialStep={initialStep} initialAnswers={initialAnswers} />
    </main>
  );
}
