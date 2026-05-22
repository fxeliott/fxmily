'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TrendingUp, Activity, BarChart3, Layers } from 'lucide-react';
import { EquityCurve } from './charts/equity-curve';
import { DrawdownUnderwater } from './charts/drawdown-underwater';
import { RDistribution } from './charts/r-distribution';
import { InstrumentBreakdown } from './charts/instrument-breakdown';
import type { EquityPoint, InstrumentAggregate, RBucket } from '@/lib/metrics';

type TabId = 'equity' | 'drawdown' | 'rdist' | 'instruments';

interface ChartTabPanelProps {
  equityCurve: readonly EquityPoint[];
  rBuckets: readonly RBucket[];
  instruments: readonly InstrumentAggregate[];
}

interface TabDef {
  id: TabId;
  label: string;
  shortLabel: string;
  Icon: typeof TrendingUp;
  caption: string;
}

const TABS: readonly TabDef[] = [
  {
    id: 'equity',
    label: 'Courbe d’équity',
    shortLabel: 'Équity',
    Icon: TrendingUp,
    caption: 'Cumulé arithmétique des résultats %',
  },
  {
    id: 'drawdown',
    label: 'Drawdown',
    shortLabel: 'Drawdown',
    Icon: Activity,
    caption: 'Décrochage cumulé sous le pic',
  },
  {
    id: 'rdist',
    label: 'Distribution des R',
    shortLabel: 'R-dist',
    Icon: BarChart3,
    caption: 'Histogramme buckets 0,5R',
  },
  {
    id: 'instruments',
    label: 'Instruments',
    shortLabel: 'Paires',
    Icon: Layers,
    caption: 'Performance par instrument',
  },
];

/**
 * Tab-driven chart panel (ARIA APG canonical tabs pattern).
 *
 * - `role="tablist" | "tab" | "tabpanel"` strict
 * - `aria-controls` + `aria-labelledby` croisés
 * - Roving tabindex (focused tab = 0, autres = -1)
 * - Arrow keys ←/→ cycle, Home/End jump
 * - `AnimatePresence mode="wait"` cross-fade 180ms entre tabs
 * - `layoutId="track-record-tab-underline"` FLIP transition entre tabs
 * - `prefers-reduced-motion` honoré (skip motion, panel swap instant)
 *
 * Source : research motion design subagent + WAI-ARIA APG 1.2 Tabs Pattern.
 */
export function ChartTabPanel({ equityCurve, rBuckets, instruments }: ChartTabPanelProps) {
  const [active, setActive] = useState<TabId>('equity');
  const tablistId = useId();
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    equity: null,
    drawdown: null,
    rdist: null,
    instruments: null,
  });
  const reduced = useReducedMotion();

  const focusTab = useCallback((id: TabId) => {
    setActive(id);
    // Defer focus until after re-render to ensure tabIndex updated.
    requestAnimationFrame(() => tabRefs.current[id]?.focus());
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const idx = TABS.findIndex((t) => t.id === active);
      if (idx < 0) return;
      const len = TABS.length;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = TABS[(idx + 1) % len];
        if (next) focusTab(next.id);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = TABS[(idx - 1 + len) % len];
        if (prev) focusTab(prev.id);
      } else if (e.key === 'Home') {
        e.preventDefault();
        const first = TABS[0];
        if (first) focusTab(first.id);
      } else if (e.key === 'End') {
        e.preventDefault();
        const last = TABS[len - 1];
        if (last) focusTab(last.id);
      }
    },
    [active, focusTab],
  );

  const activeTab = TABS.find((t) => t.id === active);

  const panelMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, filter: 'blur(4px)', y: 6 },
        animate: { opacity: 1, filter: 'blur(0px)', y: 0 },
        exit: { opacity: 0, filter: 'blur(4px)', y: -6 },
      };

  return (
    <section className="rounded-xl border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)]">
      {/* Tablist */}
      <div className="border-b border-[var(--tr-b-subtle)] px-2 sm:px-4">
        <div
          role="tablist"
          aria-label="Vues du track record"
          aria-orientation="horizontal"
          id={tablistId}
          className="flex items-center gap-1 overflow-x-auto"
        >
          {TABS.map((t) => {
            const isActive = active === t.id;
            const Icon = t.Icon;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                role="tab"
                id={`tr-tab-${t.id}`}
                aria-selected={isActive}
                aria-controls={`tr-panel-${t.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(t.id)}
                onKeyDown={onKeyDown}
                className="relative inline-flex shrink-0 items-center gap-2 px-3.5 py-3 text-[13px] font-medium tracking-tight whitespace-nowrap transition-colors"
                style={{ color: isActive ? 'var(--tr-t-1)' : 'var(--tr-t-3)' }}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.shortLabel}</span>
                {isActive && (
                  <motion.span
                    layoutId="track-record-tab-underline"
                    className="absolute inset-x-3.5 -bottom-px h-[2px] rounded-full"
                    style={{ background: 'var(--tr-acc)' }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel header (caption au-dessus du chart). */}
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--tr-b-subtle)] px-5 py-3">
        <div className="text-[11px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
          {activeTab?.caption ?? ''}
        </div>
        <div className="font-mono text-[11px] text-[var(--tr-t-3)] tabular-nums">
          {TABS.findIndex((t) => t.id === active) + 1}/{TABS.length}
        </div>
      </div>

      {/* Tabpanel content (only the active one is rendered ⇒ Recharts ne re-monte
       * pas inutilement les autres au scroll fold-1). */}
      <div className="p-4 sm:p-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            role="tabpanel"
            id={`tr-panel-${active}`}
            aria-labelledby={`tr-tab-${active}`}
            tabIndex={0}
            {...panelMotion}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="outline-none focus-visible:rounded-md"
          >
            {active === 'equity' && <EquityCurve data={equityCurve} height={340} />}
            {active === 'drawdown' && <DrawdownUnderwater data={equityCurve} height={340} />}
            {active === 'rdist' && <RDistribution buckets={rBuckets} height={340} />}
            {active === 'instruments' && (
              <div className="-mx-1 max-h-[340px] overflow-y-auto">
                <InstrumentBreakdown data={instruments} limit={12} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
