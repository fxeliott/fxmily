import { z } from 'zod';

import { isSupportedTimezone } from '@/lib/timezones';

/**
 * F2 — member timezone edit input.
 *
 * The picker only offers IANA names from `SUPPORTED_TIMEZONES` (built from
 * `Intl.supportedValuesOf`), so the write path validates against that exact
 * allowlist: strictest possible (rejects any arbitrary string a malicious
 * client could POST) and guarantees the persisted value is a zone the core
 * time-lib resolves correctly. A non-IANA / look-alike / bidi-padded string is
 * not in the set, so it is rejected before it can silently degrade the member
 * to the UTC fallback baked into `lib/checkin/timezone.ts`.
 *
 * The `.max(64)` guard caps payload size before the set lookup (longest real
 * IANA name is well under 64 chars).
 */
export const updateTimezoneInputSchema = z
  .object({
    timezone: z.string().max(64).refine(isSupportedTimezone, { message: 'unknown_timezone' }),
  })
  .strict();

export type UpdateTimezoneInput = z.infer<typeof updateTimezoneInputSchema>;
