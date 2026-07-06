import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AdminDailyBriefEmail } from './admin-daily-brief';

/**
 * Tour 15 — render test for the daily ADMIN brief email.
 *
 * React Email components are plain React, so `renderToStaticMarkup` produces the
 * HTML without `@react-email/render`. We pin: it renders, the CTA points at the
 * triage queue, the counts show, an all-calm day flips to the calm copy, and no
 * "undefined"/"NaN" leaks. PII-free by construction — the template only takes
 * numbers + URLs, never a member identity.
 */

const TRIAGE_URL = 'https://app.fxmilyapp.com/admin/a-traiter';
const ADMIN_URL = 'https://app.fxmilyapp.com/admin';

const BUSY_PROPS = {
  dateLabel: 'lundi 6 juillet',
  uncommentedClosed: 4,
  staleOpen: 1,
  openDiscrepancies: 2,
  behavioralSignals: 3,
  triageTotal: 10,
  newSignalMembers: 2,
  disengagedMembers: 1,
  triageUrl: TRIAGE_URL,
  adminUrl: ADMIN_URL,
} as const;

describe('AdminDailyBriefEmail', () => {
  it('renders the busy-day brief with the CTA + counts', () => {
    const html = renderToStaticMarkup(<AdminDailyBriefEmail {...BUSY_PROPS} />);
    expect(html).toContain(TRIAGE_URL);
    expect(html).toContain('Ouvrir la file de travail');
    expect(html).toContain('Ton point du matin');
    // Counts surface in the body.
    expect(html).toContain('4 trade');
    expect(html).toContain('10 élément');
    expect(html).toContain('2 membre'); // new signal members
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('flips to the calm copy when nothing needs attention', () => {
    const html = renderToStaticMarkup(
      <AdminDailyBriefEmail
        {...BUSY_PROPS}
        uncommentedClosed={0}
        staleOpen={0}
        openDiscrepancies={0}
        behavioralSignals={0}
        triageTotal={0}
        newSignalMembers={0}
        disengagedMembers={0}
      />,
    );
    expect(html).toContain('Rien ne réclame ton attention');
    // The busy-day stat cards must NOT render on a calm day.
    expect(html).not.toContain('FILE DE TRAVAIL');
  });

  it('is PII-free: renders from numbers + URLs only, no member identity', () => {
    const html = renderToStaticMarkup(<AdminDailyBriefEmail {...BUSY_PROPS} />);
    // Only the admin URLs appear as links — no member fiche id in the body.
    expect(html).toContain(ADMIN_URL);
    expect(html).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i); // no email address leak
  });

  it('exports PreviewProps for the react-email preview tooling', () => {
    expect(AdminDailyBriefEmail.PreviewProps).toMatchObject({
      triageUrl: expect.any(String),
      triageTotal: expect.any(Number),
    });
  });
});
