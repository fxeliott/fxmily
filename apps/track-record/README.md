# @fxmily/track-record

> Vitrine publique du track record d'Eliott + de la fxmily.

Sous-app Next.js 16 (App Router) dédiée. Code source dans `apps/track-record/`, lit la table `public_trades` ajoutée à `apps/web/prisma/schema.prisma` (T0 2026-05-21).

## État

**T0 livré 2026-05-21 — branche `feat/track-record-T0`**. Bootstrap + design tokens noir+bleu + page publique avec hero, 8 KPIs (count-up Motion), 11 mois historiques, divider refonte, disclaimer AMF inline. Pas encore wired DB. Voir [`CLAUDE.md`](./CLAUDE.md) pour le statut détaillé et le pickup T1.

## Démarrage local

```bash
# À la racine du monorepo D:\Fxmily
pnpm install                                     # installer les deps de la nouvelle sous-app
pnpm --filter @fxmily/web prisma:generate        # regenerate le client Prisma
pnpm --filter @fxmily/web prisma:migrate dev     # apply migration 20260521172000_*
pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --dry-run --year 2025  # preview seed
pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --year 2025            # actually import
pnpm --filter @fxmily/track-record dev           # localhost:3010
```

## Décisions verrouillées T0

|             |                                                                  |
| ----------- | ---------------------------------------------------------------- |
| Emplacement | Sous-app monorepo `apps/track-record/`                           |
| DA          | Noir+bleu propre au track record (variation thème, validé Eliot) |
| Auth admin  | Reuse Auth.js v5 + role ADMIN (T2)                               |
| Persistance | Table dédiée `public_trades` + `public_trade_partials`           |
| Charts      | Recharts v3 + lightweight-charts v5 fallback                     |

## Roadmap

| Jalon | Contenu                                                                                             | Statut              |
| ----- | --------------------------------------------------------------------------------------------------- | ------------------- |
| T0    | Bootstrap, schema Prisma, seed script, design tokens, page squelette + hero KPIs                    | ✅ livré 2026-05-21 |
| T1    | UI publique complète : equity curve, R distribution, drawdown underwater, heatmap, filtres, DB wire | ⏳                  |
| T2    | UI admin CRUD complète (trades + partials + screenshots R2)                                         | ⏳                  |
| T3    | Deploy Hetzner Caddy `track.fxmilyapp.com` + Sentry + smoke E2E                                     | ⏳                  |

## Compliance AMF

- Performances exclusivement en %, jamais en €/CFD nominal.
- Disclaimer Article 314-14 RGAMF inline (pas footer 9px).
- Pertes affichées avec la même prégnance que les gains.
- Aucune promesse de gain, aucun pourcentage mensuel promis, aucun témoignage chiffré.
