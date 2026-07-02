import { describe, expect, it } from 'vitest';

import { classifyPriorityAxes, type PriorityAxisHints } from './priority-axis';

/**
 * S5 §32-C — le moteur doit exploiter le profil S2 (axes prioritaires d'onboarding,
 * texte libre). Ce seam mappe ce texte vers l'enum mental, en PRÉCISION (mieux vaut
 * ne pas mapper qu'avec une erreur). On vérifie le mapping, la robustesse aux
 * accents, le tie-break, la déduplication et l'abandon des libellés ambigus.
 */
describe('classifyPriorityAxes — pont profil S2 → axe mental (§32-C)', () => {
  it('mappe les mots-clés à forte confiance vers le bon axe', () => {
    expect(classifyPriorityAxes(['Être honnête avec mes résultats'])).toEqual(['honesty']);
    expect(classifyPriorityAxes(['Tenir mon plan'])).toEqual(['discipline']);
    expect(classifyPriorityAxes(['Plus de régularité dans mon suivi'])).toEqual(['consistency']);
    expect(classifyPriorityAxes(['Réduire le FOMO'])).toEqual(['ego']);
  });

  it('est insensible aux accents et à la casse', () => {
    expect(classifyPriorityAxes(['HONNÊTETÉ RADICALE'])).toEqual(['honesty']);
    expect(classifyPriorityAxes(['Régularité'])).toEqual(['consistency']);
  });

  it('tie-break : l’axe le plus grave gagne quand un libellé touche plusieurs groupes', () => {
    // « honnête » (honesty) ET « discipliné » (discipline) → honesty prime (1er groupe).
    expect(classifyPriorityAxes(['Être honnête et discipliné'])).toEqual(['honesty']);
  });

  it('déduplique en conservant l’ordre de première apparition', () => {
    expect(classifyPriorityAxes(['Tenir mon plan', 'Suivre mon plan avec rigueur'])).toEqual([
      'discipline',
    ]);
    expect(classifyPriorityAxes(['Routine quotidienne', 'Honnêteté'])).toEqual([
      'consistency',
      'honesty',
    ]);
  });

  it('abandonne les libellés ambigus / non reconnus (0 fabrication)', () => {
    expect(classifyPriorityAxes(['Gagner plus', 'Trader le réel'])).toEqual([]);
    expect(classifyPriorityAxes([])).toEqual([]);
  });

  it('combine plusieurs axes distincts d’une liste réelle', () => {
    expect(
      classifyPriorityAxes(['Tenir mon plan', 'Plus de sincérité', 'Garder mon sang-froid (ego)']),
    ).toEqual(['discipline', 'honesty', 'ego']);
  });
});

/**
 * S5 re-challenge #3 — ANTI-COLLISION du stem « regle » (défaut TROUVÉ DANS mon
 * propre correctif MAJ-93). Le groupe `discipline` ancre désormais ' regle' (avec une
 * espace de tête) au lieu du stem nu 'regle' : le préfixe « dé- » colle « de » + « regle »
 * SANS espace, donc 'déréglé' / 'dérèglement' (axes SOMMEIL/mode-de-vie, brief §130/§262,
 * DISTINCTS de discipline-process) ne doivent PLUS être classés `discipline`. Un faux
 * positif ici surfaçait une trace d'alignement MENSONGÈRE (« en lien avec une priorité
 * que tu t'es fixée ») → violation §0/honnêteté. On verrouille les DEUX directions :
 * les vraies « règles » restent capturées, les « déréglé » ne le sont jamais.
 */
describe('classifyPriorityAxes — anti-collision « regle » / « déréglé » (re-challenge #3)', () => {
  it('NE classe PAS un axe sommeil/lifestyle « déréglé » comme discipline (0 fausse trace)', () => {
    expect(classifyPriorityAxes(['Stabiliser mon sommeil complètement déréglé'])).toEqual([]);
    expect(classifyPriorityAxes(['Reprendre un rythme de vie, là tout est dérèglement'])).toEqual(
      [],
    );
    // Variante sans accent (le fold neutralise déjà les diacritiques) → même garde.
    expect(classifyPriorityAxes(['mon sommeil est deregle'])).toEqual([]);
  });

  it('capture TOUJOURS les vraies « règles » de discipline (le rappel n’est pas cassé)', () => {
    expect(classifyPriorityAxes(['Tenir mes règles strictes'])).toEqual(['discipline']);
    expect(classifyPriorityAxes(['Respecter mes règles de gestion du risque'])).toEqual([
      'discipline',
    ]);
    expect(classifyPriorityAxes(['Suivre une règle simple avant chaque entrée'])).toEqual([
      'discipline',
    ]);
  });

  it('un axe sommeil « déréglé » SEUL ne fabrique pas discipline (seul l’axe légitime ressort)', () => {
    // Si une autre dimension légitime co-existe, elle seule doit ressortir — pas discipline.
    expect(classifyPriorityAxes(['Mon sommeil déréglé', 'Plus de régularité'])).toEqual([
      'consistency',
    ]);
  });
});

/**
 * S5 §32-C / §33#3 — ANTI-INERTIE (régression du 2e re-challenge). Le brief exige
 * que le moteur exploite le profil S2 « vérifié sur données RÉALISTES ». Or les VRAIS
 * `axes_prioritaires` produits par le pipeline d'onboarding ne sont PAS des mots-clés
 * courts : le prompt impose des phrases ACTION-CONCRÈTE ≤200 chars référençant des
 * citations [N] et des concepts Mark Douglas (cf. onboarding-interview/prompt.ts
 * few-shot ~306/~361, claude-client.ts mock). Ces fixtures sont COPIÉES VERBATIM des
 * exemples canoniques du pipeline — si le mapping retourne [] dessus, la feature §32-C
 * est inerte en prod (et un seed de test « Tenir mon plan » fabriqué pour matcher les
 * keywords masquerait le défaut). On verrouille donc le mapping contre le VRAI format.
 */
describe('classifyPriorityAxes — VRAIS axes onboarding (anti-inertie §32-C/§33#3)', () => {
  // prompt.ts few-shot #1 — profil détachement/process (axes_prioritaires:306-310).
  const FEWSHOT_DETACHMENT = [
    "Travailler le détachement du target — la peur de 'voir le marché repartir' (cf. [8]) défait l'edge à chaque trade.",
    "Capitaliser sur l'awareness somatique existante [17] — proposer un rituel respiration 2 min avant chaque entrée.",
    "Consolider le process-focus déjà présent [26] en visualisant explicitement la 'régularité du geste' comme objectif premier.",
  ];
  // prompt.ts few-shot #2 — profil ego-public/randomness (axes_prioritaires:361-365).
  const FEWSHOT_EGO_PUBLIC = [
    'Travailler les 5 vérités Mark Douglas (#1 anything can happen + #3 random distribution) — la dissonance intellectuel/pratique [4] est le point de levier #1.',
    'Proposer un backtest chiffré du setup A+ pour ancrer la confidence sur de la data réelle plutôt que ressenti [14].',
    "Détacher l'identité-trader de l'identité-publique — exploration explicite du trigger [23] en session coaching.",
  ];
  // batch.test.ts / safety.test.ts — profil consistance/routines (axes_prioritaires:105-109).
  const FEWSHOT_CONSISTENCY = [
    'Travailler la consistance du plan personnel',
    'Capitaliser sur les routines déjà solides',
    'Approfondir la self-awareness somatique',
  ];

  it('mappe un profil few-shot « détachement » NON vide, axe ego capturé', () => {
    const axes = classifyPriorityAxes(FEWSHOT_DETACHMENT);
    expect(axes.length).toBeGreaterThan(0);
    expect(axes).toContain('ego'); // détachement du target / de la peur = cœur ego-Douglas
  });

  it('mappe un profil few-shot « ego-public / randomness » NON vide (ne retourne PAS [])', () => {
    // ⛔ AVANT le fix vocabulaire : ce profil entier retournait [] → feature inerte.
    const axes = classifyPriorityAxes(FEWSHOT_EGO_PUBLIC);
    expect(axes.length).toBeGreaterThan(0);
    expect(axes).toContain('ego'); // « détacher l'identité-trader » = ego
  });

  it('mappe un profil few-shot « consistance / routines » NON vide, axe consistency capturé', () => {
    const axes = classifyPriorityAxes(FEWSHOT_CONSISTENCY);
    expect(axes.length).toBeGreaterThan(0);
    expect(axes).toContain('consistency');
  });

  it('chaque axe action-concrète réel mappe vers ≥1 axe mental (0 axe réel inerte)', () => {
    for (const axis of [...FEWSHOT_DETACHMENT, ...FEWSHOT_EGO_PUBLIC, ...FEWSHOT_CONSISTENCY]) {
      expect(
        classifyPriorityAxes([axis]).length,
        `axe onboarding réel non mappé (inerte) : « ${axis} »`,
      ).toBeGreaterThan(0);
    }
  });

  it('verrouille le seed e2e runtime : discipline + ego (sync avec s5-…-runtime.spec.ts)', () => {
    // Ces deux chaînes BRUTES sont le seed exact du e2e (RAW_AXIS_DISCIPLINE / _EGO) :
    // si le mapping changeait, l'e2e perdrait sa trace d'alignement. On le fige ici, au
    // niveau pur (rapide), pour ne pas dépendre d'un run Playwright pour le détecter.
    const RAW_AXIS_DISCIPLINE =
      "Renforcer la rigueur d'exécution du plan — suivre le process défini et la checklist avant d'agir plutôt que d'improviser sous l'impulsion [12].";
    const RAW_AXIS_EGO =
      "Travailler le détachement du résultat — accepter qu'un trade exécuté à la lettre reste un bon process, même perdant (5 vérités #3, cf. [9]).";
    expect(classifyPriorityAxes([RAW_AXIS_DISCIPLINE])).toEqual(['discipline']);
    expect(classifyPriorityAxes([RAW_AXIS_EGO])).toEqual(['ego']);
    // L'axe dominant de l'alerte e2e (`forgot_no_reason_repeat` → discipline) ∈ profil.
    expect(classifyPriorityAxes([RAW_AXIS_DISCIPLINE, RAW_AXIS_EGO])).toContain('discipline');
  });

  it('garde le calibrated refusal : les axes méta du mock smoke-test restent non mappés', () => {
    // claude-client.ts mock — méta-instructions techniques, PAS du contenu psy réel.
    expect(
      classifyPriorityAxes([
        'Activer ANTHROPIC_API_KEY ou le pipeline batch local Claude Max pour obtenir une analyse qualitative réelle (mock actuel).',
        "Vérifier que les 30 questions de l'entretien sont toutes exploitables avant le batch production.",
      ]),
    ).toEqual([]);
  });
});

/**
 * D5 §J-D — TIE-BREAK DÉTERMINISTE par les indices de profil profond (dimensions J-A
 * `coachingTone.register` / `learningStage.stage`). CONSERVATEUR : le paramètre
 * `hints` ne départage QU'UNE ÉGALITÉ (un même libellé touche ≥2 groupes d'axes, sans
 * autre signal que l'ordre figé de `AXIS_KEYWORDS`). Sans `hints` — ou quand aucun axe
 * préféré n'est parmi les axes réellement touchés — le comportement est STRICTEMENT
 * identique à l'historique (aucun re-classement, aucune fabrication). Enum→enum : §50
 * préservé (aucun texte brut IA), firewall §21.5 (jamais un input du score).
 */
describe('classifyPriorityAxes — tie-break profil profond §J-D (register/stage)', () => {
  // « honnête » (honesty) + « discipliné » (discipline) touchent DEUX groupes : c'est
  // l'égalité canonique que le tie-break départage. Sans hints → honesty (1er groupe).
  const AMBIGUOUS_HONESTY_DISCIPLINE = 'Être honnête et discipliné';
  // « détachement » (ego) + « process/plan » (discipline) → égalité ego vs discipline.
  const AMBIGUOUS_EGO_DISCIPLINE =
    'Travailler le détachement du résultat tout en tenant mon process et mon plan';

  it('(a) sans hints → ordre STRICTEMENT identique à l’historique (non-régression)', () => {
    // Même sortie qu'avant l'ajout du paramètre, sur un libellé ambigu et une liste.
    expect(classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE])).toEqual(['honesty']);
    expect(
      classifyPriorityAxes(['Tenir mon plan', 'Plus de sincérité', 'Garder mon sang-froid (ego)']),
    ).toEqual(['discipline', 'honesty', 'ego']);
  });

  it('(a bis) hints={} (aucun enum) → identique à l’absence de hints', () => {
    expect(classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE], {})).toEqual(['honesty']);
    expect(classifyPriorityAxes([AMBIGUOUS_EGO_DISCIPLINE], {})).toEqual(['ego']);
  });

  it('(b) register=direct départage l’égalité honesty/discipline vers discipline', () => {
    // Sans hints → 'honesty'. register 'direct' → discipline (cadre/process direct).
    expect(classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE])).toEqual(['honesty']);
    expect(classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE], { register: 'direct' })).toEqual([
      'discipline',
    ]);
  });

  it('(b) register=pedagogique laisse honesty (déjà le 1er) — pas de faux changement', () => {
    expect(
      classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE], { register: 'pedagogique' }),
    ).toEqual(['honesty']);
  });

  it('(b) stage=mechanical départage ego/discipline vers discipline', () => {
    expect(classifyPriorityAxes([AMBIGUOUS_EGO_DISCIPLINE])).toEqual(['ego']); // historique
    expect(classifyPriorityAxes([AMBIGUOUS_EGO_DISCIPLINE], { stage: 'mechanical' })).toEqual([
      'discipline',
    ]);
  });

  it('(b) stage=subjective conserve ego sur l’égalité ego/discipline', () => {
    expect(classifyPriorityAxes([AMBIGUOUS_EGO_DISCIPLINE], { stage: 'subjective' })).toEqual([
      'ego',
    ]);
  });

  it('le stade PRIME sur le registre quand les deux visent des axes différents parmi les touchés', () => {
    // stage=mechanical → discipline ; register=socratique → ego. Les deux sont parmi
    // les axes touchés (ego + discipline) → le stade gagne (canon D4).
    expect(
      classifyPriorityAxes([AMBIGUOUS_EGO_DISCIPLINE], {
        stage: 'mechanical',
        register: 'socratique',
      }),
    ).toEqual(['discipline']);
  });

  it('n’agit JAMAIS sur un libellé mono-axe (pas d’égalité → hints ignorés)', () => {
    // « Tenir mon plan » ne touche QUE discipline : aucun hint ne peut le déplacer.
    expect(classifyPriorityAxes(['Tenir mon plan'], { stage: 'subjective' })).toEqual([
      'discipline',
    ]);
    expect(
      classifyPriorityAxes(['Être honnête avec mes résultats'], { register: 'direct' }),
    ).toEqual(['honesty']);
  });

  it('un axe préféré ABSENT des axes touchés ne fabrique rien → ordre historique', () => {
    // honesty/discipline touchés ; stage=intuitive → consistency (NON touché) → aucun
    // effet, on retombe sur l'ordre de gravité curé (honesty).
    expect(classifyPriorityAxes([AMBIGUOUS_HONESTY_DISCIPLINE], { stage: 'intuitive' })).toEqual([
      'honesty',
    ]);
  });

  it('ne fabrique JAMAIS un axe quand rien ne mappe, hints présents ou pas', () => {
    const hints: PriorityAxisHints = { register: 'direct', stage: 'mechanical' };
    expect(classifyPriorityAxes(['Gagner plus', 'Trader le réel'], hints)).toEqual([]);
    expect(classifyPriorityAxes([], hints)).toEqual([]);
  });

  it('exhaustif : chaque (sans hints) == avec hints tant qu’aucune égalité n’existe', () => {
    // Sur des libellés mono-axe, TOUTES les combinaisons d'enums laissent l'ordre intact.
    const monoAxis = ['Tenir mon plan', 'Plus de régularité', 'Réduire le FOMO', 'Sincérité'];
    const baseline = classifyPriorityAxes(monoAxis);
    const registers = ['direct', 'pedagogique', 'socratique'] as const;
    const stages = ['mechanical', 'subjective', 'intuitive'] as const;
    for (const register of registers) {
      for (const stage of stages) {
        expect(classifyPriorityAxes(monoAxis, { register, stage })).toEqual(baseline);
      }
    }
  });
});
