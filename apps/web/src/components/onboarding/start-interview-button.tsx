'use client';

import { ArrowRight, MessageCircleHeart } from 'lucide-react';
import { useFormStatus } from 'react-dom';

import { Btn } from '@/components/ui/btn';

/**
 * `<StartInterviewButton>` — the submit control for the onboarding interview
 * landing `<form action={startInterviewFormAction}>` (Tour 16).
 *
 * Extracted as a client component so it can read `useFormStatus()`: the Server
 * Action creates the interview row then redirects to `/onboarding/interview/new`,
 * which can take a beat. Without feedback a second tap fires a duplicate submit.
 * While pending we disable the button and swap the label (the DS `Btn` renders
 * its inline `Spinner` and sets `aria-busy` from `loading`).
 *
 * `useFormStatus` MUST live in a child of the `<form>` (never the form itself),
 * so this component is rendered *inside* the form in the page.
 */
export function StartInterviewButton(): React.ReactElement {
  const { pending } = useFormStatus();

  return (
    <Btn type="submit" kind="primary" size="l" loading={pending} className="w-full justify-center">
      {pending ? (
        'Préparation de ton entretien...'
      ) : (
        <>
          <MessageCircleHeart className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          Commencer mon entretien
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        </>
      )}
    </Btn>
  );
}
