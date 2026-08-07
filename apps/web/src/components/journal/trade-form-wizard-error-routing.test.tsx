// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Durcissement post-J10 — le routage d'erreur du wizard d'ouverture, piloté sur
 * le VRAI composant.
 *
 * ## Le défaut, trouvé par une chasse adverse APRÈS le merge
 *
 * Le J10 avait ajouté un routage : quand le serveur refuse un champ, ramener le
 * membre à l'étape qui le porte. Il balayait `WIZARD_STEPS`… qui compte **7**
 * entrées alors que ce wizard n'en rend que **6**. La 7ᵉ décrit le groupe de
 * champs du flux de CLÔTURE — et contient `notes`, que le wizard d'ouverture
 * affiche pourtant à l'étape 4 et envoie au serveur.
 *
 * Un refus sur `notes` produisait `goToStep(6)` → `STEP_ICONS[6]` vaut
 * `undefined` → le rendu de `<StepIcon />` **détruisait tout le wizard**. Le
 * correctif du J10 avait transformé une erreur invisible en crash dur, sur un
 * chemin qu'un copier-coller suffit à atteindre : `notesSchema` REJETTE les
 * caractères de largeur nulle, et le liant U+200D d'un emoji composé (👩‍💻)
 * en est un.
 *
 * ## Pourquoi ce test rend le composant réel
 *
 * Une sonde qui recopierait le balisage ne prouverait rien — c'est le scar de
 * banc de ce dépôt. Le wizard est donc monté pour de bon, avec un brouillon
 * valide en `localStorage` (le raccourci qui évite de remplir six écrans), et
 * l'action serveur est remplacée par un refus sur `notes`.
 */

vi.mock('@/app/journal/actions', () => ({
  createTradeAction: vi.fn(),
}));

// Framer Motion en pass-through : `AnimatePresence mode="wait"` garderait
// sinon le contenu de l'étape hors du DOM pendant l'animation de sortie.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionStub = new Proxy(
    {},
    {
      get: (_t, key) => {
        const tag = typeof key === 'string' ? key : 'div';
        // eslint-disable-next-line react/display-name
        return React.forwardRef(
          (
            props: Record<string, unknown> & { children?: React.ReactNode },
            ref: React.Ref<HTMLElement>,
          ) => {
            const {
              initial: _i,
              animate: _a,
              exit: _e,
              transition: _t2,
              variants: _v,
              whileHover: _wh,
              whileTap: _wt,
              whileInView: _wiv,
              layout: _l,
              ...rest
            } = props;
            return React.createElement(tag, { ref, ...rest });
          },
        );
      },
    },
  );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: motionStub,
    m: motionStub,
    useReducedMotion: () => true,
  };
});

import { createTradeAction } from '@/app/journal/actions';

import { TradeFormWizard } from './trade-form-wizard';

const DRAFT_KEY = 'fxmily:journal:draft:v1';

/** Brouillon complet et VALIDE — seul le verdict serveur doit décider. */
function seedValidDraft(): void {
  const inOneMinute = new Date(Date.now() + 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const wall =
    `${inOneMinute.getFullYear()}-${pad(inOneMinute.getMonth() + 1)}-${pad(inOneMinute.getDate())}` +
    `T${pad(inOneMinute.getHours())}:${pad(inOneMinute.getMinutes())}`;

  window.localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      pair: 'EURUSD',
      direction: 'long',
      session: 'london',
      enteredAt: wall,
      entryPrice: '1.1000',
      lotSize: '0.10',
      stopLossPrice: '1.0950',
      riskPct: '1',
      plannedRR: 2,
      tradeQuality: 'A',
      emotionBefore: ['calm'],
      planRespected: true,
      hedgeRespected: 'na',
      notes: 'contexte du setup',
      tradingViewEntryUrl: 'https://www.tradingview.com/chart/abc123/',
      tradingViewEntryNote: '',
    }),
  );
}

/** Avance jusqu'au dernier écran, puis soumet. */
async function walkToSubmit(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const next = screen.getByRole('button', { name: /suivant/i });
    await act(async () => {
      fireEvent.click(next);
    });
  }
  const save = screen.getByRole('button', { name: /sauvegarder le trade/i });
  await act(async () => {
    fireEvent.click(save);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.resetAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('refus serveur sur un champ d’une étape antérieure', () => {
  /**
   * LE test que le premier jet aurait échoué : il plantait au lieu de router.
   */
  it('survit à un refus sur `notes` et ramène le membre à l’écran qui le porte', async () => {
    vi.mocked(createTradeAction).mockResolvedValue({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { notes: 'Caractères de contrôle interdits.' },
    } as never);

    seedValidDraft();
    render(<TradeFormWizard timezone="Europe/Paris" />);
    await walkToSubmit();

    // 1. Le wizard est VIVANT. Avant le correctif, l'arbre entier était démonté
    //    ici (« Element type is invalid … got: undefined »).
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    // 2. Le membre est ramené sur l'écran qui porte `notes` (étape 4 → « 5 sur 6 »).
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Étape 5 sur 6');

    // 3. Et il VOIT ce qui bloque, sur le champ concerné.
    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('aria-invalid', 'true');
    // `getAllByRole` : la bannière générique du formulaire porte aussi
    // `role="alert"`. C'est le message ATTACHÉ AU CHAMP qu'on exige ici.
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent);
    expect(alerts).toContain('Caractères de contrôle interdits.');
    // Et la bannière doit orienter, pas dérouter.
    expect(alerts).toContain('Certains champs sont invalides, contrôle les étapes.');
  });

  it('route aussi sur un champ de la première étape (contrôle positif)', async () => {
    vi.mocked(createTradeAction).mockResolvedValue({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { enteredAt: 'Date dans le futur.' },
    } as never);

    seedValidDraft();
    render(<TradeFormWizard timezone="Europe/Paris" />);
    await walkToSubmit();

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Étape 1 sur 6');
    expect(screen.getByText('Date dans le futur.')).toBeInTheDocument();
  });

  it('reste sur place, sans planter, si le champ refusé n’a aucun écran', async () => {
    // Un champ qu'aucune étape ne porte (contrat serveur élargi un jour sans
    // écran correspondant) ne doit ni router au hasard ni casser le rendu.
    vi.mocked(createTradeAction).mockResolvedValue({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { champInconnu: 'Valeur refusée.' },
    } as never);

    seedValidDraft();
    render(<TradeFormWizard timezone="Europe/Paris" />);
    await walkToSubmit();

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Étape 6 sur 6');
  });

  it('ne route PAS vers l’entrée de clôture, que ce wizard ne rend pas', async () => {
    // LE cas que la borne existe pour couvrir, et le seul qui la sollicite.
    //
    // Une revue adverse a mesuré que les trois cas précédents la laissaient
    // inerte : `findIndex` rencontre toujours un champ d'une étape rendue avant
    // d'atteindre l'entrée 6, ou n'en trouve aucun. Retirer la borne les
    // laissait tous les trois verts — elle était présentée comme testée sans
    // l'être. C'est exactement la forme de défaut que ce fichier documente.
    //
    // `exitedAt` n'appartient QU'À l'entrée 6 (le groupe du flux de clôture,
    // qu'aucun panneau d'ouverture n'affiche). Sans la borne, le wizard
    // naviguerait vers l'index 6, `STEP_ICONS[6]` vaudrait `undefined`, et le
    // rendu de `<StepIcon />` démonterait le composant entier.
    vi.mocked(createTradeAction).mockResolvedValue({
      ok: false,
      error: 'invalid_input',
      fieldErrors: { exitedAt: 'Date dans le futur.' },
    } as never);

    seedValidDraft();
    render(<TradeFormWizard timezone="Europe/Paris" />);
    await walkToSubmit();

    // Le wizard tient debout — s'il était démonté, ce `progressbar` n'existerait
    // plus et l'assertion suivante lèverait avant même de comparer.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Étape 6 sur 6');
    // Et le membre n'est pas laissé sans rien : la bannière nomme le refus.
    expect(screen.getAllByRole('alert').some((el) => /invalides/i.test(el.textContent ?? ''))).toBe(
      true,
    );
  });
});
