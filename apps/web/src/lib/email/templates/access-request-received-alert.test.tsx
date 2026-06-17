import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccessRequestReceivedAlertEmail } from './access-request-received-alert';

/**
 * §26.2 — Render test for the ADMIN "nouvelle demande d'accès" notification.
 *
 * Pins: it renders, the CTA points at the admin queue, the pending count shows
 * (singular/plural), and — by construction — NO requester PII can appear (the
 * props only carry a count + the admin URL, never a name/email).
 */
const ADMIN_URL = 'https://app.fxmilyapp.com/admin/access-requests';

describe('AccessRequestReceivedAlertEmail', () => {
  it('renders with the CTA pointing at the admin access-request queue', () => {
    const html = renderToStaticMarkup(
      <AccessRequestReceivedAlertEmail pendingCount={3} adminUrl={ADMIN_URL} />,
    );
    expect(html).toContain(ADMIN_URL);
    expect(html).toContain('Voir les demandes');
  });

  it('shows the pending count (plural)', () => {
    const html = renderToStaticMarkup(
      <AccessRequestReceivedAlertEmail pendingCount={3} adminUrl={ADMIN_URL} />,
    );
    expect(html).toContain('3 demandes');
    expect(html).toContain('sont en attente');
  });

  it('shows the pending count (singular)', () => {
    const html = renderToStaticMarkup(
      <AccessRequestReceivedAlertEmail pendingCount={1} adminUrl={ADMIN_URL} />,
    );
    expect(html).toContain('1 demande ');
    expect(html).toContain('est en attente');
  });

  it('carries NO requester PII (count-only by construction)', () => {
    const html = renderToStaticMarkup(
      <AccessRequestReceivedAlertEmail pendingCount={2} adminUrl={ADMIN_URL} />,
    );
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('@'); // no requester email anywhere in the body
  });

  it('exports PreviewProps for the react-email preview tooling', () => {
    expect(AccessRequestReceivedAlertEmail.PreviewProps).toMatchObject({
      pendingCount: expect.any(Number),
      adminUrl: expect.any(String),
    });
  });
});
