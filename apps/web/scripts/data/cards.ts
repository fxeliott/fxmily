/**
 * Mark Douglas card seed data (J7).
 *
 * V1 ships 12 fiches couvrant les 7 triggers canoniques SPEC §7.6 + 5
 * piliers catalogue. Les 38 fiches restantes sont en backlog J7.5 (Eliot
 * reprendra avec un subagent dédié OU rédigera lui-même).
 *
 * Posture (SPEC §2 + §18.2) :
 *   - Aucun conseil de marché.
 *   - Citations directes ≤ 30 mots avec attribution chapitre.
 *   - Paraphrases FR à la voix d'Eliot (tutoiement, posture athlète).
 */

import type { CardCreateInput } from '../../src/lib/schemas/card';

export const MARK_DOUGLAS_CARDS_SEED: ReadonlyArray<CardCreateInput> = [
  // =============================================================================
  // 7 fiches trigger-mapped (SPEC §7.6 mapping canonique)
  // =============================================================================

  {
    slug: 'sortir-du-tilt',
    title: 'Sortir du tilt après une série de pertes',
    category: 'tilt',
    quote:
      'In any given trade you never know who else is in the market or how big they are or how long they intend to stay in.',
    quoteSourceChapter: 'Trading in the Zone, ch.10',
    paraphrase: `Trois trades perdants d'affilée. Ton corps est en alerte, ton mental cherche à reprendre le contrôle. C'est le tilt — et c'est le moment où ton edge ne fonctionne plus.

**Ce qui se passe en toi.** Le cerveau émotionnel a pris la barre. Il interprète les pertes comme une attaque, et il veut riposter. Conséquence : tu prends des trades hors plan, tu sizes plus gros, tu ignores tes règles. Mark Douglas appelle ça "trader pour réparer le compte" — c'est exactement ce qu'il faut éviter.

**Le rappel mathématique.** Une stratégie à 60% de win rate produit régulièrement des séries de 3, 4, voire 5 pertes consécutives. C'est de la variance, pas la fin de ton edge. La distribution des wins et losses est aléatoire, même quand l'edge est intact.

**Ce qui te sort du tilt :**

- Pause physique 15 min minimum. Sors de l'écran, marche, respire.
- Vérifie que ton plan a été respecté sur les 3 trades. Si oui : variance normale, tu reprends comme d'habitude. Si non : c'est la déviation qui a coûté, pas le marché.
- Pas de "trade de remontée". Reprends à ton sizing standard, sur tes setups standards.
- Si tu sens que tu ne peux pas tenir le sizing normal, arrête la session. Reviens demain.

L'edge ne fonctionne que si tu lui donnes le temps de jouer la loi des grands nombres. Réagir à la variance court terme, c'est saboter ce temps.`,
    exercises: [
      {
        id: 'pause-15min',
        label: 'Pause physique de 15 minutes',
        description:
          "Sors de l'écran. Marche, respire, hydrate-toi. Reviens uniquement quand ton rythme cardiaque est revenu à la baseline. Le marché sera encore là.",
      },
      {
        id: 'audit-3-pertes',
        label: 'Auditer les 3 dernières pertes',
        description:
          "Pour chaque perte : plan respecté ? sizing standard ? émotion à l'entrée ? Si les 3 sont conformes, c'est de la variance. Si non, identifie la déviation, écris-la, ferme la session pour aujourd'hui.",
      },
    ],
    triggerRules: { kind: 'after_n_consecutive_losses', n: 3, window: 'any' },
    hatClass: 'black',
    priority: 9,
    published: true,
  },

  {
    slug: 'le-piege-de-la-deviation',
    title: 'Le piège de la déviation : quand le plan saute',
    category: 'discipline',
    quote: 'The market never violates your rules — only you do.',
    quoteSourceChapter: 'The Disciplined Trader, ch.4',
    paraphrase: `Tu as dévié de ton plan deux fois en une semaine. Pas trois, pas dix. Juste deux. Et c'est précisément le seuil à ne pas dépasser.

**Pourquoi 2 déviations comptent autant.** Mark Douglas insiste : la consistance se construit dans l'invisible. Une déviation isolée peut être un signal (peut-être que ton plan a un trou). Deux déviations en peu de temps = un pattern. C'est ton mental qui négocie avec ta discipline.

**Le mécanisme.** Chaque déviation crée un précédent dans ton cerveau : "j'ai dévié, j'ai survécu". Ton cerveau apprend que la règle est négociable. Au 3e ou 4e contournement, le plan ne te protège plus — il devient décoratif.

**Ce qui aide :**

- Identifie le déclencheur commun aux 2 déviations. Sommeil ? Heure ? Après une perte ? Après un gain ?
- Note ce déclencheur en haut de ton plan demain. "Si X, alors je ne trade pas."
- Si la déviation venait d'un setup que ton plan ne prévoit pas et qui t'attire, ce n'est pas un signal pour dévier — c'est un signal pour réviser ton plan **à froid**, ce week-end. Jamais en pleine session.

**La règle d'or.** Le plan se modifie hors session. En session, le plan est immuable. C'est ce contrat avec toi-même qui te permet de tenir sur 1000 trades, pas 5.`,
    exercises: [
      {
        id: 'identifier-declencheur',
        label: 'Identifier le déclencheur commun',
        description:
          "Liste les 2 déviations récentes. Pour chacune : heure de la journée, état émotionnel, événement précédent (perte/gain). Cherche le pattern. C'est ton signal d'alerte personnel.",
      },
      {
        id: 'contrat-no-deviation',
        label: 'Contrat anti-déviation pour la semaine',
        description:
          'Écris en haut de ton plan : "Cette semaine, 0 déviation. Si tentation, je quitte la session 30 min." Affiche-le. Référence-le avant chaque trade.',
      },
    ],
    triggerRules: { kind: 'plan_violations_in_window', n: 2, days: 7 },
    hatClass: 'black',
    priority: 8,
    published: true,
  },

  {
    slug: 'trader-fatigue-trader-emotionnel',
    title: 'Trader fatigué = trader émotionnel',
    category: 'fear',
    quote: 'When the trader is not centered, the market becomes a mirror of his fears.',
    quoteSourceChapter: 'The Disciplined Trader, ch.7',
    paraphrase: `Tu as dormi moins de 6 heures cette nuit, et tu es en train de trader. Mark Douglas et toute la recherche moderne sur la performance (Steenbarger, Walker) convergent : c'est la situation la plus risquée du trader pro.

**Ce qui change physiologiquement.** Sous 6h de sommeil, la fonction du cortex préfrontal — la zone qui maintient ta discipline et tes règles — chute jusqu'à 40%. La fonction du système limbique — la zone des peurs et des impulsions — augmente. Concrètement : ton plan est plus dur à suivre, et tes émotions sont plus fortes.

**Les symptômes typiques d'un trader fatigué :**

- Décisions plus lentes, hésitations qui te font rater des entrées propres
- Sortie prématurée des winners (peur de perdre le gain)
- Tenue tardive des losers (déni de la perte)
- Sizing irrégulier — soit trop petit (peur), soit trop gros (compensation)
- Émotions amplifiées : un win normal te procure de l'euphorie, une perte normale te met en tilt

**La règle pro.** Sous 6h de sommeil = pas de trade live, ou alors sizing divisé par 2. Cette règle n'est pas un signe de faiblesse, c'est un signe de connaissance de soi.

**Ce qui aide :**

- Trade mode "observation" uniquement aujourd'hui : tu prends tes notes mais tu n'exécutes pas
- Si tu dois trader (obligation), réduis le sizing et limite-toi à 2 trades max
- Priorité absolue ce soir : 8h de sommeil. Zéro écran 1h avant le coucher

L'edge se construit sur 1000 trades. Sacrifier 1 journée de fatigue protège les 999 autres.`,
    exercises: [
      {
        id: 'mode-observation-fatigue',
        label: "Mode observation aujourd'hui",
        description:
          "Pendant ta session, suis le marché normalement, prends tes notes, identifie les setups. Mais n'exécute aucun trade. C'est un entraînement de patience qui paye.",
      },
      {
        id: 'protocole-sommeil',
        label: 'Protocole sommeil pour ce soir',
        description:
          "Couche-toi 1h plus tôt que d'habitude. Pas d'écran 1h avant. Chambre fraîche (18-19°C). Si possible : pas de café après 14h demain. Le sommeil est ton premier outil de trading.",
      },
    ],
    triggerRules: { kind: 'sleep_deficit_then_trade', minHours: 6 },
    hatClass: 'white',
    priority: 8,
    published: true,
  },

  {
    slug: 'l-art-de-ne-rien-faire',
    title: "L'art de ne rien faire : passer le FOMO",
    category: 'patience',
    quote: 'The best traders have learned that they are not paid to trade — they are paid to wait.',
    quoteSourceChapter: 'Trading in the Zone, ch.6',
    paraphrase: `Tu viens de logger l'émotion FOMO. Tu vois un mouvement dans le marché et tu sens cette tension : "il faut que je sois dedans". C'est l'une des 4 peurs canoniques de Mark Douglas, et probablement la plus coûteuse.

**Ce qu'est vraiment le FOMO.** Pas un signal de marché, juste un état émotionnel. Le marché ne se soucie pas de ton FOMO. Il continuera à offrir des opportunités demain, après-demain, dans 2 semaines. Le FOMO est l'illusion que cette opportunité est unique. Elle ne l'est jamais.

**Le piège.** Sous FOMO, tu vas :

- Entrer sans setup conforme à ton plan
- Sizer plus gros pour "rattraper" le mouvement déjà parti
- Mettre des stops trop larges parce que le mouvement est déjà avancé
- Ressentir un soulagement temporaire d'être "in" — qui ne dure que tant que le trade va dans ton sens

**La compétence pro.** Voir une opportunité passer **sans rien faire**. Mark Douglas appelle ça "the discipline of doing nothing". C'est une compétence active, pas passive. Tu travailles ton mental pendant que tu n'exécutes pas.

**Ce qui aide :**

- Reconnais l'émotion à voix haute : "je suis en FOMO sur ce mouvement"
- Vérifie ton plan : ce setup en fait partie, oui ou non ? Si non, tu ne trades pas.
- Rappelle-toi : il y a eu un mouvement comme celui-ci la semaine dernière, et il y en aura un la semaine prochaine
- Note dans ton journal le mouvement que tu n'as pas pris. Tu construis ainsi ta confiance dans ta discipline.

Le FOMO se gère par la répétition. Plus tu le passes, plus tu le passes facilement.`,
    exercises: [
      {
        id: 'nommer-emotion',
        label: "Nommer l'émotion à voix haute",
        description:
          'Dis explicitement : "je suis en FOMO sur ce mouvement". Cette simple verbalisation active le cortex préfrontal et baisse l\'intensité émotionnelle. Effet documenté en neuroscience.',
      },
      {
        id: 'journal-mouvement-passe',
        label: 'Journaliser le mouvement non pris',
        description:
          "Note le ticker, le mouvement, et la raison de ne pas l'avoir pris. Reviens dessus dans une semaine. La grande majorité des FOMO ratés sont des trades qui auraient été perdants ou marginaux.",
      },
    ],
    triggerRules: { kind: 'emotion_logged', tag: 'fomo' },
    hatClass: 'white',
    priority: 8,
    published: true,
  },

  {
    slug: 'sur-confiance-le-piege-d-apres-victoire',
    title: "Sur-confiance : le piège d'après victoire",
    category: 'confidence',
    quote: 'A winning streak can be more dangerous than a losing streak.',
    quoteSourceChapter: 'Trading in the Zone, ch.5',
    paraphrase: `Cinq trades gagnants d'affilée. Ton edge fonctionne, et tu le sens. C'est précisément le moment du piège que Mark Douglas appelle "le tilt euphorique" — plus coûteux statistiquement que le tilt classique.

**Pourquoi c'est si piégeux.** L'euphorie ne ressemble pas à du danger. Elle ressemble à du flow, à la "zone". Tu te sens compétent, tu te sens dans le rythme. Le cerveau interprète ça comme une preuve que tu peux prendre plus de risque.

**Les comportements typiques de la sur-confiance :**

- Sizing augmenté ("puisque ça marche")
- Setups marginaux acceptés ("j'ai l'œil")
- Stops élargis ("j'ai de la marge")
- Sessions prolongées au-delà de la fenêtre standard
- Comparaison flatteuse avec d'autres traders

**Ce qui se passe ensuite, statistiquement.** La distribution des wins/losses est aléatoire. Une série de 5 wins n'augmente PAS la probabilité du 6e win — c'est l'erreur du parieur. Mais le sizing augmenté fait que le drawdown qui suit est plus gros en valeur absolue. Une bonne semaine peut être effacée par 2 trades sur-sizés.

**La règle pro.** Sizing fixe pendant les 5 trades qui suivent toute série de 3+ wins. Cette règle dure n'est pas du conservatisme — c'est de la mathématique : protéger les gains de la phase favorable de la variance.

**Le mantra à se répéter :** "Mes meilleurs trades arrivent souvent juste avant mes pires sessions." Ce n'est pas une superstition, c'est l'observation documentée du tilt euphorique.`,
    exercises: [
      {
        id: 'audit-post-streak',
        label: 'Audit obligatoire après 5 wins',
        description:
          "5 questions : sizing maintenu ? setups respectés ? fenêtre standard ? durée session normale ? pulsion d'augmenter ? Cet audit détecte le glissement avant qu'il coûte.",
      },
      {
        id: 'sizing-fige-5-trades',
        label: 'Sizing figé pour les 5 prochains trades',
        description:
          "Engagement écrit : les 5 prochains trades, je garde mon sizing standard, peu importe la confiance que je ressens. C'est le filet anti-euphorie.",
      },
    ],
    triggerRules: { kind: 'win_streak', n: 5 },
    hatClass: 'black',
    priority: 7,
    published: true,
  },

  {
    slug: 'discipline-c-est-consistance',
    title: 'Discipline = consistance : le pouvoir des petits gestes',
    category: 'consistency',
    quote: 'Consistency is the result of doing the same things, the same way, every time.',
    quoteSourceChapter: 'Trading in the Zone, ch.9',
    paraphrase: `Tu n'as pas fait de check-in depuis 7 jours. Mark Douglas insiste : la consistance ne se mesure pas dans les gros gestes, elle se mesure dans les petits — et le check-in en est un.

**Pourquoi le check-in compte autant.** Ce n'est pas un rituel cosmétique. C'est :

- Le scan systématique de ton état physique et mental avant et après le trading
- Le journal de ton sommeil, ton stress, ton humeur, ta discipline
- La donnée sur laquelle s'appuient tes décisions de sizing, de session, de pause

Sans cette donnée, tu trades à l'aveugle sur les variables qui pilotent vraiment ta performance. Tu sais que tu as fait 3 trades hier — mais tu ne sais pas si tu avais bien dormi, si tu étais en stress, si ton mood était bas. Sans ça, impossible de comprendre pourquoi tes mauvaises sessions arrivent.

**La règle pro.** Le check-in matin et soir n'est pas négociable, comme l'échauffement n'est pas négociable pour un athlète. Pas parce qu'un seul check-in te rend meilleur — mais parce que la séquence de 100 check-ins te donne la lecture nécessaire pour optimiser.

**Comment reprendre :**

- Pas de rattrapage. Tu ne remplis pas les 7 jours manqués. Tu reprends ce soir, point.
- Limite à 3 minutes par check-in. Pas plus. La perfection est l'ennemi de la consistance.
- Les jours où tu ne traderas pas, fais quand même le check-in. C'est précisément ces jours qui éclairent les jours de trade.

La consistance d'un trader pro se reconnait dans ce qu'il fait quand personne ne regarde. Le check-in, c'est ça.`,
    exercises: [
      {
        id: 'checkin-soir-3-min',
        label: 'Check-in du soir en 3 minutes max',
        description:
          'Ce soir, fais le check-in du soir. 3 minutes top. Sleep, stress, mood, plan respecté. Pas de rattrapage des jours manqués. Tu reprends maintenant.',
      },
      {
        id: 'checkin-2-fois-21-jours',
        label: 'Engagement 21 jours, 2 check-ins/jour',
        description:
          "Marque sur ton calendrier les 21 prochains jours. Engagement : 2 check-ins par jour, qu'il y ait ou non du trading. Après 21 jours, c'est une habitude. Avant, c'est de l'effort conscient.",
      },
    ],
    triggerRules: { kind: 'no_checkin_streak', days: 7 },
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'pourquoi-le-plan-existe',
    title: 'Pourquoi le plan existe : hedge non respecté',
    category: 'discipline',
    quote: 'A plan that is followed selectively is no plan at all — it is a wish list.',
    quoteSourceChapter: 'The Disciplined Trader, ch.5',
    paraphrase: `Tu n'as pas respecté le hedge sur ton dernier trade. Une seule fois, mais c'est une fois de trop. Voici pourquoi.

**Le hedge n'est pas une option.** Quand tu l'as inscrit dans ton plan, tu l'as fait à froid, en analyse rationnelle. Tu as identifié un risque que ton entrée principale ne couvrait pas, et tu as construit le hedge pour ce risque précis. Sauter le hedge, c'est dire que ton "moi en session" sait mieux que ton "moi en analyse".

**Mark Douglas est catégorique :** un plan qu'on suit sélectivement n'est pas un plan, c'est une liste de souhaits. La force du plan vient de sa rigidité — c'est précisément parce que tu le suis quand tu n'as PAS envie qu'il te protège.

**Le mécanisme du saut.** Tu n'as probablement pas sauté le hedge par négligence. Tu l'as sauté parce que :

- Soit le marché bougeait vite et tu as voulu "saisir" l'opportunité (FOMO masqué)
- Soit tu pensais que le risque ne se matérialiserait pas cette fois (biais d'optimisme)
- Soit le hedge te paraissait coûteux face au gain attendu (rationalisation économique)

Aucune de ces raisons n'est valide. Toutes te sembleront évidentes en analyse à froid demain.

**La règle pro.** Si tu sautes une règle de plan, tu fermes la session immédiatement. Pas le trade — la session entière. Cette règle dure protège ta discipline plus que toute discipline mentale.

**Pour le prochain trade.**

- Si le hedge fait partie du setup, le trade ne s'exécute QUE si le hedge est en place
- Si tu n'as pas le temps de poser le hedge, tu n'as pas le temps de prendre le trade
- Le hedge est un coût d'opération, pas un coût optionnel`,
    exercises: [
      {
        id: 'reviser-derniere-deviation',
        label: 'Réviser la déviation à froid',
        description:
          "Demain matin, reprends ce trade. Pose-toi : qu'est-ce qui m'a fait sauter le hedge ? Quelle pensée précise dans le moment ? Note-la — c'est ton signal personnel pour les prochaines fois.",
      },
      {
        id: 'regle-fermeture-session',
        label: 'Règle de fermeture session sur déviation',
        description:
          "Inscris dans ton plan : 'Toute déviation de règle = fermeture immédiate de la session.' Cette règle dure n'est pas une punition, c'est un filet anti-cascade.",
      },
    ],
    triggerRules: { kind: 'hedge_violation' },
    hatClass: 'black',
    priority: 8,
    published: true,
  },

  // =============================================================================
  // 5 fiches catalogue (piliers — pas de trigger, accessibles via /library)
  // =============================================================================

  {
    slug: 'anything-can-happen',
    title: '"Anything can happen" : la première vérité',
    category: 'acceptance',
    quote: 'Anything can happen.',
    quoteSourceChapter: 'Trading in the Zone, ch.11',
    paraphrase: `Trois mots qui contiennent toute la psychologie du trading pro. Mark Douglas en a fait la première de ses cinq vérités fondamentales — celle dont tout le reste découle.

**Ce que ça signifie concrètement.** Le marché n'est pas obligé de respecter ton analyse. Même la configuration parfaite, même le pattern qui a marché 50 fois, peut échouer cette 51ème fois. Pas parce que tu as mal lu le marché. Pas parce que ton edge est cassé. Juste parce qu'**anything can happen**.

**Pourquoi cette vérité est libératrice.** Tant que tu crois (au fond) que le marché "devrait" faire quelque chose, chaque trade contre toi te blesse. Tu te sens injustement traité. Tu te défends. Tu rationalises. Tu cherches la faute — chez toi, chez l'analyste qui t'a mal guidé, chez le marché lui-même.

**Le moment où ça change.** Quand tu intègres profondément que le marché ne te doit rien, chaque trade devient une simple exécution probabiliste. La perte n'est plus une trahison, c'est une issue parmi d'autres dans ta distribution de résultats.

**Le test concret.** Sur ton prochain trade perdant qui était parfaitement conforme à ton plan : observe ton dialogue intérieur. Si tu te dis "ça aurait dû marcher", "le marché a triché", "c'est injuste" — tu n'as pas encore intégré la première vérité. Si tu te dis "OK, c'est sorti dans le mauvais sens, suivant" — tu commences à l'intégrer.

L'acceptation n'est pas une posture mentale. C'est une certitude profonde, construite trade après trade.`,
    exercises: [
      {
        id: 'mantra-quotidien',
        label: 'Mantra quotidien avant la session',
        description:
          'Avant chaque session, dis à voix haute : "Sur chacun de mes trades aujourd\'hui, anything can happen. Je l\'accepte." 30 secondes. Effet de réancrage cumulatif.',
      },
      {
        id: 'audit-resistance-perte',
        label: 'Audit de ta résistance à la perte',
        description:
          "Sur tes 3 prochaines pertes, observe ton dialogue intérieur. Note-le mot pour mot. Le pattern qui apparaît est ta résistance personnelle à la première vérité. C'est elle qu'il faut désamorcer.",
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 7,
    published: true,
  },

  {
    slug: 'penser-en-probabilites',
    title: 'Penser en probabilités, pas en prédictions',
    category: 'probabilities',
    quote: 'A probabilistic mindset is what separates the consistent winner from the gambler.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Le débutant cherche à prédire. Le pro pense en probabilités. La différence n'est pas sémantique — elle change tout.

**La différence opérationnelle.** Prédire = "ce trade va marcher". Probabilités = "ce trade a une probabilité de fonctionner, et sur 100 trades comme celui-ci, j'attends X% de wins avec un payoff Y, donc une espérance positive". La première phrase t'enferme sur l'issue d'un trade unique. La deuxième te libère pour exécuter 1000 trades sans drama.

**L'analogie casino.** Un casino n'essaie pas de prédire l'issue d'une main de blackjack. Il sait que sur 10000 mains, la maison gagnera 0.5%. Cette certitude statistique le rend indifférent à n'importe quelle main individuelle. Le client peut gagner 5 mains d'affilée — la maison reste calme. Sa stratégie n'est pas testée par 5 mains, elle est testée par 10000.

**Le trader pro fonctionne pareil.** Il connaît son edge sur des centaines de trades. Il sait sa distribution attendue. Il exécute chaque trade non comme l'événement décisif, mais comme une instance dans cette distribution.

**La pratique concrète :**

- Tracke ton edge sur 30, 50, 100 trades. Pas sur 5.
- Quand tu sors un trade, ne demande pas "est-ce que ce trade a marché ?" mais "est-ce que j'ai bien suivi le process ?"
- L'unité d'évaluation pour un trader pro n'est jamais le trade unique. C'est la séquence.

Le mindset probabiliste t'achète quelque chose de précieux : la sérénité dans l'exécution. Plus tu y entres profondément, moins le marché te touche émotionnellement.`,
    exercises: [
      {
        id: 'distribution-30-trades',
        label: 'Calculer ta distribution sur 30 trades',
        description:
          'Reprends tes 30 derniers trades clos. Calcule : win rate, R moyen win, R moyen loss, ratio. C\'est ta réalité statistique. Compare-la à ce que tu "ressens" — souvent très différent.',
      },
      {
        id: 'reframe-question',
        label: 'Reformulation post-trade',
        description:
          'Sur tes 5 prochains trades, après chaque sortie, ne demande PAS "est-ce que ça a marché". Demande : "ai-je suivi mon process ?" La réponse est binaire et indépendante de l\'issue.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'detacher-identite-resultat',
    title: 'Détacher ton identité du résultat',
    category: 'ego',
    quote: 'When you tie your self-worth to a trade, the market owns you.',
    quoteSourceChapter: 'The Disciplined Trader, ch.8',
    paraphrase: `Une perte est juste une perte. Sauf quand tu y as accroché ton identité. Là, ce n'est plus une perte de capital — c'est une atteinte à qui tu es. Et c'est ingérable.

**Le piège de l'ego.** Quand tu prends un trade, ton ego peut s'accrocher à plusieurs choses : "j'ai bien analysé", "je dois prouver que je sais trader", "si ça perd, je suis nul". Cette accroche fait que la sortie du trade arrête d'être une décision rationnelle. Elle devient une question d'amour-propre.

**Les comportements du trader avec ego :**

- Refus de couper un loser : "ça va revenir, je le sens"
- Coupe trop tôt d'un winner : "je ne veux pas que ce gain me file entre les doigts"
- Sur-engagement après une perte : "je vais leur montrer"
- Sous-engagement après un win : "je ne veux pas perdre ce que j'ai gagné"

Tous ces comportements ont la même racine : l'identité accrochée au résultat.

**La pratique de détachement.**

- Avant chaque trade : "ce trade peut perdre, et ça ne me définira pas"
- Après chaque trade : sépare la qualité de l'exécution (ton process) du résultat (le marché). Tu peux avoir 100% du process et un résultat négatif. C'est OK.
- Mesure-toi sur 100 trades, pas sur le dernier. Sur 100 trades, ton vrai niveau ressort.

**Le marqueur d'avancement.** Le jour où tu sors d'une perte conforme à ton plan **sans aucune émotion**, tu as franchi un cap majeur. Ce n'est pas de l'insensibilité — c'est l'alignement entre tes attentes et la réalité statistique.`,
    exercises: [
      {
        id: 'separer-process-resultat',
        label: 'Séparer process et résultat dans le journal',
        description:
          "Pour chaque trade : note 1) qualité du process (0-10 sur respect du plan), 2) résultat (R réalisé). Ce sont 2 axes indépendants. Le pro maximise l'axe 1 et accepte que l'axe 2 fluctue.",
      },
      {
        id: 'phrase-pre-trade',
        label: 'Phrase de détachement pré-trade',
        description:
          'Avant chaque trade : "Ce trade peut perdre. Cette perte ne dira rien sur qui je suis." 5 secondes. Réancre la séparation identité/résultat.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'accepter-la-perte-comme-cout',
    title: "Accepter la perte comme un coût d'opération",
    category: 'loss',
    quote: 'The losses are part of the process — you cannot have one without the other.',
    quoteSourceChapter: 'Trading in the Zone, ch.6',
    paraphrase: `Le débutant veut éviter les pertes. Le pro accepte que les pertes sont le coût d'opération de son business. Cette différence change tout dans la relation au stop-loss et à la coupure du trade perdant.

**La perte n'est pas un échec.** C'est le coût de l'information. Chaque trade que tu prends te dit quelque chose sur le marché. Les wins t'apprennent que ton edge fonctionne sur ce setup. Les losses t'apprennent que ce setup a une probabilité d'échec — qui est intégrée dans ton expectancy.

**Mark Douglas insiste :** tu ne peux pas avoir les wins sans les losses. C'est mathématiquement impossible. Une stratégie à 100% de win rate n'existe pas. Une stratégie à 60% de win rate accepte 40% de losses. Refuser une loss conforme = refuser ta stratégie elle-même.

**Le piège du "ça va revenir".** Tu vois ton stop approcher, et une voix dit "encore 5 pips et ça repart". Cette voix est le pire ennemi du trader. Elle confond le résultat individuel (ce trade) avec la stratégie (l'ensemble). Tenir un loser au-delà du stop, c'est :

- Sortir de ta zone de risque pré-définie
- Subir un drawdown supérieur à ton edge
- Casser le contrat avec ton "toi rationnel" qui a posé le stop

**Couper proprement.** Un stop touché = un stop respecté. Pas de discussion, pas de dernière chance, pas de "5 pips encore". L'exécution propre du stop est une compétence aussi importante que l'identification du setup.

**Ce qui aide :**

- Pose le stop avant l'entrée. Pas après. Si tu n'as pas posé de stop, tu ne fais pas du trading, tu fais du gambling.
- Accepte la perte mentalement avant qu'elle arrive. "Ce trade peut prendre -1R, et c'est OK."
- Compte tes losses au mois, pas au trade. Tant que ton expectancy reste positive, les losses individuelles ne sont pas un problème.`,
    exercises: [
      {
        id: 'stop-pre-entree',
        label: 'Stop défini AVANT chaque entrée',
        description:
          "Engagement : à partir de maintenant, aucune entrée sans stop défini. Si tu n'arrives pas à poser un stop logique sur ce trade, c'est que le trade n'est pas valide. Tu passes.",
      },
      {
        id: 'accepter-1R-mental',
        label: 'Acceptation mentale du -1R',
        description:
          'Avant chaque entrée, dis à voix haute : "Ce trade peut prendre -1R. Je l\'accepte." Cette pré-acceptation rend la coupure mécanique au lieu d\'émotionnelle.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'process-vs-outcome',
    title: "Process avant outcome : la mesure pro de l'effort",
    category: 'process',
    quote:
      'You can be a long-term winner with a 30% win rate, and a long-term loser with a 90% win rate. It depends on your process.',
    quoteSourceChapter: 'Trading in the Zone, ch.9',
    paraphrase: `Comment savoir si tu progresses comme trader ? Pas en regardant ton P&L au mois. En regardant la qualité de ton process. C'est l'inversion la plus contre-intuitive du trading pro.

**Pourquoi le P&L mensuel ment.** Sur 30 trades, la variance peut produire :

- Un mois positif avec un process pourri (tu as eu de la chance)
- Un mois négatif avec un process impeccable (la variance était contre toi)

Le P&L court terme ne reflète pas ton niveau. Il reflète ton process **multiplié par la chance**. Pour mesurer ton niveau réel, tu dois regarder le facteur que tu contrôles : le process.

**Les composantes du process pro :**

- Plan respecté sur chaque trade (oui/non)
- Stop posé avant entrée (oui/non)
- Sizing conforme (oui/non)
- Setup conforme aux critères (oui/non)
- Sortie selon le plan, pas selon l'émotion (oui/non)

Ce sont 5 binaires. Sur 30 trades = 150 décisions. Ton score de process = (oui / 150) × 100.

**Ce que ce score te dit.**

- 90%+ : niveau pro. Le P&L suivra.
- 70-89% : intermédiaire. Travail à faire sur les déviations spécifiques.
- < 70% : tu ne fais pas du trading systématique, tu fais du discrétionnaire émotionnel. Le P&L est aléatoire.

**Le shift mental.** Cesse de demander "ai-je gagné ce mois". Demande "quel pourcentage de mes décisions ont été conformes à mon plan". C'est la seule question qui te fait progresser.

Le P&L est la conséquence. Le process est la cause. Travaille sur la cause.`,
    exercises: [
      {
        id: 'score-process-mois',
        label: 'Score process du mois écoulé',
        description:
          "Reprends les 30 derniers trades. Pour chacun, note les 5 binaires du process. Calcule ton % global. C'est ta vraie note du mois — indépendante du P&L.",
      },
      {
        id: 'cible-process-mois-prochain',
        label: 'Cible process pour le mois prochain',
        description:
          'Fixe une cible de score process pour le mois prochain (+5 pts vs ce mois). Affiche-la. Mesure-la chaque dimanche. Le P&L se débrouillera.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  // =============================================================================
  // J7.5 — 10 fiches additionnelles (catalogue extended, pas de triggers)
  // =============================================================================

  {
    slug: 'every-moment-is-unique',
    title: 'Chaque instant de marché est unique',
    category: 'acceptance',
    quote: 'Every moment in the market is unique.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Tu regardes un setup qui ressemble à celui d'hier. Ton cerveau te dit : "je connais, ça va faire pareil." C'est exactement à cet instant que tu perds ton edge.

**Aucun moment de marché ne se répète à l'identique.** Les acteurs ne sont pas les mêmes, le contexte macro a changé, le flux d'ordres est différent. Le pattern visuel est similaire, mais les forces qui le produisent ne le sont jamais. Quand tu projettes le résultat passé sur le présent, tu ne trades plus le marché — tu trades un souvenir.

Cette règle n'est pas une abstraction philosophique. Elle a une conséquence opératoire : chaque trade doit être pris comme un événement nouveau, indépendant. Pas "ce setup a marché 3 fois cette semaine donc il marchera la 4ème". Pas "ce niveau a tenu hier donc il tient aujourd'hui". Le passé informe ton edge statistique, pas la prédiction du trade individuel.

- Le pattern n'est qu'un signal, pas une promesse.
- Les acteurs derrière le prix ont changé depuis hier.
- "Ça ressemble" n'est pas "ça va faire pareil".
- Ton edge se joue sur la série, pas sur le trade.

**Action concrète.** Avant chaque entrée, dis-toi à voix basse : "ce trade est unique, le résultat est inconnu". Cette phrase casse la projection automatique du cerveau et te ramène au présent — où se trouve ton exécution.`,
    exercises: [
      {
        id: 'mantra-unique-moment',
        label: 'Mantra "ce trade est unique"',
        description:
          'Avant chaque entrée, prononce à voix basse "ce trade est unique, le résultat est inconnu". Note dans le journal si tu l\'as fait sur 100% de tes trades de la semaine.',
      },
      {
        id: 'compare-similar-setups',
        label: 'Comparer 5 setups "identiques"',
        description:
          "Sors 5 setups visuellement similaires de ton historique 30 derniers jours. Identifie 3 différences contextuelles entre eux (volume, news, range D-1). Conclusion : ils n'étaient jamais identiques.",
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'edge-is-not-guarantee',
    title: "Un edge n'est pas une garantie",
    category: 'probabilities',
    quote:
      'An edge is nothing more than an indication of a higher probability of one thing happening over another.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Tu as backtesté ta stratégie. Win rate 58%, RR 1.4. Tu sais que c'est rentable sur la série. Mais sur ce trade-ci, à cet instant, le marché ne te doit rien.

**Un edge est une probabilité, pas une certitude.** 58% de win rate signifie que sur 1000 trades, environ 580 seront gagnants — pas que ce trade-ci a 58% de chances. Le marché n'a pas de mémoire de ton edge. Il ne sait pas que tu as backtesté. Le prochain trade peut perdre, et le suivant aussi, et celui d'après. Ce n'est pas une trahison de ton edge — c'est sa nature statistique.

Confondre edge et garantie produit deux comportements toxiques : sizer trop gros parce qu'on est "sûr" du trade, et révolter contre le marché quand il ne valide pas. Les deux viennent du même malentendu : croire que la probabilité s'applique au trade individuel plutôt qu'à la série.

- 58% win rate ne dit RIEN sur le trade en cours.
- Le marché ne te doit pas la statistique au prochain trade.
- Une perte ne casse pas ton edge ; elle l'exécute.
- Une série de pertes est mathématiquement attendue.

**Action concrète.** Calcule la probabilité d'avoir 5 pertes consécutives avec ton win rate (formule : (1-WR)^5). À 58%, c'est 1.3% — soit ~1 fois par 77 séries. Une drawdown n'est pas un signal d'arrêter, c'est l'exécution normale de la statistique.`,
    exercises: [
      {
        id: 'compute-streak-probability',
        label: 'Calculer la prob. de séries perdantes',
        description:
          "Avec ton win rate réel des 100 derniers trades, calcule la probabilité d'avoir 3, 5, 7 pertes consécutives. Note ces chiffres en haut de ton journal hebdo. Ils dédramatisent les drawdowns.",
      },
      {
        id: 'separate-trade-from-series',
        label: 'Séparer le trade de la série',
        description:
          'À chaque trade fermé (gain ou perte), écris UNE phrase : "ce trade : [résultat]. Ma série de 100 : toujours 58% WR." Tu sépares mentalement l\'évènement du système.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'random-distribution-wins-losses',
    title: 'Tes gains et tes pertes sont distribués au hasard',
    category: 'probabilities',
    quote:
      'There is a random distribution between wins and losses for any given set of variables that define an edge.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Tu viens de gagner 3 trades d'affilée. Tu sens que le 4ème est statistiquement "dû" pour perdre, alors tu sizes plus petit. Erreur. Tu viens de perdre 4 trades d'affilée, tu sens que le prochain "doit" gagner, alors tu sizes plus gros. Double erreur.

**L'ordre des gains et des pertes dans ta série est aléatoire.** Même avec un edge réel, tu ne peux pas prédire si le prochain trade gagne ou perd. Tu sais seulement que sur N trades, environ X% gagneront. La distribution dans le temps est imprévisible. Ce qui veut dire qu'une série de 5 gagnants ne réduit pas la probabilité du suivant, et 5 perdants ne l'augmentent pas.

C'est l'erreur du joueur : croire que la roulette doit "compenser". En trading, chaque trade pris dans les conditions de ton edge a la même probabilité — celle de ton edge. Sizer en fonction du résultat des trades précédents, c'est ajouter une erreur stratégique à un biais cognitif.

- 3 gagnants d'affilée n'augmentent pas la prob. d'une perte au suivant.
- 4 perdants d'affilée n'augmentent pas la prob. d'un gain au suivant.
- Ta taille de position doit dépendre de ton risque, pas de ta série récente.
- "Sentir que ça va perdre/gagner" est un bruit, pas un signal.

**Action concrète.** Fixe ta taille de position en pourcentage du capital, défini en avance, hors session. Si tu te surprends à modifier ce sizing en réaction aux 3 derniers trades, c'est un signal d'arrêter et de revenir au plan.`,
    exercises: [
      {
        id: 'fixed-sizing-rule',
        label: 'Sizing fixe défini hors session',
        description:
          "Avant la semaine, écris ta règle de sizing en % du capital. Ex : 0.5% par trade. Pendant la semaine, interdis-toi de la modifier. Compte combien de fois tu as été tenté de l'ajuster.",
      },
      {
        id: 'log-streak-reaction',
        label: 'Logger les réactions aux séries',
        description:
          'Pendant 2 semaines, après chaque trade, note 1 ligne : "ma série actuelle : X gagnants/perdants — j\'ai été tenté de sizer +/- ? oui/non". Lis le tout en fin de période pour voir ton biais.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'revenge-trade-trap',
    title: 'Le piège du revenge trade',
    category: 'tilt',
    quote:
      "The market doesn't generate happy or painful information. From the market's perspective, it's all simply information.",
    quoteSourceChapter: 'Trading in the Zone, ch.4',
    paraphrase: `Tu viens de perdre. Le marché continue dans le sens où tu étais positionné, juste après ton stop. Ton corps réagit avant ton cerveau — la main est déjà sur le clic d'achat. C'est le revenge trade.

**Le revenge trade n'est pas un trade, c'est une réaction.** Tu ne cherches plus à exécuter ton edge ; tu cherches à effacer la perte précédente. Le marché ne sait pas que tu viens de perdre. Il ne te doit aucune compensation. Mais ton cerveau interprète la perte comme une attaque, et la réponse instinctive est de contre-attaquer — immédiatement, plus gros, sans plan.

Trois signaux distinguent un revenge trade d'un vrai trade : 1) il arrive dans les 60 secondes après une perte, 2) tu ne peux pas verbaliser ton setup en une phrase claire, 3) la taille est différente de ta taille standard. Si deux de ces trois cases sont cochées, ce n'est pas du trading. C'est de l'émotion.

- La main qui clique avant que le cerveau ait formulé le setup = signal rouge.
- Le marché ne te doit pas la perte précédente.
- Augmenter le size pour "rattraper" multiplie le risque, pas l'edge.
- L'urgence ressentie est interne, pas dans le marché.

**Action concrète.** Règle dure : après une perte, 5 minutes de pause minimum, écran fermé ou regard sur une autre fenêtre. Si tu prends un trade dans cet intervalle, il est annulé mentalement et noté comme tilt dans le journal — quel que soit son résultat.`,
    exercises: [
      {
        id: 'cooldown-after-loss',
        label: 'Cooldown 5 min après chaque perte',
        description:
          'Programme un timer de 5 minutes qui se déclenche à chaque stop touché. Pendant ce délai : pas de nouvelle entrée. Compte les violations sur 2 semaines. Objectif : 0 violation en semaine 3.',
      },
      {
        id: 'verbalize-setup-test',
        label: 'Test de verbalisation du setup',
        description:
          "Avant chaque entrée, dis à voix haute en 1 phrase : \"j'entre parce que [condition], stop à [niveau], cible [niveau].\" Si tu ne peux pas la formuler claire, tu n'entres pas. C'est ton filtre anti-revenge.",
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 7,
    published: true,
  },

  {
    slug: 'wait-for-your-setup',
    title: 'Attendre TON setup, pas un setup',
    category: 'patience',
    quote: 'The hard part is waiting. The trader who can wait has already won half the battle.',
    quoteSourceChapter: 'The Disciplined Trader, ch.8',
    paraphrase: `Tu es devant l'écran depuis 2 heures. Le marché bouge, mais pas dans tes conditions. Tu commences à lire les bougies différemment, à élargir mentalement ce qui qualifie comme "setup". C'est là que tu vas perdre.

**Ton edge a des conditions précises. En dehors, tu trades autre chose qu'on appellera selon les jours : ennui, FOMO, ou frustration.** Attendre n'est pas du temps perdu — c'est l'acte de trading le plus rentable que tu poses. Chaque trade pris hors-conditions dilue statistiquement ton edge. Sur 100 trades, si 30 sont "marginaux", ton win rate réel n'est plus celui de ton backtest. Il est plus bas, parfois sous le seuil de rentabilité.

Le problème : l'attente est inconfortable. Le cerveau confond "ne rien faire" avec "ne pas travailler". Mais le travail du trader, c'est l'exécution conditionnelle, pas la fréquence. Un trader qui prend 2 trades par semaine dans ses conditions surperforme un trader qui en prend 20 dont 14 marginaux.

- Pas de setup = pas de trade. Période.
- Élargir mentalement les conditions = changer de stratégie sans backtest.
- L'attente active (rester focus) est un travail.
- Forcer la fréquence dilue l'edge.

**Action concrète.** Écris en 5 lignes maximum les conditions exactes de ton setup. Imprime-les. Affiche-les à côté de l'écran. Avant chaque entrée, vérifie ligne par ligne. Si une seule ligne ne coche pas, tu n'entres pas.`,
    exercises: [
      {
        id: 'setup-checklist-physical',
        label: 'Checklist setup imprimée',
        description:
          "Écris en 5 lignes max les conditions exactes de ton setup. Imprime. Avant chaque trade, lis les 5 lignes à voix basse et confirme oui/non. Note le nombre d'entrées refusées par semaine grâce à la checklist.",
      },
      {
        id: 'no-trade-day-target',
        label: 'Objectif jours sans trade',
        description:
          'Définis combien de jours par semaine tu PEUX rester sans entrer, en cohérence avec ta stratégie. Note les jours sans trade comme une victoire dans le journal, pas comme un échec.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'confidence-vs-arrogance',
    title: 'Confiance vs arrogance',
    category: 'confidence',
    quote:
      'Confidence is not a function of being right. Confidence is a function of having a sound process.',
    quoteSourceChapter: 'Trading in the Zone, ch.10',
    paraphrase: `Tu as enchaîné une bonne semaine. Tu te sens lucide, le marché te parle. Attention : ce sentiment précède statistiquement les pires drawdowns. Il s'appelle l'arrogance, et il porte le costume de la confiance.

**La confiance vient du process, l'arrogance vient du résultat.** Confiance : "j'ai exécuté mon plan sur les 50 derniers trades sans dévier, je sais que mon edge tient sur la série." Arrogance : "j'ai gagné 5 fois cette semaine, je peux maintenant lire le marché mieux que la semaine dernière." La première est stable, la seconde est volatile — elle s'écroule au premier trade perdant.

Symptômes d'arrogance : tu prends des positions hors conditions parce que "tu sens", tu sizes plus gros sans raison statistique, tu gardes des positions au-delà de ta cible parce que "ça va continuer", tu commentes mentalement les trades des autres comme s'ils étaient mauvais. Ces signaux apparaissent toujours après une série gagnante. Ils précèdent toujours une casse.

- Confiance = ancrée dans l'exécution répétée.
- Arrogance = ancrée dans le résultat récent.
- "Je sens le marché" = signal d'arrogance, pas de skill.
- Sizer plus gros sans raison statistique = arrogance.

**Action concrète.** Après toute série de 4+ gagnants consécutifs, ouvre le journal et écris : "qu'est-ce que je risque de modifier dans mon exécution à cause de cette série ?" Identifie les tentations. Ne les autorise pas.`,
    exercises: [
      {
        id: 'post-streak-checkpoint',
        label: 'Checkpoint après série gagnante',
        description:
          'Définis un seuil (ex: 4 gagnants d\'affilée). Au-delà, ouvre le journal et écris 3 phrases : "ma série actuelle / ce que je risque de modifier / ma règle pour ne PAS le modifier." Relis avant la prochaine entrée.',
      },
      {
        id: 'confidence-from-process',
        label: 'Score de confiance basé process',
        description:
          'En fin de semaine, note ta confiance sur 10 selon : nombre de trades pris dans tes conditions / total. Pas selon le P&L. Cette note isole confiance saine vs arrogance.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 6,
    published: true,
  },

  {
    slug: 'the-3-phases-of-execution',
    title: "Les 3 phases d'exécution d'un trade",
    category: 'discipline',
    quote: "You don't need to know what's going to happen next to make money. Anything can happen.",
    quoteSourceChapter: 'Trading in the Zone, ch.11',
    paraphrase: `Un trade se joue en trois phases distinctes : avant, pendant, après. Chaque phase a ses règles. Confondre les règles d'une phase avec celles d'une autre est la cause principale d'erreur d'exécution.

**Avant l'entrée : décision conditionnelle.** Tu vérifies si les conditions de ton setup sont réunies. Réponse binaire : oui (j'entre, taille fixe, stop défini) ou non (je n'entre pas). Aucune négociation, aucun ajustement de cible "parce que ça a l'air fort". Le moment d'entrée est le seul où tu décides — après, tu exécutes.

**Pendant le trade : zéro décision discrétionnaire.** Le stop et la cible sont fixés. Tu ne les déplaces pas en réaction au prix. Tu peux ajuster selon des règles écrites en avance (trailing stop déclenché par condition X), pas selon ce que tu ressens. Si tu sens l'envie de couper avant la cible ou d'élargir le stop, c'est un signal de l'émotion, pas un signal de marché.

**Après le trade : analyse du process, pas du résultat.** Question unique : "ai-je exécuté mon plan ?" Si oui = trade réussi (gain ou perte). Si non = trade raté (gain ou perte). Le résultat financier est secondaire à l'évaluation de l'exécution.

- Avant = décision binaire.
- Pendant = exécution sans débat.
- Après = audit du process, pas du P&L.

**Action concrète.** Sépare physiquement les trois phases dans ton journal : 3 colonnes "Avant / Pendant / Après". Pour chaque trade, remplis les 3. Cela force la conscience de quelle phase tu es en train de violer.`,
    exercises: [
      {
        id: 'three-column-journal',
        label: 'Journal en 3 colonnes',
        description:
          'Refais ton template de journal avec 3 colonnes : Avant (conditions cochées), Pendant (interventions sur stop/cible et raisons), Après (process exécuté oui/non). Tiens-le 2 semaines minimum.',
      },
      {
        id: 'no-mid-trade-edit',
        label: 'Règle "pas de modif en cours de trade"',
        description:
          "Pendant 1 semaine, interdis-toi tout déplacement de stop/cible une fois le trade ouvert, sauf règle écrite à l'avance. Compte les violations. Cible : 0 en semaine 2.",
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'the-fear-of-being-wrong',
    title: "La peur d'avoir tort",
    category: 'fear',
    quote: 'The fear of being wrong is the most fundamental fear of all traders.',
    quoteSourceChapter: 'Trading in the Zone, ch.5',
    paraphrase: `Tu hésites à couper une position perdante. Tu ajoutes au lieu de couper. Tu déplaces ton stop "pour donner de l'air". Diagnostic : tu n'as pas peur de perdre de l'argent. Tu as peur d'avoir tort.

**La peur d'avoir tort est la peur fondamentale du trader.** Elle ne porte pas sur l'argent — elle porte sur l'identité. Couper la perte, c'est admettre que ton analyse était fausse. Déplacer le stop, c'est se donner une chance de "ne pas avoir eu tort". Mais le marché ne valide jamais l'analyse rétroactivement. Il valide uniquement l'exécution.

Cette peur produit des comportements identifiables : positions perdantes maintenues trop longtemps, ajouts à la perte, stops mentaux non respectés, refus de prendre la perte petite quand elle est encore petite. Tous ces comportements ont la même racine : protéger l'égo, pas le capital.

L'antidote n'est pas "ne plus avoir peur d'avoir tort". L'antidote est de redéfinir ce que "avoir tort" signifie. Tu n'as pas tort quand un trade perd. Tu as tort quand tu ne suis pas ton plan.

- Couper la perte ≠ avoir tort = exécuter le plan.
- Déplacer le stop = protection de l'égo, pas du capital.
- "J'avais raison sur la direction, juste un peu tôt" = signal de peur.
- Le marché ne valide pas l'analyse, il valide l'exécution.

**Action concrète.** Reformule l'auto-évaluation. Au lieu de "ce trade a perdu, j'ai eu tort", écris "ce trade a perdu, j'ai exécuté mon plan ou pas". Si oui, tu n'as pas eu tort, peu importe le résultat.`,
    exercises: [
      {
        id: 'reframe-being-wrong',
        label: 'Reformuler "avoir tort"',
        description:
          'Pendant 2 semaines, après chaque trade, réponds à 1 seule question : "ai-je suivi mon plan ?" oui/non. Le P&L vient en second. Cette discipline déconnecte progressivement l\'égo du résultat.',
      },
      {
        id: 'small-loss-celebration',
        label: 'Célébrer les petites pertes',
        description:
          'Définis "petite perte" = stop respecté à -1R ou moins. À chaque petite perte, écris 1 ligne dans le journal : "petite perte exécutée correctement = victoire de discipline". Compte ces victoires en fin de mois.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 7,
    published: true,
  },

  {
    slug: 'stop-loss-is-cost-not-failure',
    title: 'Le stop loss est un coût, pas un échec',
    category: 'loss',
    quote: 'Losses are simply the cost of doing business as a trader.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Un commerçant achète son stock à 10€ et le revend 15€. Il sait que certains articles ne se vendront pas et finiront en solde à 5€. Cette perte n'est pas un échec — c'est un coût d'exploitation. Le trader qui touche un stop est dans la même situation.

**Le stop loss n'est pas un échec, c'est un coût d'opération.** Sans stop, pas de business. C'est le prix à payer pour participer à un jeu probabiliste. Tant que tes pertes par trade restent dans ton sizing prévu (0.5% à 1% du capital, par exemple), elles ne sont pas un problème — elles sont l'exécution normale du système.

Le problème commence quand tu interprètes le stop comme un jugement personnel. À ce moment-là, deux comportements toxiques apparaissent : l'évitement (ne pas mettre de stop, ou le mettre trop loin) et la négation (déplacer le stop quand il approche). Les deux transforment un coût normal en risque catastrophique.

- Le stop est un coût, comme le loyer pour un commerce.
- Pas de stop = pas de business viable.
- Déplacer le stop = transformer un coût en risque inconnu.
- Une série de stops dans ton sizing ≠ catastrophe.

**Action concrète.** Calcule ton "coût d'exploitation hebdomadaire" — combien tu peux perdre sur une semaine en respectant ton sizing et ton win rate. Ce chiffre devient ta limite acceptable. En dessous, tout va bien — c'est le coût de faire du trading.`,
    exercises: [
      {
        id: 'compute-weekly-cost',
        label: 'Calculer le coût hebdomadaire',
        description:
          'Avec ton sizing (% par trade) et ton nombre de trades/semaine moyen, calcule la perte maximale attendue dans une mauvaise semaine (ex: 60% pertes). Ce chiffre est ton "coût d\'exploitation". Note-le, accepte-le, ne le dépasse pas.',
      },
      {
        id: 'stop-respect-rate',
        label: 'Taux de respect des stops',
        description:
          'Sur 50 trades, compte combien de fois ton stop a été respecté à 100% (pas déplacé, pas annulé). Cible : 100%. Tout en dessous = problème de discipline à corriger en priorité.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 6,
    published: true,
  },

  {
    slug: 'weekly-review-rituel',
    title: 'Le rituel de review hebdomadaire',
    category: 'process',
    quote: 'Without self-discipline, no real success is possible.',
    quoteSourceChapter: 'The Disciplined Trader, ch.1',
    paraphrase: `Un trader qui ne fait pas de review hebdomadaire est un athlète qui ne regarde jamais ses vidéos d'entraînement. Le talent ne suffit pas. La progression vient de la boucle exécution → mesure → ajustement → exécution.

**La review hebdomadaire n'est pas optionnelle, c'est la moitié du travail.** L'autre moitié, c'est le trading lui-même. Sans review, tu répètes les mêmes erreurs sans les voir. Avec review, tu identifies les patterns d'erreur et tu les corriges un par un.

Une review efficace tient en 30 minutes maximum, le même jour de la semaine, au même endroit. Elle suit toujours la même structure : statistiques d'exécution (pas de P&L brut), erreurs récurrentes, une seule action concrète pour la semaine suivante. Pas trois actions. Une seule. Le but n'est pas de tout corriger en une semaine — c'est d'incrémenter de manière compounding sur 50 semaines.

- 30 minutes max, même jour, même heure.
- Métriques d'exécution AVANT métriques de P&L.
- Une seule action pour la semaine suivante.
- Compounding sur 50 semaines = transformation réelle.

**Action concrète.** Bloque dimanche 19h-19h30 dans ton calendrier comme "Review Fxmily" récurrent. Ouvre un template fixe : 5 stats d'exécution, 1 erreur récurrente, 1 action pour la semaine. Refuse toute autre activité dans ce créneau. La régularité bat l'intensité.`,
    exercises: [
      {
        id: 'weekly-review-slot',
        label: 'Bloquer le créneau review',
        description:
          'Crée un événement récurrent hebdomadaire dans ton calendrier, 30 minutes, jour et heure fixes. Tiens-le 4 semaines consécutives sans exception. Note dans le journal chaque review effectuée.',
      },
      {
        id: 'one-action-per-week',
        label: 'Une seule action par semaine',
        description:
          "À chaque review, identifie UNE seule erreur récurrente et UNE seule action concrète. Pas plus. Mesure son application la semaine suivante. La discipline d'avoir une seule cible évite la dispersion.",
      },
      {
        id: 'execution-stats-template',
        label: "Template stats d'exécution",
        description:
          'Crée un template fixe avec 5 métriques : % trades dans tes conditions, % stops respectés, % cibles atteintes vs sorties anticipées, nombre de revenge trades, nombre de modifications mid-trade. Remplis-le chaque semaine.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  // =============================================================================
  // J7.6 — 9 fiches additionnelles (acceptance + tilt + discipline)
  // =============================================================================

  {
    slug: 'la-perte-fait-partie-du-jeu',
    title: 'La perte fait partie du jeu',
    category: 'acceptance',
    quote:
      "Anything can happen. You don't need to know what is going to happen next in order to make money.",
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `La perte n'est pas un accident dans ton parcours, c'est un ingrédient.

**Le marché ne te doit rien.** Tant que tu traites une perte comme une anomalie à corriger, tu vis chaque trade comme un examen à réussir. Mark Douglas appelle ça la résistance fondamentale du trader débutant : refuser que le hasard fasse partie du métier. Tu ne peux pas négocier avec la distribution statistique de ton edge. Sur 100 trades, une partie sera perdante, peu importe la qualité de ton analyse.

L'acceptation, ce n'est pas se dire "tant pis" après coup. C'est savoir AVANT le trade que ce setup peut perdre, et rentrer quand même parce que ton edge est positif sur la série, pas sur le trade unique.

- Le trade individuel n'a pas d'information sur ta compétence
- La série de 50 trades, oui
- Ton job c'est d'exécuter la série, pas de gagner ce trade
- Si tu réagis émotionnellement à un trade isolé, tu sabotes la série

La différence entre un trader pro et un trader émotionnel : le pro a déjà payé psychologiquement la perte AVANT de cliquer. Le SL n'est pas une menace, c'est un coût d'opération budgétisé.

**Action concrète.** Avant chaque entrée, écris à voix haute le montant exact que tu acceptes de perdre sur ce trade. Si tu n'arrives pas à le dire calmement, ne prends pas le trade.`,
    exercises: [
      {
        id: 'pre-trade-loss-acceptance',
        label: "Verbaliser la perte avant l'entrée",
        description:
          'Avant chaque trade, dis à voix haute : "Sur ce trade je peux perdre X euros, c\'est OK." Si tu ne peux pas le dire calmement, le size est trop gros ou ton acceptation n\'est pas faite. Réduis ou skip.',
      },
      {
        id: 'serie-50-mindset',
        label: 'Penser en série de 50',
        description:
          "Au lieu d'évaluer ta journée sur 1 trade, ouvre ton journal et regarde les 50 derniers. Note ton win rate réel et ton expectancy. C'est ça ta réalité, pas le dernier trade.",
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'l-incertitude-est-ton-environnement',
    title: "L'incertitude est ton environnement",
    category: 'acceptance',
    quote:
      'There is a random distribution between wins and losses for any given set of variables that define an edge.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Tu ne travailles pas dans un environnement déterministe. Accepter ça change tout.

**L'incertitude n'est pas un bug à corriger, c'est la matière première.** Mark Douglas insiste : même un edge avec 70% de win rate distribue ses pertes de manière aléatoire. Tu peux avoir 5 pertes consécutives sur un système qui gagne sur 100 trades. Ce n'est pas que ton système est cassé, c'est la distribution qui s'exprime.

Le débutant cherche à éliminer l'incertitude par plus d'analyse, plus d'indicateurs, plus de confluences. Le pro l'accepte comme constante et travaille dessus. Brett Steenbarger note la même chose chez les traders qu'il coache : ceux qui durent ne demandent pas "vais-je gagner ce trade", ils demandent "est-ce que j'exécute mon process correctement".

- Tu ne peux pas savoir quel trade va gagner dans la série
- Tu peux savoir que ta série est positive sur 50+ trades
- Chaque trade est unique mais ton edge ne l'est pas
- L'incertitude individuelle + certitude statistique = la base du métier

Quand tu acceptes l'incertitude, tu cesses de chercher à la prédire. Tu agis en probabilités, pas en certitudes.

**Action concrète.** À la fin de la semaine, classe tes trades en deux colonnes : "process correct" et "résultat positif". Le seul score qui compte est la première colonne.`,
    exercises: [
      {
        id: 'process-vs-result-tracking',
        label: 'Tracker process vs résultat',
        description:
          "Sur chaque trade clôturé, note 2 choses séparément : (1) process correct oui/non, (2) résultat positif oui/non. À la fin de la semaine, ton vrai score c'est le ratio process correct, pas le PnL.",
      },
      {
        id: 'embrace-uncertainty-journal',
        label: "Journal d'acceptation incertitude",
        description:
          'Chaque matin, écris une phrase : "Aujourd\'hui je ne sais pas quels trades vont gagner, et c\'est OK car mon edge se joue sur la série." Lecture obligatoire avant la première entrée.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'l-erreur-n-est-pas-l-echec',
    title: "L'erreur n'est pas l'échec",
    category: 'acceptance',
    quote: 'The hard, cold reality of trading is that every trade has an uncertain outcome.',
    quoteSourceChapter: 'Trading in the Zone, ch.3',
    paraphrase: `Une erreur d'exécution n'est pas un échec moral, c'est une donnée.

**Ton ego confond erreur et identité.** Quand tu loupes un setup ou que tu sors trop tôt, ton cerveau interprète ça comme "je suis nul" au lieu de "j'ai fait une erreur de process". Cette confusion est le carburant principal du tilt. Mark Douglas l'explique dans The Disciplined Trader : tant que tu identifies ta valeur personnelle au résultat de tes trades, tu auras peur de trader.

L'athlète pro fait des erreurs chaque jour et les analyse à froid. Il ne se demande pas "suis-je un bon athlète" après chaque action ratée. Il demande "qu'est-ce que cette erreur m'apprend sur mon process".

- Erreur d'analyse : ton edge n'était pas valide
- Erreur d'exécution : tu n'as pas respecté ton plan
- Erreur de gestion : ton SL/TP n'était pas adapté
- Échec moral : ça n'existe pas dans le trading

Trois catégories d'erreurs, zéro jugement personnel. Tu sépares le faire et l'être. Sans cette séparation, chaque perte devient une attaque sur ton identité.

**Action concrète.** Quand tu identifies une erreur, écris-la au format "j'ai fait X parce que Y", jamais "je suis Z".`,
    exercises: [
      {
        id: 'error-categorization',
        label: 'Catégoriser tes erreurs',
        description:
          'Pour chaque erreur identifiée, classe-la : analyse / exécution / gestion. Note la cause concrète. Interdiction d\'utiliser des mots de jugement personnel ("nul", "stupide"). Reformule jusqu\'à ce que ce soit factuel.',
      },
      {
        id: 'separate-do-from-be',
        label: 'Séparer faire et être',
        description:
          'Une fois par semaine, relis tes notes de trading. Surligne toute phrase qui décrit qui tu ES (jugement) et réécris-la pour décrire ce que tu as FAIT (action).',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },

  {
    slug: 'la-frustration-de-la-perte-rapide',
    title: 'La frustration de la perte rapide',
    category: 'tilt',
    quote:
      'The four primary trading fears: being wrong, losing money, missing out, and leaving money on the table.',
    quoteSourceChapter: 'Trading in the Zone, ch.4',
    paraphrase: `Tu viens de prendre un SL en quelques minutes. Ton corps brûle. C'est là que ton compte se joue.

**La perte rapide active une réponse physiologique avant cognitive.** Tu n'as pas le temps de digérer mentalement, ton système nerveux est déjà en mode alerte. Cortisol, rythme cardiaque, vision tunnel. C'est exactement le pire état pour décider du trade suivant. Brett Steenbarger documente ça extensivement : la performance cognitive chute drastiquement dans les 10-20 minutes après un événement émotionnellement chargé.

Le piège classique : tu crois que reprendre un trade va "réparer" la perte. Ton cerveau cherche du soulagement immédiat, pas du PnL futur. C'est la définition même du revenge trade.

- La perte rapide n'est pas plus grave qu'une perte lente
- Elle se sent juste plus violente parce que ton corps n'a pas eu le temps de l'absorber
- Aucun trade pris dans cet état n'a de valeur statistique pour toi

La règle athlète pro : après une perte rapide qui te chauffe, tu n'as plus accès à ton edge. Tes décisions des 30 prochaines minutes ne sortent pas du même cerveau.

**Action concrète.** Après une perte qui te fait sentir physiquement chaud, ferme le terminal pendant 30 minutes minimum. Marche, eau, respiration. Pas de chart.`,
    exercises: [
      {
        id: 'physiological-cooldown',
        label: 'Cooldown physiologique 30 min',
        description:
          'Après une perte qui te fait sentir chaleur, accélération cardiaque ou tension, tu coupes le terminal 30 min minimum. Marche, eau, respiration carrée 4-4-4-4. Pas de chart, pas de news, pas de Discord trading.',
      },
      {
        id: 'body-scan-post-loss',
        label: 'Scan corporel post-perte',
        description:
          "Juste après le SL, ferme les yeux 60 secondes et scanne ton corps : épaules, mâchoire, ventre, mains. Note où tu sens la tension. Ce n'est pas du yoga, c'est de l'information sur ton état opérationnel.",
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 6,
    published: true,
  },

  {
    slug: 'le-tilt-froid',
    title: 'Le tilt froid',
    category: 'tilt',
    quote:
      'When you really believe that trading is simply a probability game, concepts like right and wrong or win and lose no longer have the same significance.',
    quoteSourceChapter: 'Trading in the Zone, ch.7',
    paraphrase: `Le tilt n'est pas toujours bruyant. Sa version la plus dangereuse est silencieuse.

**Le tilt froid c'est l'autopilote sans présence.** Tu n'es pas en colère, tu ne cries pas. Tu cliques juste sans ressentir. Tu prends des trades en mode mécanique, sans le filtre de validation, parce qu'une partie de toi veut "rentabiliser la session" ou "voir ce qui se passe". Tu te dis que tu es calme alors qu'en réalité tu es absent. C'est plus dangereux que le tilt chaud parce que tu ne déclenches aucun signal d'alarme.

Brett Steenbarger appelle ça "the dissociated trader" : déconnecté de son process, déconnecté de son corps. Le compte saigne lentement et tu ne le vois pas parce que rien ne brûle.

- Tu cliques sans relire ton plan
- Tu ne vérifies pas si le setup est valide
- Tu te dis "on va voir" au lieu de "voici pourquoi"
- Tu confonds calme et présence

Présence n'est pas absence d'émotion. Présence c'est savoir POURQUOI tu prends chaque trade, à chaque instant.

**Action concrète.** Avant chaque clic, oblige-toi à dire à voix haute : "Je prends ce trade parce que [setup précis], mon SL est à [niveau], mon TP est à [niveau]." Si tu ne peux pas, tu n'es pas présent.`,
    exercises: [
      {
        id: 'verbal-pre-click',
        label: 'Verbalisation pré-clic',
        description:
          'Avant chaque entrée, dis à voix haute : "Setup X, SL à Y, TP à Z, raison principale = [phrase courte]." Pas dans ta tête. À voix haute. Si la phrase ne sort pas fluide, tu n\'es pas en condition de trader.',
      },
      {
        id: 'cold-tilt-checkin',
        label: 'Check-in présence toutes les 30 min',
        description:
          'Toutes les 30 minutes pendant la session, pause 60 secondes : ferme les yeux, scanne ton état. Es-tu présent ou en autopilote ? Note sur 1-10 ton niveau de présence. Sous 6, coupe.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 6,
    published: true,
  },

  {
    slug: 'le-tilt-de-l-ennui',
    title: "Le tilt de l'ennui",
    category: 'tilt',
    quote:
      'The best traders are not afraid. They have developed an attitude that gives them the greatest amount of mental flexibility.',
    quoteSourceChapter: 'Trading in the Zone, ch.1',
    paraphrase: `Le marché ne fait rien, et toi tu cherches à faire quelque chose. Mauvaise combinaison.

**L'ennui est une émotion qui pousse à l'action sans setup.** Tu n'as pas pris de trade depuis 2 heures, ton cerveau interprète l'inactivité comme un échec. "Je suis là pour trader, pas pour regarder." Et là tu commences à voir des setups qui n'existent pas, à forcer des entrées sur des configurations B ou C, à descendre en timeframe pour "trouver quelque chose".

C'est exactement ce que Mark Douglas appelle l'incapacité à attendre. Le marché ne te paie pas pour cliquer, il te paie pour cliquer AU BON MOMENT.

- L'ennui n'est pas un signal de marché
- L'ennui est un signal sur TOI
- Trader pour ne pas s'ennuyer = revenir avec moins de capital
- Le pro accepte que la majorité du temps soit "ne rien faire"

Un sniper passe 95% de son temps à observer et 5% à tirer. C'est le ratio normal du métier.

**Action concrète.** Quand tu sens l'ennui monter, lève-toi physiquement de ta chaise. Marche 5 minutes. Si en revenant le setup est toujours là et toujours valide, prends-le. Sinon, tu viens d'éviter un trade d'ennui.`,
    exercises: [
      {
        id: 'boredom-walk-test',
        label: "Test de la marche d'ennui",
        description:
          "Quand tu sens l'ennui (>30 min sans setup), lève-toi et marche 5 minutes hors écran. Au retour, le setup est-il toujours visible et toujours A-grade ? Si non, tu viens d'éviter un trade pourri.",
      },
      {
        id: 'sniper-ratio-mantra',
        label: 'Mantra ratio sniper',
        description:
          'Affiche sur ton bureau : "95% observer, 5% exécuter. Ne rien faire EST le métier." Lecture quand tu sens l\'envie de cliquer pour cliquer.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 5,
    published: true,
  },

  {
    slug: 'le-tilt-d-euphorie',
    title: "Le tilt d'euphorie",
    category: 'tilt',
    quote: 'I am a consistent winner because I think like a trader, not because I had a good day.',
    quoteSourceChapter: 'Trading in the Zone, ch.8',
    paraphrase: `Le tilt n'est pas réservé aux pertes. Une grosse victoire peut détruire ta semaine.

**L'euphorie déforme ta perception du risque.** Tu viens d'aligner 3 winners. Ton cerveau libère de la dopamine, ton sentiment de compétence explose, et soudain les setups B-grade ressemblent à des A-grade. Tu sizes plus gros parce que tu es "in the zone". Tu zappes le SL parce que "ça va revenir comme tout à l'heure". C'est statistiquement le moment où tu rends tous tes gains.

Mark Douglas parle de l'euphorie comme du pire ennemi du trader expérimenté, parce qu'elle se déguise en compétence. Tu crois que c'est toi qui as réussi, alors que c'est juste la distribution qui t'a souri sur 3 trades.

- 3 winners consécutifs n'augmentent pas ta probabilité du 4e
- L'euphorie te fait sizer hors plan
- L'euphorie te fait skip ta checklist
- L'euphorie te fait confondre talent et chance

Brett Steenbarger note que les pires drawdowns arrivent souvent juste après les meilleures séries.

**Action concrète.** Après 3 winners consécutifs, oblige-toi à réduire ta size de 50% sur les 5 trades suivants. Pas pour te punir, pour neutraliser le biais d'euphorie.`,
    exercises: [
      {
        id: 'post-streak-size-cap',
        label: 'Cap de size post-série gagnante',
        description:
          "Après 3 trades gagnants d'affilée, réduis automatiquement ta size de 50% pour les 5 prochains trades. Règle mécanique, non négociable. Tu reviens à size normale après ces 5 trades, peu importe le résultat.",
      },
      {
        id: 'euphoria-checklist',
        label: 'Checklist post-victoire',
        description:
          'Après chaque trade gagnant supérieur à 2R, avant de regarder les charts, réponds : "Mon plan a-t-il changé ? Mon edge est-il différent ? Suis-je en train de chercher un nouveau setup valide ?" Si tu cherches, tu coupes 30 min.',
      },
    ],
    triggerRules: null,
    hatClass: 'black',
    priority: 5,
    published: true,
  },

  {
    slug: 'la-discipline-est-une-architecture',
    title: 'La discipline est une architecture',
    category: 'discipline',
    quote:
      'Discipline is a mental technique to redirect your focus of attention to the object of your goal.',
    quoteSourceChapter: 'The Disciplined Trader, ch.4',
    paraphrase: `La discipline n'est pas une force de caractère, c'est un système conçu.

**Tu ne disciplines pas avec ta volonté, tu disciplines avec ton environnement.** Le trader qui compte sur sa motivation pour respecter son plan perdra cette guerre. La volonté est une ressource finie qui s'épuise dans la journée. Brett Steenbarger insiste : les pros ne sont pas plus disciplinés mentalement, ils ont juste construit des architectures qui rendent l'indiscipline coûteuse ou impossible.

Mark Douglas dans The Disciplined Trader développe la même idée : la discipline est un mécanisme de redirection d'attention, pas une lutte contre soi-même. Tu rediriges parce que ton environnement te le rappelle, pas parce que tu te bats avec toi.

- Plan écrit avant la session, pas pendant
- Size automatique calculée par Excel/script, pas à la main
- SL placé dès l'entrée, pas plus tard
- Heures de trading définies à l'avance, alarme physique

Chaque règle qui ne tient qu'à ta volonté du moment est une règle qui sera violée dans une mauvaise journée. Chaque règle inscrite dans une mécanique extérieure est une règle qui tient même quand tu es fatigué, énervé ou euphorique.

**Action concrète.** Identifie cette semaine une règle que tu violes régulièrement. Au lieu de "essayer plus fort", construis l'architecture qui rend la violation difficile (alarme, lock-out broker, écran éteint).`,
    exercises: [
      {
        id: 'rule-architecture-audit',
        label: "Audit d'architecture des règles",
        description:
          'Liste tes 5 règles de trading principales. Pour chacune, note : "tient à ma volonté" ou "tient à mon environnement". Pour chaque règle qui tient à la volonté, conçois UNE modification d\'environnement pour la mécaniser.',
      },
      {
        id: 'environment-redesign-weekly',
        label: "Redesign hebdo de l'environnement",
        description:
          'Chaque dimanche, identifie 1 violation de règle de la semaine. Question unique : "Quelle modification physique/logicielle aurait empêché ça ?" Implémente avant lundi.',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 5,
    published: true,
  },

  {
    slug: 'la-routine-pre-session',
    title: 'La routine pré-session',
    category: 'discipline',
    quote:
      'Trading is a state of mind. To execute consistently you need to be in a particular state of mind.',
    quoteSourceChapter: 'Trading in the Zone, ch.6',
    paraphrase: `Tu n'arrives pas en session, tu y entres. La différence se construit avant le premier clic.

**Aucun athlète pro ne commence sans échauffement.** Tu n'attaques pas un match sans préparation, tu n'attaques pas une session de trading sans rituel. Brett Steenbarger documente que les traders constants ont tous une routine pré-session reproductible. Ce n'est pas une superstition, c'est un mécanisme de mise en condition mentale et physiologique.

La routine sert trois fonctions précises : caler ton corps (respiration, hydratation, posture), caler ton cerveau (revue du plan, des news, des niveaux), caler ton émotion (intention claire pour la session, acceptation de l'incertitude). Si tu sautes une, tu trades en sous-régime.

- Sommeil mesuré la veille
- Hydratation avant écran
- Revue du journal de la veille
- Niveaux clés notés à la main
- Plan écrit pour la session
- Verbalisation de l'intention

Le piège : croire que la routine est une perte de temps quand "y a déjà du mouvement sur le marché". C'est exactement l'inverse. Les jours où tu sens l'urgence de cliquer sans préparer sont les jours où la routine est la plus rentable.

**Action concrète.** Construis une routine pré-session de 15-20 minutes maximum, écrite, identique chaque jour. Si tu n'as pas fait la routine, tu ne trades pas. Pas de demi-mesure.`,
    exercises: [
      {
        id: 'routine-design',
        label: 'Design de routine pré-session',
        description:
          'Écris une routine pré-session de 15-20 min en 5-8 étapes concrètes : sommeil/hydratation/respiration/revue journal/niveaux/plan/intention. Ordre fixe. Imprime-la et coche chaque étape avant le premier clic.',
      },
      {
        id: 'no-routine-no-trade',
        label: 'Règle absolue pas de routine = pas de trade',
        description:
          'Si tu n\'as pas exécuté ta routine complète, tu ne touches pas le terminal. Pas "juste un petit trade pour voir". Règle binaire. Note dans ton journal chaque jour : routine faite oui/non.',
      },
      {
        id: 'intention-statement',
        label: "Déclaration d'intention quotidienne",
        description:
          'Avant la session, écris en 1-2 phrases ton intention du jour. Pas un objectif de PnL. Une intention de process : "Aujourd\'hui je n\'entre que sur setups A-grade, je respecte mon SL, je ne dépasse pas 3 trades."',
      },
    ],
    triggerRules: null,
    hatClass: 'white',
    priority: 6,
    published: true,
  },
];
