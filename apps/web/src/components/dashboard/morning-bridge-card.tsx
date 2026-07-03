import { Sunrise, HeartHandshake } from 'lucide-react';

import { Card } from '@/components/ui/card';
import type { MorningBridge } from '@/lib/coaching/morning-bridge';
import { cn } from '@/lib/utils';

/**
 * MorningBridgeCard (Tour 11) — the calm MORNING echo under the hero. It mirrors
 * yesterday's evening check-in back to the member on arrival (intention held,
 * plan respected, stress), or welcomes them warmly after an absence. Copy is
 * built upstream by the pure `buildMorningBridge` (enum-derived, personalised by
 * register) — this component only renders it.
 *
 * Server Component, zero JS: a compact single card so it adds LIFE without
 * noising the already-dense bento (sobriety — one calm card, not a banner).
 *
 * DETERMINISTIC copy (no AI) → no AIGeneratedBanner (AI Act §50 precedent:
 * learning-stage.ts). POSTURE §31.2: calm tones only — 'ok' renders in the OK
 * (accent-green) tint, 'neutral' stays muted; NEVER red (red is reserved for
 * trade outcomes). a11y: the glyph is decorative (aria-hidden), the state is
 * conveyed in text, never by colour alone.
 */
export function MorningBridgeCard({ bridge }: { bridge: MorningBridge }) {
  const isWelcome = bridge.kind === 'welcome-back';
  const Icon = isWelcome ? HeartHandshake : Sunrise;
  const surface =
    bridge.tone === 'ok'
      ? 'border-[var(--ok-edge)] bg-[var(--ok-dim-2)]'
      : 'border-[var(--b-default)] bg-[var(--bg-2)]/40';
  const iconTone = bridge.tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--t-3)]';

  return (
    <Card data-slot="morning-bridge" data-kind={bridge.kind} className={cn('border p-4', surface)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--b-default)] bg-[var(--bg-1)]',
            iconTone,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 className="t-eyebrow text-[var(--t-3)]">{bridge.title}</h2>
          {bridge.lines.map((line, i) => (
            <p
              key={i}
              className={cn(
                't-body leading-relaxed',
                i === 0 ? 'text-[var(--t-1)]' : 'text-[var(--t-2)]',
              )}
            >
              {line}
            </p>
          ))}
        </div>
      </div>
    </Card>
  );
}
