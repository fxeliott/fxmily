/**
 * J10 correctif n°2 — LA tolérance de dérive d'horloge, en un seul endroit.
 *
 * ## Pourquoi une marge existe
 *
 * Le mur horaire est `now` : on ne prend ni ne clôture une position dans le
 * futur. Mais l'instant soumis est construit à partir de l'horloge du
 * NAVIGATEUR (les champs `datetime-local` sont pré-remplis côté client), puis
 * réinterprété par le serveur dans le fuseau du membre. Deux horloges, donc un
 * écart possible sur une machine mal synchronisée. Sans marge, un membre qui ne
 * touche à rien verrait son propre pré-remplissage rejeté — le pire des refus,
 * puisqu'il ne peut rien y faire.
 *
 * La dérive de FUSEAU, elle, est déjà neutralisée en amont : le wizard
 * interprète l'heure murale dans le fuseau du membre avant de valider
 * (`trade-form-wizard.tsx`, correctif F2). Ce qui reste est la dérive
 * d'HORLOGE, et elle seule.
 *
 * ## Pourquoi 5 minutes, et pas un chiffre choisi au jugé
 *
 * C'est la valeur de référence de l'industrie pour la dérive tolérée entre un
 * client et un serveur : RFC 4120 (Kerberos V5) §1.6 — « the degree of
 * "looseness" can be configured on a per-server basis, but it is typically on
 * the order of 5 minutes » [https://www.rfc-editor.org/rfc/rfc4120.txt,
 * consulté le 2026-08-07].
 *
 * Un premier jet avait posé 2 minutes. Une revue en contexte frais a mesuré ce
 * que ça coûte : un appareil en avance de 3 minutes passe la validation
 * CLIENT (qui compare à la même horloge fausse) et se fait refuser par le
 * SERVEUR, sur une valeur que le membre n'a jamais saisie. 2 minutes était
 * aussi en contradiction avec la justification écrite juste au-dessus, qui
 * parle de « quelques minutes ».
 *
 * ## Ce que cette constante gouverne, et pourquoi c'est la MÊME partout
 *
 *   • `tradeOpenSchema.enteredAt`      — entrée dans le futur ;
 *   • `tradeCloseSchema.exitedAt`      — sortie dans le futur ;
 *   • `trainingTradeCreateSchema`      — même règle pour un backtest, qui se
 *     déclarait « EXACT mirror » tout en gardant l'ancienne heure ;
 *   • `scripts/data-hygiene.ts`        — le seuil au-delà duquel un
 *     `exited_at > GREATEST(closed_at, entered_at)` cesse d'être une dérive
 *     d'horloge ordinaire pour devenir une aberration à corriger.
 *
 * Les deux premières doivent être ÉGALES, sans quoi un trade accepté à
 * l'ouverture peut devenir inclôturable (`closeTrade` exige
 * `exitedAt >= enteredAt`). La dernière doit être la même, sans quoi l'outil
 * d'hygiène « corrigerait » des lignes parfaitement normales.
 *
 * ⚠️ Cette liste est vérifiée par revue, pas par un test : si un cinquième
 * site apparaît sans y figurer, rien ne le signalera. Le garde qui compte
 * vraiment est ailleurs — l'invariant « aucun trade inclôturable »
 * (`trade.test.ts`) interroge les schémas au lieu de lire cette constante,
 * donc il tombe dès que deux d'entre eux divergent.
 *
 * Ce module ne dépend de RIEN : c'est ce qui permet au script de l'importer
 * sans traîner Zod ni les alias `@/` que `tsx` ne résout pas.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
