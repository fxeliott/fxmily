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
];
