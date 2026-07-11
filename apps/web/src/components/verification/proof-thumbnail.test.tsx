// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProofThumbnail } from './proof-thumbnail';

// P2 quick-win (2026-07-11) — purged proofs (Tour 13 `filePurgedAt`) must
// render a static placeholder with NO <img> and NO link so the browser never
// fires a request against the deleted file (no network 404).

const READ_URL = 'https://storage.example.com/proofs/abc123?signature=xyz';
const ARIA_LABEL = 'Ouvrir la capture du 3 juil. 2026 en grand (nouvel onglet)';

afterEach(() => {
  cleanup();
});

describe('ProofThumbnail', () => {
  describe('purged proof (filePurgedAt set)', () => {
    it('renders the placeholder without any <img> element', () => {
      const { container } = render(
        <ProofThumbnail purged readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />,
      );

      expect(container.querySelector('[data-slot="proof-thumbnail-purged"]')).not.toBeNull();
      // The whole point of the fix: zero <img> → zero network request → no 404.
      expect(container.querySelector('img')).toBeNull();
    });

    it('renders no link to the purged file', () => {
      const { container } = render(
        <ProofThumbnail purged readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />,
      );

      expect(container.querySelector('a')).toBeNull();
    });

    it('never references the dead readUrl anywhere in the markup', () => {
      const { container } = render(
        <ProofThumbnail purged readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />,
      );

      expect(container.innerHTML).not.toContain(READ_URL);
    });

    it('marks the decorative placeholder box aria-hidden', () => {
      const { container } = render(
        <ProofThumbnail purged readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />,
      );

      const placeholder = container.querySelector('[data-slot="proof-thumbnail-purged"]');
      expect(placeholder).toHaveAttribute('aria-hidden');
    });
  });

  describe('live proof (filePurgedAt null)', () => {
    it('renders the clickable thumbnail image pointing at the readUrl', () => {
      render(<ProofThumbnail purged={false} readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />);

      const img = screen.getByAltText("Capture d'historique MT5");
      expect(img).toHaveAttribute('src', READ_URL);
    });

    it('wraps the image in a new-tab link with the accessible label', () => {
      render(<ProofThumbnail purged={false} readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />);

      const link = screen.getByRole('link', { name: ARIA_LABEL });
      expect(link).toHaveAttribute('href', READ_URL);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
    });

    it('does not render the purged placeholder', () => {
      const { container } = render(
        <ProofThumbnail purged={false} readUrl={READ_URL} openAriaLabel={ARIA_LABEL} />,
      );

      expect(container.querySelector('[data-slot="proof-thumbnail-purged"]')).toBeNull();
    });
  });
});
