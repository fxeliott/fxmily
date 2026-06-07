import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccessApprovedEmail } from './access-approved';

/**
 * V2.5 — Render test for the premium "demande acceptée" email.
 *
 * React Email components are plain React, so `renderToStaticMarkup` produces
 * the HTML without the `@react-email/render` dependency. We pin: it renders,
 * the CTA href is the onboarding invite URL (the reused pipeline), the warm
 * heading + premium copy are present, and the expiry note shows.
 */

const INVITE_URL = 'https://app.fxmilyapp.com/onboarding/welcome?token=abc123';

describe('AccessApprovedEmail', () => {
  it('renders to HTML containing the CTA invite URL', () => {
    const html = renderToStaticMarkup(
      <AccessApprovedEmail inviteUrl={INVITE_URL} firstName="Eliot" expiresInDays={7} />,
    );
    expect(html).toContain(INVITE_URL);
    // The CTA button label.
    expect(html).toContain('Créer mon compte');
  });

  it('renders the warm premium heading', () => {
    const html = renderToStaticMarkup(
      <AccessApprovedEmail inviteUrl={INVITE_URL} firstName="Eliot" expiresInDays={7} />,
    );
    expect(html).toContain('Ta demande est acceptée');
    expect(html).toContain('bienvenue dans Fxmily');
  });

  it('greets by first name when provided and shows the expiry note', () => {
    const html = renderToStaticMarkup(
      <AccessApprovedEmail inviteUrl={INVITE_URL} firstName="Eliot" expiresInDays={7} />,
    );
    expect(html).toContain('Eliot');
    expect(html).toContain('7 jours');
  });

  it('renders without a name gracefully (no "undefined" leak)', () => {
    const html = renderToStaticMarkup(
      <AccessApprovedEmail inviteUrl={INVITE_URL} firstName={null} expiresInDays={1} />,
    );
    expect(html).not.toContain('undefined');
    // Singular day form.
    expect(html).toContain('1 jour');
    expect(html).not.toContain('1 jours');
  });

  it('exports PreviewProps for the react-email preview tooling', () => {
    expect(AccessApprovedEmail.PreviewProps).toMatchObject({
      inviteUrl: expect.any(String),
      expiresInDays: 7,
    });
  });
});
