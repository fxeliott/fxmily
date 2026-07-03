import { Pill } from '@/components/ui/pill';
import { isTradeTagSlug } from '@/lib/schemas/trade';
import { isPositiveTradeTag, TRADE_TAG_LABELS } from '@/lib/trading/reflect-tags';

/**
 * Tour 11 — finding 3: restitute the REFLECT bias tags (auto/self classified at
 * close: loss-aversion, revenge-trade, discipline-high...) back to the member
 * on the trade detail. Before this, `Trade.tags` was dormant data the member
 * never saw.
 *
 * POSTURE §31.2 / Mark Douglas: a tag is a post-mortem classification of the
 * ACT, never a judgment of the trader. Bias tags render `mute` (neutral); the
 * strengths-based `discipline-high` is the only `ok` tone (isPositiveTradeTag).
 * NO red — red is reserved for trade outcomes.
 *
 * Renders nothing when there are no valid tags (no fabricated empty state).
 */
export function TradeBiasTags({ tags }: { tags: readonly string[] }) {
  // Keep only known slugs (a legacy/garbage value never renders a raw slug).
  const known = tags.filter(isTradeTagSlug);
  if (known.length === 0) return null;

  return (
    <div className="mt-4 border-t border-[var(--b-default)] pt-4">
      <h3 className="t-mono-cap mb-2 text-[var(--t-4)]">Biais repérés sur ce trade</h3>
      <ul className="flex flex-wrap gap-1.5">
        {known.map((slug) => (
          <li key={slug}>
            <Pill tone={isPositiveTradeTag(slug) ? 'ok' : 'mute'}>{TRADE_TAG_LABELS[slug]}</Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}
