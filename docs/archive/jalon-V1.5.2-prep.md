# Préparation — Jalon V1.5.2 (cleanup post-V1.5 ship)

> **Statut** : EN ATTENTE — démarrer en nouvelle session avec `/clear` **après** que [PR #35 J10](https://github.com/fxeliott/fxmily/pull/35) soit mergée + PR `feat/v1.5-trading-calibration` mergée + cohorte pilote V1 invitée.
>
> Ce briefing couvre les items différés des audits subagents V1.5 (security-auditor + code-reviewer 2026-05-09). Aucun n'est bloquant pour V1 ship — ce sont des hardenings de défense en profondeur + nice-to-haves.

## 1. Critère "Done" V1.5.2 (verbatim)

V1.5.2 est livré quand :

1. `WeeklySnapshot.memberLabel` (V1.5 pseudonyme) renommé en `pseudonymLabel` pour éliminer la collision sémantique avec `memberLabel` du `WeeklyDigestEmail` (J8 display name).
2. `pseudonymizeMember` étendu à 32 bits (`slice(0, 8)`) avec migration replay des deliveries existantes.
3. Migration rollback recipe documentée.
4. Playwright E2E pour `tradeQuality` + `riskPct` capture/persist/render.
5. Hook `post_tool_fxmily.ps1` race condition résolue définitivement.

---

## 2. Items différés audit V1.5.1 (security + code-reviewer)

### Item #3 — Naming collision `memberLabel` (HIGH code-reviewer)

**Problème** : 2 concepts distincts coexistent sous le même nom :

- `WeeklySnapshot.memberLabel` = pseudonyme `member-A1B2C3` (V1.5, prompt Claude boundary).
- `WeeklyDigestEmail.memberLabel` = display name `"Sophie Martin"` ou `"Membre #abc123"` (J8, email subject + admin reports list).

**Fichiers concernés** :

- `apps/web/src/lib/email/templates/weekly-digest.tsx:164` (PreviewProps utilise nom réel "Sophie Martin")
- `apps/web/src/lib/weekly-report/service.ts:523-528` (`displayMemberLabel(user)` retourne prénom + nom RÉELS)
- `apps/web/src/lib/email/send.ts:208-269`
- `apps/web/src/app/admin/reports/page.tsx:73-79`

**Risque** : un futur dev confondra les 2 et passera un display name au prompt Claude (PII leak vers Anthropic) OU un pseudonyme à l'admin email (Eliot lit `member-A1B2C3` au lieu de "Sophie Martin").

**Fix V1.5.2** : renommer `WeeklySnapshot.memberLabel` → `pseudonymLabel` (ou `memberPseudonym`). Garder `memberLabel` dans email/admin (display name = sémantique J8 inchangée).

**Surface** : ~5 fichiers V1.5 only (builder, builder.test, prompt, claude-client.test, weekly-report.ts schema). Tests fixtures à mettre à jour. Estimé 30 min en autonomie Claude.

### Item #4 — 24-bit slice → 32-bit avant V2 cohort > 1000 (HIGH code-reviewer)

**Problème** : `pseudonymizeMember(userId)[0..6]` = 24 bits = 16M valeurs. Birthday-paradox 50 % collision threshold ≈ **4823 membres**. À n=1000 : P(≥1 collision) ≈ **2.9 %**. À V2 1000+ membres → risque réel d'observation comportementale croisée (fuite d'intégrité).

**Fix V1.5.2 ou V2** : passer à `slice(0, 8)` = 32 bits = 4G valeurs. Birthday 50 % threshold ≈ 77 k membres.

**Migration data** : les `WeeklyReport` historiques contiennent des labels 6-char. Le rename casse la continuité d'observation Eliot ("c'est qui A1B2C3 ?"). Solution : (a) les 2 formats coexistent à V2 launch, (b) admin UI mappe rétrospectivement.

**Estimé** : ~1h en autonomie + 10-20 min DBA replay si historique > 1000 rows.

### Item #5 — Migration rollback recipe (HIGH code-reviewer)

**Problème** : `20260509180000_v1_5_trade_quality_riskpct/migration.sql` est forward-only. Pas de doc rollback dans `runbook-prod-smoke-test.md` ni `runbook-hetzner-deploy.md`.

**Postgres-17 gotcha** : `DROP TYPE "TradeQuality"` échoue si une colonne référence le type. Ordre correct rollback :

```sql
DROP INDEX "trades_user_id_trade_quality_idx";
ALTER TABLE "trades" DROP COLUMN "trade_quality";
ALTER TABLE "trades" DROP COLUMN "risk_pct";
DROP TYPE "TradeQuality";
```

**Fix V1.5.2** : ajouter section "Rollback V1.5 migration" à `docs/runbook-hetzner-deploy.md` avec le SQL above + note "irréversible si déjà des rows avec valeurs non-null — backup avant".

### Item #7 — Defensive guard `pseudonymizeMember('')` ✅ FIXÉ commit `f6539e7`

Ne re-faire pas. Documenté pour traçabilité.

### Item #8 — NFC normalization (LOW security-auditor)

**Problème** : `createHash('sha256').update(userId)` traite UTF-8 directement. Si deux cuids diffèrent uniquement en NFC vs NFD (théorique avec generator hostile / encoding mishap), ils hashent différemment.

**Risque** : extrêmement faible pour cuid (alphanum-only). Mais la fonction est exportée et pourrait être réutilisée pour des identifiants arbitraires en V2.

**Fix V1.5.2 ou V2** : ajouter `userId.normalize('NFC')` au début de `pseudonymizeMember`. 1 ligne.

### L1 — `CREATE INDEX CONCURRENTLY` (LOW security-auditor)

**Problème** : la migration `0009` exécute `CREATE INDEX` sans `CONCURRENTLY`. Sur prod avec QPS élevé, ShareLock bloque les `INSERT/UPDATE/DELETE` sur `trades` quelques secondes.

**V1 30-100 membres** : invisible.
**V2 100+** : à câbler — soit migration `CONCURRENTLY` (incompatible Prisma transaction → migration séparée), soit accepter le brief lock V1.

### #14 — TRADE_QUALITIES const duplication (NICE code-reviewer)

`schemas/trade.ts:22 TRADE_QUALITIES = ['A','B','C']` duplique le Prisma enum `TradeQuality { A B C }`. Si un futur `D` est ajouté à un endroit et pas l'autre, drift.

**Fix V2 nice** : import `TradeQuality` depuis `@/generated/prisma/enums` + `Object.values(TradeQuality)` pour la const Zod. Pattern cohérent avec d'autres enums Prisma exposés.

---

## 3. Hook revert long-term fix `post_tool_fxmily.ps1`

**Problème** : le hook async `prettier --write` sur Edit/Write/NotebookEdit. Si Claude Read le fichier juste après son Edit, il voit le state prettier-reformaté (ex: `4` → `4.0`, ou removal de trailing comma). Perception "revert" alors que c'est juste reformatage.

**Cause confirmée Phase V** : 3 fichiers (scoring constants, builder pseudonym, triggers schema) ont subi ce pattern. Workaround V1.5/V1.5.1 : edits depuis worktree Ichor (project root différent → hook NON chargé pour cette session Claude).

**Fix V1.5.2 — modifier `D:\Fxmily\.claude\hooks\post_tool_fxmily.ps1`** :

```powershell
# Option A : sleep 200 ms avant prettier pour laisser Claude finir tout Read post-Edit.
#  (mais ralentit chaque Edit — peut-être lourd sur sessions intensives)

# Option B : skip si le fichier vient d'être modifié dans les 5 dernières secondes.
#  (race conditions possibles mais plus pragmatique)
$lastModified = (Get-Item $fp).LastWriteTime
$now = Get-Date
if (($now - $lastModified).TotalSeconds -lt 5) {
    # Skip prettier — let lint-staged catch it at commit time.
    exit 0
}

# Option C : invocation synchrone (await) au lieu de async.
#  (fixed by changing settings.json `async: true` → `async: false` pour PostToolUse Edit/Write)
#  Trade-off : chaque Edit attend ~100-300 ms prettier startup. Lourd mais propre.
```

**Recommandation** : Option C (synchrone) — la latence est acceptable et élimine 100 % la race condition. Modifier `D:\Fxmily\.claude\settings.json` `"async": true` → `"async": false` sur PostToolUse Edit/Write/NotebookEdit.

---

## 4. Playwright E2E V1.5 fields

**Items couverts par V1.5/V1.5.1 unit tests** : 18 nouveaux Vitest tests (schemas + builder + service round-trip).

**Items NON couverts** : E2E browser flow capture → persist → render dans `/journal/[id]`.

**Fix V1.5.2** : nouveau spec `apps/web/tests/e2e/wizard-v1-5-fields.spec.ts` :

```ts
test('captures and persists tradeQuality A + riskPct 1.5 end-to-end', async ({ page }) => {
  await loginAs(page, 'member.test@fxmily.local');
  await page.goto('/journal/new');
  // ... fill steps 0-5 ...
  // Step 2: riskPct
  await page.locator('#riskPct').fill('1.5');
  // Step 4: tradeQuality A
  await page.locator('button[role=radio][aria-label*="A"]').click();
  // Submit → redirect /journal/[id]
  await page.locator('button[type=button]:has-text("Sauvegarder")').click();
  await page.waitForURL(/\/journal\/[a-z0-9]+$/);
  // Assert DB row :
  const row = await prisma.trade.findFirst({
    where: {
      /* ... */
    },
    orderBy: { createdAt: 'desc' },
  });
  expect(row?.tradeQuality).toBe('A');
  expect(row?.riskPct?.toString()).toBe('1.5');
});
```

**Estimé** : 30 min en autonomie Claude (réutilise `loginAs` helper J5).

---

## 5. Pickup prompt V1.5.2 (à coller post-`/clear`)

```
Implémente le V1.5.2 du SPEC à `D:\Fxmily\SPEC.md` — cleanup post-V1.5 ship
(naming collision + 32-bit slice + rollback recipe + NFC + Playwright E2E +
hook revert long-term fix).

PRÉ-REQUIS : PR #35 J10 mergée + PR `feat/v1.5-trading-calibration` mergée +
cohorte pilote V1 invitée.

Lis dans cet ordre :
1. SPEC §15 (roadmap)
2. apps/web/CLAUDE.md sections V1.5 + V1.5.1 close-out
3. docs/jalon-V1.5.2-prep.md — briefing complet 5 sections
4. docs/decisions/ADR-001 + ADR-002
5. memory MEMORY.md + fxmily_session_2026-05-09_v1_5_shipped.md

Done quand :
- WeeklySnapshot.memberLabel renommé pseudonymLabel partout (5 fichiers)
- pseudonymizeMember slice(0, 8) avec doc migration data
- runbook-hetzner-deploy.md ajout section "Rollback V1.5 migration"
- post_tool_fxmily.ps1 modifié async:false ou skip-recently-modified
- Playwright E2E tests/e2e/wizard-v1-5-fields.spec.ts (capture + persist + render)
- Vitest tous verts + type-check + lint + build prod

Effort estimé : ~2-3h en autonomie Claude.

Mantra long activé : pleine puissance, autonomie totale, perfection absolue,
control PC OK, anti-hallucination, smoke local obligatoire après chaque fix.
```
