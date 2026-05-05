# Pull Request

## Contexte

<!-- Pourquoi ce PR ? Quel jalon / issue / SPEC §X ? -->

## Changements

<!-- Liste courte des changements significatifs -->

-

## Type

<!-- Coche ce qui s'applique -->

- [ ] feat (nouvelle fonctionnalité)
- [ ] fix (bug)
- [ ] chore / refactor / perf
- [ ] docs
- [ ] test / ci / build

## Jalon

<!-- Ex: J1, J2, etc. -->

## Checklist avant merge

- [ ] `pnpm format:check && pnpm lint && pnpm type-check && pnpm build` — tout vert local
- [ ] Tests ajoutés / mis à jour (si logique métier critique)
- [ ] Pas de secret committé (vérifier `git diff`)
- [ ] Conventional Commits respectés
- [ ] Migration Prisma incluse si schéma touché
- [ ] Doc mise à jour (`SPEC.md`, `CLAUDE.md`, ou `docs/`) si comportement change

## Captures écran / preuves

<!-- Pour UI : screenshot mobile + desktop. Pour API : curl / réponse. -->

## Risques / rollback

<!-- Y a-t-il un risque non trivial ? Comment annuler si problème en prod ? -->
