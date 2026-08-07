// @vitest-environment jsdom
/**
 * Un refus du serveur ne doit JAMAIS laisser le membre devant un écran muet.
 *
 * ## La classe de défaut, pas le cas
 *
 * Trois wizards de la famille REFLECT/§23 partageaient la même forme :
 * le membre soumet depuis la DERNIÈRE étape, l'erreur est peinte sur l'étape
 * qui porte le champ, et rien ne l'y ramène. Aucun des trois ne rendait
 * `invalid_input` — pourtant déclaré ET renvoyé par les trois Server Actions.
 * Résultat observable : le bouton s'active, l'écran ne bouge pas, aucun texte
 * n'apparaît. Le membre réappuie indéfiniment et perd son travail.
 *
 * C'est le jumeau du défaut fermé en J10 sur le wizard de journal. Le canon du
 * projet — « fermer un gap, puis chercher son jumeau » — a été appliqué ici, et
 * le jumeau existait bien.
 *
 * ## Pourquoi le refus est ATTEIGNABLE, et pas théorique
 *
 * Les schémas serveur refusent les caractères de largeur nulle
 * (`containsBidiOrZeroWidth`). Or le liant U+200D d'un emoji composé — 👩‍💻,
 * 👨‍👩‍👧 — en est un, et les validations d'étape côté client ne regardent QUE
 * la longueur du texte. Un membre qui colle un emoji depuis son téléphone
 * franchit donc toutes les portes locales et se fait refuser par le serveur.
 *
 * ## Ce que ce fichier teste, et ce qu'il ne teste pas
 *
 * Il monte les VRAIS composants et pilote la VRAIE Server Action (simulée au
 * seul niveau de sa réponse). Il ne vérifie pas la mécanique interne du
 * routage : il vérifie ce que le membre voit. Un test qui affirmerait
 * « `setStep` a été appelé » resterait vert le jour où l'écran cesserait de
 * suivre.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Réponses pilotées par chaque test. `vi.hoisted` est nécessaire : `vi.mock`
 * est remonté au-dessus des imports, donc une `const` ordinaire serait encore
 * dans sa zone morte temporelle au moment où la fabrique s'exécute.
 */
const served = vi.hoisted(() => ({
  reflect: null as unknown,
  review: null as unknown,
  debrief: null as unknown,
}));

vi.mock('@/app/reflect/actions', () => ({
  createReflectionEntryAction: vi.fn(async () => served.reflect),
}));
vi.mock('@/app/review/actions', () => ({
  submitWeeklyReviewAction: vi.fn(async () => served.review),
}));
vi.mock('@/app/training/debrief/actions', () => ({
  submitTrainingDebriefAction: vi.fn(async () => served.debrief),
}));

// Framer Motion en pass-through : `AnimatePresence mode="wait"` retient la
// sortie de l'ancienne étape et la nouvelle n'est jamais montée dans RTL.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionStub = new Proxy(
    {},
    {
      get: (_target, key) => {
        const tag = typeof key === 'string' ? key : 'div';
        // eslint-disable-next-line react/display-name
        return React.forwardRef(
          (
            props: Record<string, unknown> & { children?: React.ReactNode },
            ref: React.Ref<HTMLElement>,
          ) => {
            const {
              initial: _initial,
              animate: _animate,
              exit: _exit,
              transition: _transition,
              variants: _variants,
              whileHover: _wh,
              whileTap: _wt,
              whileInView: _wiv,
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

import { ReflectionWizard } from './reflect/reflection-wizard';
import { WeeklyReviewWizard } from './review/weekly-review-wizard';
import { TrainingDebriefWizard } from './training-debrief/training-debrief-wizard';

const TODAY = '2026-08-07';
const WEEK_START = '2026-08-03';

/** Assez long pour franchir tous les minimums de longueur des trois wizards. */
const LONG = (label: string) =>
  `${label} — un texte de process assez long pour satisfaire la longueur minimale exigée par la validation d'étape.`;

const REFUSAL = 'Caractères de contrôle interdits.';

/** Avance de `n` étapes en cliquant sur « Suivant ». */
function next(times: number): void {
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: /Suivant/ }));
  }
}

async function submitAndSettle(name: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
  // `useActionState` résout l'action puis planifie un rendu : sans cette
  // attente on lit l'écran d'avant la réponse.
  await waitFor(() => {
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  served.reflect = null;
  served.review = null;
  served.debrief = null;
});

vi.setConfig({ testTimeout: 20000 });

// =============================================================================
// Réflexion ABCD — le cas le plus grave des trois
// =============================================================================

describe('ReflectionWizard — un refus serveur ramène le membre là où il peut agir', () => {
  beforeEach(() => {
    // Brouillon valide : le wizard démarre rempli, on peut donc atteindre la
    // dernière étape sans piloter quatre zones de texte.
    window.localStorage.setItem(
      'fxmily:reflection:draft:v1',
      JSON.stringify({
        date: TODAY,
        triggerEvent: LONG('A'),
        beliefAuto: LONG('B'),
        consequence: LONG('C'),
        disputation: LONG('D'),
      }),
    );
  });

  it('renvoie sur l’étape B quand le serveur refuse `beliefAuto`, et affiche la cause', async () => {
    served.reflect = {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { beliefAuto: REFUSAL },
    };

    render(<ReflectionWizard today={TODAY} />);
    next(3); // A → B → C → D
    expect(screen.getByRole('heading', { name: /reframe/i })).toBeInTheDocument();

    await submitAndSettle(/Enregistrer cette réflexion/);

    // Le membre est ramené sur l'étape qui porte le champ refusé…
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /pensée automatique/i })).toBeInTheDocument();
    });
    // …et la cause est écrite à l'écran, deux fois : en tête de formulaire et
    // sous le champ lui-même.
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
    expect(alerts.some((t) => t.includes(REFUSAL))).toBe(true);
    expect(alerts.some((t) => /ramené/i.test(t))).toBe(true);
  });

  it('affiche un message actionnable quand c’est la DATE qui est refusée', async () => {
    // Cas résiduel : la date est désormais dérivée serveur, mais si elle était
    // refusée quand même, aucun champ ne l'affiche — l'alerte est la seule
    // chose qui puisse dire au membre ce qui se passe.
    served.reflect = {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { date: 'Date dans le futur.' },
    };

    render(<ReflectionWizard today={TODAY} />);
    next(3);
    await submitAndSettle(/Enregistrer cette réflexion/);

    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
    expect(alerts.some((t) => t.includes('Date dans le futur.'))).toBe(true);
    expect(alerts.some((t) => /appareil/i.test(t))).toBe(true);
  });

  it('n’emprisonne pas le membre sur l’étape fautive', async () => {
    served.reflect = {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { triggerEvent: REFUSAL },
    };

    render(<ReflectionWizard today={TODAY} />);
    next(3);
    await submitAndSettle(/Enregistrer cette réflexion/);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /événement déclencheur/i })).toBeInTheDocument();
    });

    // Il repart en avant : si le routage se rejouait à chaque rendu, ce clic
    // serait immédiatement annulé et le membre resterait bloqué.
    next(1);
    expect(screen.getByRole('heading', { name: /pensée automatique/i })).toBeInTheDocument();
  });
});

// =============================================================================
// Revue hebdomadaire
// =============================================================================

describe('WeeklyReviewWizard — un refus serveur ne laisse plus l’écran muet', () => {
  it('renvoie sur l’étape « plus grande victoire » et nomme la cause', async () => {
    served.review = {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { biggestWin: REFUSAL },
    };

    render(
      <WeeklyReviewWizard
        weekStart={WEEK_START}
        prefill={{
          biggestWin: LONG('victoire'),
          biggestMistake: LONG('piège'),
          bestPractice: LONG('pratique'),
          lessonLearned: LONG('leçon'),
          nextWeekFocus: LONG('focus'),
        }}
      />,
    );
    next(4); // intro → victoire → piège → pratique → leçon+focus
    await submitAndSettle(/Enregistrer ma revue|Enregistrer/);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /victoire/i })).toBeInTheDocument();
    });
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
    expect(alerts.some((t) => t.includes(REFUSAL))).toBe(true);
  });
});

// =============================================================================
// Débrief d'entraînement
// =============================================================================

describe('TrainingDebriefWizard — un refus serveur ne laisse plus l’écran muet', () => {
  it('renvoie sur l’étape « première force » et nomme la cause', async () => {
    served.debrief = {
      ok: false,
      error: 'invalid_input',
      fieldErrors: { processStrengthOne: REFUSAL },
    };

    render(
      <TrainingDebriefWizard
        weekStart={WEEK_START}
        prefill={{
          processStrengthOne: LONG('force 1'),
          processStrengthTwo: LONG('force 2'),
          microAdjustment: LONG('ajustement'),
          transversalLesson: LONG('leçon'),
        }}
      />,
    );
    next(3);
    await submitAndSettle(/Enregistrer/);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /première force/i })).toBeInTheDocument();
    });
    const alerts = screen.getAllByRole('alert').map((el) => el.textContent ?? '');
    expect(alerts.some((t) => t.includes(REFUSAL))).toBe(true);
  });
});
