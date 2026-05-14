// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Framer Motion AnimatePresence pass-through (same pattern as the wizard
// tests) — the tooltip aside relies on AnimatePresence, and the spring
// transition can defer mount in jsdom.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  const stripFramerProps = (rest: Record<string, unknown>) => {
    const drop = new Set([
      'initial',
      'animate',
      'exit',
      'transition',
      'whileHover',
      'whileTap',
      'whileFocus',
      'whileInView',
      'layout',
      'layoutId',
      'variants',
      'drag',
      'dragConstraints',
      'onAnimationStart',
      'onAnimationComplete',
    ]);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (!drop.has(k)) out[k] = v;
    }
    return out;
  };
  const passthrough = (Tag: string) => {
    const C = ({ children, ...rest }: Props) =>
      React.createElement(Tag, stripFramerProps(rest), children);
    C.displayName = `MockMotion(${Tag})`;
    return C;
  };
  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) => passthrough(prop),
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: Props) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
    LazyMotion: ({ children }: Props) => React.createElement(React.Fragment, null, children),
    domAnimation: {},
    m: motion,
  };
});

import { TradeTagsPicker } from './trade-tags-picker';
import { TRADE_TAGS_MAX_PER_TRADE, type TradeTagSlug } from '@/lib/schemas/trade';

afterEach(() => {
  cleanup();
});

vi.setConfig({ testTimeout: 15000 });

/**
 * Small controlled-wrapper so we can drive the picker the way a parent form
 * would (parent owns state, picker only emits diffs). Saves a `useState`
 * inside every test.
 */
function ControlledPicker({
  initial = [],
  onChange,
}: {
  initial?: readonly TradeTagSlug[];
  onChange?: (next: TradeTagSlug[]) => void;
}) {
  const [value, setValue] = useState<readonly TradeTagSlug[]>(initial);
  const handle = useCallback(
    (next: TradeTagSlug[]) => {
      setValue(next);
      onChange?.(next);
    },
    [onChange],
  );
  return <TradeTagsPicker value={value} onChange={handle} />;
}

describe('TradeTagsPicker', () => {
  describe('render initial', () => {
    it('should render all 8 LESSOR + Steenbarger tag switches', () => {
      // Arrange + Act
      render(<ControlledPicker />);

      // Assert — 8 buttons with role="switch"
      const switches = screen.getAllByRole('switch');
      expect(switches).toHaveLength(8);

      // Discipline solide is the strengths-based outlier
      expect(screen.getByRole('switch', { name: /Discipline solide/i })).toBeInTheDocument();
      // 7 LESSOR/Steenbarger bias tags — spot-check 3 anchors
      expect(screen.getByRole('switch', { name: /Sur-confiance/i })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /Revenge trade/i })).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /Aversion à la perte/i })).toBeInTheDocument();
    });

    it('should render the counter at "0 / 3" when no tag is selected', () => {
      // Arrange + Act
      const { container } = render(<ControlledPicker />);

      // Assert — counter is in the <legend>
      const legend = container.querySelector('legend');
      expect(legend?.textContent).toMatch(/0\s*\/\s*3/);
    });

    it('should not render any hidden input when no tag is selected', () => {
      // Arrange + Act
      const { container } = render(<ControlledPicker />);

      // Assert
      expect(container.querySelectorAll('input[type="hidden"][name="tags"]')).toHaveLength(0);
    });
  });

  describe('toggle behaviour', () => {
    it('should add a hidden input named "tags" when a switch is clicked and call onChange with the slug', async () => {
      // Arrange
      const onChange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(<ControlledPicker onChange={onChange} />);

      // Act
      const sw = screen.getByRole('switch', { name: /Sur-confiance/i });
      await user.click(sw);

      // Assert — onChange called with the canonical slug
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenLastCalledWith(['overconfidence']);
      // aria-checked flipped
      expect(sw).toHaveAttribute('aria-checked', 'true');
      // hidden input added with the slug
      const hidden = container.querySelectorAll('input[type="hidden"][name="tags"]');
      expect(hidden).toHaveLength(1);
      expect((hidden[0] as HTMLInputElement).value).toBe('overconfidence');
    });

    it('should remove a tag when an already-on switch is clicked', async () => {
      // Arrange
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<ControlledPicker initial={['overconfidence']} onChange={onChange} />);
      const sw = screen.getByRole('switch', { name: /Sur-confiance/i });
      expect(sw).toHaveAttribute('aria-checked', 'true');

      // Act
      await user.click(sw);

      // Assert
      expect(onChange).toHaveBeenLastCalledWith([]);
      expect(sw).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('cap enforcement (max 3)', () => {
    it('should enforce the 3-tag cap : a 4th click is a no-op and the remaining switches are aria-disabled', async () => {
      // Arrange — pre-fill 3 tags (the cap)
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(
        <ControlledPicker
          initial={['overconfidence', 'status-quo', 'loss-aversion']}
          onChange={onChange}
        />,
      );
      // Sanity — counter at cap
      expect(screen.getByText(/3\s*\/\s*3/)).toBeInTheDocument();
      // Helper text appears
      expect(screen.getByText(/Maximum atteint\./i)).toBeInTheDocument();

      // The 4 not-yet-selected switches are aria-disabled
      const unselectedNames = [
        /Aversion au regret/i,
        /Effet de dotation/i,
        /Manque de discipline/i,
        /Revenge trade/i,
        /Discipline solide/i,
      ];
      for (const name of unselectedNames) {
        const sw = screen.getByRole('switch', { name });
        expect(sw).toHaveAttribute('aria-disabled', 'true');
      }

      // Act — click a 4th tag (should be a no-op per component contract)
      const fourth = screen.getByRole('switch', { name: /Revenge trade/i });
      await user.click(fourth);

      // Assert — onChange was NOT called (cap enforced silently)
      expect(onChange).not.toHaveBeenCalled();
      // Still 3 hidden inputs
      const hidden = document.querySelectorAll('input[type="hidden"][name="tags"]');
      expect(hidden).toHaveLength(TRADE_TAGS_MAX_PER_TRADE);
    });
  });

  describe('discipline-high strengths icon (WCAG 1.4.1)', () => {
    it('should render a ThumbsUp icon (not the default Check) inside the discipline-high tag when selected', () => {
      // Arrange + Act
      render(<ControlledPicker initial={['discipline-high']} />);

      // Assert — the lucide-react ThumbsUp icon mounts a <svg
      // class="lucide lucide-thumbs-up"> with aria-hidden="true" (no role)
      const sw = screen.getByRole('switch', { name: /Discipline solide/i });
      const svg = sw.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('class') ?? '').toMatch(/thumbs-up/);
      // Anti-regression — Check should NOT appear inside discipline-high
      // while it's selected (color-blind users distinguish strengths vs
      // bias via the icon shape, not just colour).
      expect(svg?.getAttribute('class') ?? '').not.toMatch(/lucide-check\b/);
    });

    it('should render a Check icon (not ThumbsUp) inside a bias tag when selected', () => {
      // Arrange + Act
      render(<ControlledPicker initial={['overconfidence']} />);

      // Assert
      const sw = screen.getByRole('switch', { name: /Sur-confiance/i });
      const svg = sw.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('class') ?? '').toMatch(/lucide-check\b/);
      expect(svg?.getAttribute('class') ?? '').not.toMatch(/thumbs-up/);
    });
  });

  describe('tooltip on hover/focus', () => {
    it('should reveal the academic-source tooltip when a tag is focused', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<ControlledPicker />);

      // Act — focus (Tab) onto the first switch
      // (`user.tab` lands on the first focusable element — the first switch).
      await user.tab();

      // Assert — the tooltip <aside role="note"> reveals with the source meta
      const note = await screen.findByRole('note');
      expect(note).toBeInTheDocument();
      // First tag in TAG_METAS is "Sur-confiance" / source "CFA LESSOR-O"
      expect(within(note).getByText(/CFA LESSOR-O/)).toBeInTheDocument();
      expect(within(note).getByText(/pré-entrée/)).toBeInTheDocument();
    });
  });
});
