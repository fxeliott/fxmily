// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIGeneratedBanner } from './ai-generated-banner';

// `vitest.config.ts` has `globals: false`, so @testing-library/react
// auto-cleanup doesn't register on `afterEach`. Wire it manually so each
// `render()` starts from an empty document body.
afterEach(() => {
  cleanup();
});

// jsdom env startup can spike past 5s on cold Windows filesystem (cache
// invalidation after date rollover, antivirus scan, etc.). The default
// 5000ms testTimeout is borderline — bump to 15s for this file so the
// first render() doesn't fail intermittently on slow boxes.
vi.setConfig({ testTimeout: 15000 });

/**
 * V1.7 prep DORMANT — TDD coverage for the EU AI Act 50(1) disclaimer banner.
 *
 * Critical : the wording is verbatim regulated-by-2026-08-02. Snapshot the
 * canonical sentence so an accidental copy edit fails the build.
 */

describe('AIGeneratedBanner', () => {
  describe('inline variant (default)', () => {
    it('renders the canonical disclaimer copy', () => {
      render(<AIGeneratedBanner />);
      expect(
        screen.getByText(/Ce rapport est généré par une intelligence artificielle/),
      ).toBeInTheDocument();
      expect(screen.getByText(/Claude \(famille Sonnet\)/)).toBeInTheDocument();
      expect(screen.getByText(/Anthropic/)).toBeInTheDocument();
      // Posture Mark Douglas — must explicitly disclaim coaching substitution
      expect(screen.getByText(/ne remplace ni un coaching humain/)).toBeInTheDocument();
      // EU AI Act 50(1) — explicit "not a substitute for medical/financial advice"
      expect(screen.getByText(/ni un avis médical/)).toBeInTheDocument();
      expect(screen.getByText(/ni un conseil en investissement personnalisé/)).toBeInTheDocument();
    });

    it('uses role="note" for screen reader semantics', () => {
      render(<AIGeneratedBanner />);
      expect(screen.getByRole('note')).toBeInTheDocument();
    });

    it('has descriptive aria-label', () => {
      render(<AIGeneratedBanner />);
      expect(screen.getByLabelText('Avis sur le contenu généré par IA')).toBeInTheDocument();
    });

    it('accepts a modelName override (V2026 anti-drift)', () => {
      render(<AIGeneratedBanner modelName="Claude Opus 5" />);
      expect(screen.getByText(/Claude Opus 5, Anthropic/)).toBeInTheDocument();
    });

    it('passes through className for layout control', () => {
      const { container } = render(<AIGeneratedBanner className="my-4" />);
      const aside = container.querySelector('aside');
      expect(aside?.className).toContain('my-4');
    });

    // V1.9 TIER A : closes EU AI Act §50 transparency loop by linking the
    // disclosure surface page shipped PR #67 (2026-05-14).
    it('links to /legal/ai-disclosure for full transparency surface', () => {
      render(<AIGeneratedBanner />);
      const link = screen.getByRole('link', { name: /En savoir plus/ });
      expect(link).toBeInTheDocument();
      expect(link.getAttribute('href')).toBe('/legal/ai-disclosure');
    });
  });

  describe('badge variant', () => {
    it('renders compact pill copy', () => {
      render(<AIGeneratedBanner variant="badge" />);
      expect(screen.getByText(/Généré par IA — pas substitut coaching humain/)).toBeInTheDocument();
    });

    it('uses span (not aside) for inline placement', () => {
      const { container } = render(<AIGeneratedBanner variant="badge" />);
      expect(container.querySelector('aside')).toBeNull();
      expect(container.querySelector('span[role="note"]')).toBeInTheDocument();
    });

    it('keeps the same role + aria-label as inline', () => {
      render(<AIGeneratedBanner variant="badge" />);
      expect(screen.getByRole('note')).toBeInTheDocument();
      expect(screen.getByLabelText('Avis sur le contenu généré par IA')).toBeInTheDocument();
    });
  });

  describe('regulatory anchors (anti-regression)', () => {
    it('does NOT use the word "decision" (AI Act 50(1) is about transparency, not deciding)', () => {
      render(<AIGeneratedBanner />);
      // Anti-cargo-cult : the AI Act 50(1) deadline is for chatbot transparency,
      // NOT high-risk automated decisions (which is Article 6 + Annex III).
      // The banner copy must NOT imply the AI "decides" anything for the member.
      const text = screen.getByRole('note').textContent || '';
      expect(text.toLowerCase()).not.toContain('décision');
      expect(text.toLowerCase()).not.toContain('décide');
    });

    it('does NOT anthropomorphize the LLM', () => {
      render(<AIGeneratedBanner />);
      const text = screen.getByRole('note').textContent || '';
      // Mark Douglas posture : no "Claude pense", "Claude recommande", etc.
      expect(text.toLowerCase()).not.toContain('claude pense');
      expect(text.toLowerCase()).not.toContain("l'ia recommande");
      expect(text.toLowerCase()).not.toContain('claude recommande');
    });
  });
});
