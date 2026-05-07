'use client';

import { useEffect } from 'react';

import { markDeliverySeenAction } from '@/app/library/actions';

interface MarkSeenOnMountProps {
  deliveryId: string;
}

/**
 * Fire-and-forget: when the reader page mounts, mark the linked delivery
 * as seen. Server Action handles auth + idempotency + audit. We don't
 * await — the user's experience is unaffected by the round-trip.
 */
export function MarkSeenOnMount({ deliveryId }: MarkSeenOnMountProps) {
  useEffect(() => {
    void markDeliverySeenAction(deliveryId);
  }, [deliveryId]);
  return null;
}
