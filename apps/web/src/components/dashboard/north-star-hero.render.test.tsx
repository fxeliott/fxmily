// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GuidanceAction } from '@/lib/daily-guidance/service';

import { NorthStarHero } from './north-star-hero';

afterEach(cleanup);

/**
 * S25 #1 — render proof of the hero's "fil conducteur contextuel à l'heure".
 *
 * The PAGE derives `sessionFocus` from the live Paris clock (12h–20h ⇒ the method
 * moment owns the hero, the admin task is demoted to a quiet secondary line). That
 * clock-driven branch can't be forced in a full-page e2e without touching prod
 * code, so this proves the POPULATED branch deterministically at render time:
 * given a trading-phase `sessionFocus`, the hero shows the calm process focal +
 * the demoted secondary action; given `null`, it falls back to the next-action CTA
 * unchanged. Posture §2 : the focal copy is process/discipline, never a market call.
 */

const ADMIN_ACTION: GuidanceAction = {
  key: 'checkin-evening',
  kind: 'checkin',
  title: 'Check-in du soir',
  detail: 'Referme ta journée en conscience.',
  href: '/checkin/evening',
  state: 'todo',
  emphasis: 'primary',
};

const BASE_PROPS = {
  greeting: 'Bonjour',
  firstName: 'Alex',
  dateLabel: 'Mercredi 24 juin 2026',
  score: null,
  history: [],
  streak: { current: 4, todayFilled: true, justCrossed: null },
  dayProgress: null,
};

describe('NorthStarHero — fil conducteur contextuel (S25 #1, posture §2)', () => {
  it('en séance vivante, le focal devient le MOMENT de méthode et démote l’action admin', () => {
    render(
      <NorthStarHero
        {...BASE_PROPS}
        primaryAction={ADMIN_ACTION}
        allDone={false}
        sessionFocus={{
          headline: 'Gestion de position',
          line: 'Tes trades sont posés — tu gères, tu ne re-rentres pas. Coupure à 20h.',
          phase: 'management',
        }}
      />,
    );

    const focal = document.querySelector('[data-slot="hero-session-focus"]');
    expect(focal).not.toBeNull();
    expect(focal?.getAttribute('data-phase')).toBe('management');
    // The live trading moment owns the eyebrow, not the admin "Prochaine étape".
    expect(screen.getByText('En ce moment')).toBeInTheDocument();
    expect(screen.queryByText('Prochaine étape')).not.toBeInTheDocument();
    // The method headline + line are surfaced.
    expect(focal?.textContent ?? '').toMatch(/Gestion de position/);
    expect(focal?.textContent ?? '').toMatch(/Coupure à 20h/);
    // The admin task is NOT lost — demoted to the quiet secondary line.
    const secondary = document.querySelector('[data-slot="hero-secondary-action"]');
    expect(secondary).not.toBeNull();
    expect(secondary?.textContent ?? '').toMatch(/Aussi à faire/);
    expect(secondary?.textContent ?? '').toMatch(/Check-in du soir/);
    // …and it does NOT also render as the big primary CTA (no double-render).
    expect(document.querySelector('[data-slot="hero-next-action"]')).toBeNull();
    // POSTURE §2 — the focal is process, never a market call.
    expect(focal?.textContent ?? '').not.toMatch(/ach[èe]te|vends?|achat|vente/i);
  });

  it('hors séance, le hero garde l’action admin en CTA principal (comportement inchangé)', () => {
    render(
      <NorthStarHero
        {...BASE_PROPS}
        primaryAction={ADMIN_ACTION}
        allDone={false}
        sessionFocus={null}
      />,
    );

    // Off-hours → the admin next-action is the focal CTA, eyebrow "Prochaine étape".
    expect(document.querySelector('[data-slot="hero-next-action"]')).not.toBeNull();
    expect(screen.getByText('Prochaine étape')).toBeInTheDocument();
    // No session focal, no demoted secondary line.
    expect(document.querySelector('[data-slot="hero-session-focus"]')).toBeNull();
    expect(document.querySelector('[data-slot="hero-secondary-action"]')).toBeNull();
  });

  it('hors séance et tout fait, affiche l’état « à jour » calme (pas de pression)', () => {
    render(<NorthStarHero {...BASE_PROPS} primaryAction={null} allDone sessionFocus={null} />);

    expect(screen.getByText('Tu es à jour')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="hero-session-focus"]')).toBeNull();
    expect(document.querySelector('[data-slot="hero-next-action"]')).toBeNull();
  });

  it('promu au hero, un rattrapage « missed » garde l’affordance AMBRE (jamais bleu ni rouge)', () => {
    // S6 §32-2 — quand rien n'est `todo` mais qu'un geste a glissé, le `missed`
    // devient le focal. Il doit lire « à rattraper » en ambre calme, pas une
    // nouvelle tâche bleue, et surtout PAS « tu es à jour » (sinon le hero
    // mentirait sur un rattrapage encore possible).
    const MISSED_CATCHUP: GuidanceAction = {
      key: 'checkin-morning',
      kind: 'checkin',
      title: 'Check-in du matin',
      detail: 'Pas encore fait ce matin — tu peux le rattraper tranquillement.',
      href: '/checkin/morning',
      state: 'missed',
      emphasis: 'secondary',
    };
    render(
      <NorthStarHero
        {...BASE_PROPS}
        primaryAction={MISSED_CATCHUP}
        allDone={false}
        sessionFocus={null}
      />,
    );

    const focal = document.querySelector('[data-slot="hero-next-action"]');
    expect(focal).not.toBeNull();
    expect(focal?.getAttribute('data-state')).toBe('missed');
    // §31.2 — amber-benevolent, NEVER the blue todo (`acc-dim`) nor red (`--bad`).
    expect(focal?.className ?? '').toMatch(/warn/);
    expect(focal?.className ?? '').not.toMatch(/acc-dim/);
    expect(focal?.className ?? '').not.toMatch(/--bad/);
    expect(document.querySelector('[aria-label="à rattraper"]')).not.toBeNull();
    expect(screen.queryByText('Tu es à jour')).not.toBeInTheDocument();
  });
});
