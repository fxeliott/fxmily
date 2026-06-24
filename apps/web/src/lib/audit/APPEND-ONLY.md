# Contrat event-log append-only / horodatage sans écrasement (Session 1)

> **Enrichment Session 1** « event-log / horodatage SANS écrasement ». Ce contrat
> fige l'invariant : les journaux d'audit et d'événements sont **append-only** —
> on **insère** des lignes horodatées, on ne **modifie jamais** une ligne
> existante. La vérité d'un état passé reste reconstituable par relecture du
> journal. L'invariant est **enforcé au CI** par `append-only.guard.test.ts`.

## 1. Pourquoi append-only

Trois propriétés que l'écrasement détruirait et que l'app exige :

1. **Explicabilité** — le score de constance « monte et descend correctement »
   (§31) parce qu'on peut rejouer CHAQUE événement qui l'a bougé. Un `UPDATE`
   sur un événement effacerait la raison historique.
2. **Auditabilité / honnêteté radicale** — une fausse déclaration corrigée plus
   tard doit laisser **trace des deux** états, pas remplacer le premier. C'est le
   cœur du §33 (vérité terrain MT5).
3. **Idempotence des recomputes** — les folds (`constancy.ts`, recompute scores)
   relisent une fenêtre d'événements immuables. Si une ligne pouvait muter, deux
   recomputes du même intervalle pourraient diverger.

## 2. Les journaux append-only (insert-only, jamais d'`update`)

| Modèle           | Schéma                           | Horodatage                                                                      | Écriture autorisée                                                                                                                                                               |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`AuditLog`**   | `prisma/schema.prisma:486-499`   | `createdAt` seul (**pas d'`updatedAt`**)                                        | `db.auditLog.create` uniquement (`lib/auth/audit.ts:460`, helper `logAudit`). Suppression = purge RGPD **groupée** (`lib/audit/cleanup.ts`, `deleteMany`), jamais ligne-à-ligne. |
| **`ScoreEvent`** | `prisma/schema.prisma:2620-2648` | `createdAt` seul (**pas d'`updatedAt`**), `@@index([memberId, createdAt desc])` | `create` / `createMany skipDuplicates` (`lib/verification/reconcile.ts`, `lib/verification/constancy.ts`). Modèle déclaré « event-sourced journal » par son doc-comment.         |

L'**absence d'`updatedAt`** dans ces deux modèles est le signal de design de
l'append-only. Mais Prisma autorise techniquement un `.update()` même sans
`updatedAt` — donc le schéma **ne suffit pas** à garantir l'invariant. D'où le
test garde-fou (§4).

## 3. Ce qui N'EST PAS append-only (cycle de vie assumé)

Ces modèles ont un `updatedAt` et des transitions d'état **légitimes** — ils ne
sont PAS couverts par le garde-fou :

| Modèle            | Transitions légitimes                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| **`Alert`**       | `repeatCount++`, `status: open → delivered → dismissed` (`lib/alerts/*`).               |
| **`Discrepancy`** | `status: open → acknowledged → resolved`, `memberReason` ajouté (`lib/verification/*`). |

Leur mutabilité est **voulue** : une alerte ou un écart a un cycle de vie. Leur
historique d'audit, lui, est porté par les `AuditLog`/`ScoreEvent` append-only
qu'ils émettent.

## 4. Enforcement (le test garde-fou)

`append-only.guard.test.ts` scanne tout `src/**/*.ts(x)` (hors fichiers de test)
et **échoue le build** si un appel `auditLog.update` / `scoreEvent.update`
(`update` | `updateMany` | `upsert`) apparaît. Autorisés : `create`,
`createMany`, `delete`, `deleteMany` (purge RGPD), lectures.

> Pour faire évoluer un journal append-only sans casser l'invariant : ajoute une
> **nouvelle ligne** (un événement de correction/annulation qui référence
> l'ancien), ne **modifie pas** la ligne d'origine.

## 5. Taxonomie des actions — déjà centralisée

- **`AuditAction`** (`lib/auth/audit.ts:26-…`) : union TS canonique (~140 slugs
  `domaine.action`), type-contrainte au seul write-site `logAudit`. **Rien à
  recréer** — Session 1 la reconnaît comme contrat figé.
- **`ScoreEventReason`** : enum Prisma (`filled` | `forgot_no_reason` |
  `reality_gap` | `false_declaration`, `schema.prisma:2352`).
- **Dette connue (hors S1)** : `Alert.triggerType` est un `String` libre borné
  seulement par la constante runtime `ALERT_RULES` (slugs `*_repeat`). Candidat à
  une union TS centralisée — **non implémenté ici** (périmètre alertes, touche du
  code de prod ; à traiter quand une session aval ouvre `lib/alerts`).
