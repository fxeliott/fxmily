import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccessRejectedEmail } from './access-rejected';

/**
 * §26.4 — Render test for the "demande non retenue" email.
 *
 * Pins: it renders, the respectful heading + copy are present, it greets by
 * first name, the ONLY contact exposed is `fxeliott@fxmily.fr` (privacy §26),
 * and CRUCIALLY there is NO link/token/CTA (a refusal has no further action) —
 * which also means no invite URL can leak.
 */
describe('AccessRejectedEmail', () => {
  it('renders the respectful heading + copy', () => {
    const html = renderToStaticMarkup(<AccessRejectedEmail firstName="Ana" />);
    expect(html).toContain('Ta demande');
    expect(html).toContain('pas été retenue');
  });

  it('greets by first name when provided', () => {
    const html = renderToStaticMarkup(<AccessRejectedEmail firstName="Ana" />);
    expect(html).toContain('Ana');
  });

  it('renders without a name gracefully (no "undefined" leak)', () => {
    const html = renderToStaticMarkup(<AccessRejectedEmail firstName={null} />);
    expect(html).not.toContain('undefined');
  });

  it('exposes ONLY the fxeliott@fxmily.fr contact (privacy §26)', () => {
    const html = renderToStaticMarkup(<AccessRejectedEmail firstName="Ana" />);
    expect(html).toContain('fxeliott@fxmily.fr');
  });

  it('contains NO link/token/CTA — a refusal is terminal', () => {
    const html = renderToStaticMarkup(<AccessRejectedEmail firstName="Ana" />);
    // No onboarding/invite URL, no token query param.
    expect(html).not.toContain('/onboarding/welcome');
    expect(html).not.toContain('token=');
    // The only href is the mailto contact — no http(s) action link.
    expect(html).not.toContain('href="http');
  });

  it('exports PreviewProps for the react-email preview tooling', () => {
    expect(AccessRejectedEmail.PreviewProps).toMatchObject({ firstName: expect.any(String) });
  });
});
