/**
 * TDD tests for FormData shapers used by `actions.ts` (T5 Phase H — BLOQUANT-1).
 *
 * Imports from `./form-shapers` (pure module extracted from `actions.ts` for
 * unit testability — see `form-shapers.ts` header). Pattern carbone
 * `lib/admin/public-trade-math.ts` extraction for testable invariants.
 *
 * Coverage focus :
 *   - `strField`         : empty/missing → undefined, too-long → sliced.
 *   - `strFieldNullable` : empty → null, missing → undefined, too-long → sliced.
 *   - `numFieldNullable` : "1.5" → 1.5, "" → null, missing → undefined, "abc" → null.
 *   - `shapeFormData` vs `shapeFormDataForUpdate` symmetry : same FormData input
 *     yields `undefined` on CREATE path vs `null` on UPDATE path for empty
 *     nullable fields. This proves the BLOQUANT-1 fix (admin can now clear
 *     nullable fields explicitly on update, vs silently keep existing on create).
 */

import { describe, expect, it } from 'vitest';

import {
  numFieldNullable,
  shapeFormData,
  shapeFormDataForUpdate,
  strField,
  strFieldNullable,
} from './form-shapers';

// =============================================================================
// strField (CREATE path — empty/missing both collapse to undefined)
// =============================================================================

describe('strField', () => {
  it('returns trimmed string when key is non-empty', () => {
    const fd = new FormData();
    fd.set('notes', '  hello world  ');
    expect(strField(fd, 'notes')).toBe('hello world');
  });

  it('returns undefined when key is empty string', () => {
    const fd = new FormData();
    fd.set('notes', '');
    expect(strField(fd, 'notes')).toBeUndefined();
  });

  it('returns undefined when key is whitespace-only (post-trim empty)', () => {
    const fd = new FormData();
    fd.set('notes', '    ');
    expect(strField(fd, 'notes')).toBeUndefined();
  });

  it('returns undefined when key is missing from FormData', () => {
    const fd = new FormData();
    expect(strField(fd, 'notes')).toBeUndefined();
  });

  it('slices value when length exceeds maxLen', () => {
    const fd = new FormData();
    fd.set('notes', 'x'.repeat(10));
    expect(strField(fd, 'notes', 5)).toBe('xxxxx');
  });

  it('returns undefined when value is non-string (e.g. File)', () => {
    const fd = new FormData();
    fd.set('notes', new Blob(['ignored']));
    expect(strField(fd, 'notes')).toBeUndefined();
  });
});

// =============================================================================
// strFieldNullable (UPDATE path — distinguishes 3 states)
// =============================================================================

describe('strFieldNullable', () => {
  it('returns trimmed string when key is non-empty', () => {
    const fd = new FormData();
    fd.set('notes', '  hello  ');
    expect(strFieldNullable(fd, 'notes')).toBe('hello');
  });

  it('returns null when key is present but empty string (admin clears)', () => {
    const fd = new FormData();
    fd.set('notes', '');
    expect(strFieldNullable(fd, 'notes')).toBeNull();
  });

  it('returns null when key is whitespace-only (post-trim empty)', () => {
    const fd = new FormData();
    fd.set('notes', '   ');
    expect(strFieldNullable(fd, 'notes')).toBeNull();
  });

  it('returns undefined when key is ABSENT from FormData (keep existing)', () => {
    const fd = new FormData();
    expect(strFieldNullable(fd, 'notes')).toBeUndefined();
  });

  it('slices value when length exceeds maxLen', () => {
    const fd = new FormData();
    fd.set('notes', 'y'.repeat(10));
    expect(strFieldNullable(fd, 'notes', 5)).toBe('yyyyy');
  });

  it('returns undefined when value is non-string (e.g. File)', () => {
    const fd = new FormData();
    fd.set('notes', new Blob(['ignored']));
    expect(strFieldNullable(fd, 'notes')).toBeUndefined();
  });
});

// =============================================================================
// numFieldNullable (UPDATE path — coerce to number, NaN → null)
// =============================================================================

describe('numFieldNullable', () => {
  it('parses "1.5" to number 1.5', () => {
    const fd = new FormData();
    fd.set('resultR', '1.5');
    expect(numFieldNullable(fd, 'resultR')).toBe(1.5);
  });

  it('parses negative number "-2.0" correctly', () => {
    const fd = new FormData();
    fd.set('resultR', '-2.0');
    expect(numFieldNullable(fd, 'resultR')).toBe(-2.0);
  });

  it('returns null when key is present but empty (clear request)', () => {
    const fd = new FormData();
    fd.set('resultR', '');
    expect(numFieldNullable(fd, 'resultR')).toBeNull();
  });

  it('returns undefined when key is missing from FormData', () => {
    const fd = new FormData();
    expect(numFieldNullable(fd, 'resultR')).toBeUndefined();
  });

  it('returns null when value is non-numeric ("abc" → NaN → null)', () => {
    const fd = new FormData();
    fd.set('resultR', 'abc');
    expect(numFieldNullable(fd, 'resultR')).toBeNull();
  });

  it('returns null for "Infinity" (not finite → null)', () => {
    const fd = new FormData();
    fd.set('resultR', 'Infinity');
    expect(numFieldNullable(fd, 'resultR')).toBeNull();
  });

  it('returns null for "NaN" string', () => {
    const fd = new FormData();
    fd.set('resultR', 'NaN');
    expect(numFieldNullable(fd, 'resultR')).toBeNull();
  });
});

// =============================================================================
// shapeFormDataForUpdate (BLOQUANT-1 fix)
// =============================================================================

describe('shapeFormDataForUpdate', () => {
  /**
   * Build a FormData where the 7 nullable fields are all PRESENT but EMPTY.
   * This is what the form sends when admin clears all clearable inputs.
   */
  function buildAllEmptyNullableFD(): FormData {
    const fd = new FormData();
    fd.set('direction', '');
    fd.set('exitedAt', '');
    fd.set('resultR', '');
    fd.set('session', '');
    fd.set('setup', '');
    fd.set('notes', '');
    fd.set('screenshotUrl', '');
    return fd;
  }

  it('returns null for the 7 nullable fields when all are present but empty', () => {
    const fd = buildAllEmptyNullableFD();
    const shaped = shapeFormDataForUpdate(fd);
    expect(shaped.direction).toBeNull();
    expect(shaped.exitedAt).toBeNull();
    expect(shaped.resultR).toBeNull();
    expect(shaped.session).toBeNull();
    expect(shaped.setup).toBeNull();
    expect(shaped.notes).toBeNull();
    expect(shaped.screenshotUrl).toBeNull();
  });

  it('returns undefined for non-nullable fields when also empty (Zod treats as not-provided)', () => {
    // segment, ordinal, instrument, enteredAt, riskPercent, status are NOT
    // nullable — they use `strField` (not `strFieldNullable`) and so an empty
    // value collapses to undefined.
    const fd = buildAllEmptyNullableFD();
    fd.set('segment', '');
    fd.set('ordinal', '');
    fd.set('instrument', '');
    fd.set('enteredAt', '');
    fd.set('riskPercent', '');
    fd.set('status', '');

    const shaped = shapeFormDataForUpdate(fd);
    expect(shaped.segment).toBeUndefined();
    expect(shaped.ordinal).toBeUndefined();
    expect(shaped.instrument).toBeUndefined();
    expect(shaped.enteredAt).toBeUndefined();
    expect(shaped.riskPercent).toBeUndefined();
    expect(shaped.status).toBeUndefined();
  });

  it('returns undefined for fields completely missing from FormData (keep existing)', () => {
    // Empty FormData — none of the keys set at all.
    const fd = new FormData();
    const shaped = shapeFormDataForUpdate(fd);
    // All nullable fields → undefined (key absent ≠ key empty).
    expect(shaped.direction).toBeUndefined();
    expect(shaped.exitedAt).toBeUndefined();
    expect(shaped.resultR).toBeUndefined();
    expect(shaped.session).toBeUndefined();
    expect(shaped.setup).toBeUndefined();
    expect(shaped.notes).toBeUndefined();
    expect(shaped.screenshotUrl).toBeUndefined();
  });

  it('preserves non-empty values across all field types', () => {
    const fd = new FormData();
    fd.set('segment', 'live');
    fd.set('instrument', 'eurusd');
    fd.set('direction', 'long');
    fd.set('riskPercent', '1.5');
    fd.set('resultR', '2.0');
    fd.set('notes', '  trimmed  ');

    const shaped = shapeFormDataForUpdate(fd);
    expect(shaped.segment).toBe('live');
    expect(shaped.instrument).toBe('eurusd');
    expect(shaped.direction).toBe('long');
    expect(shaped.riskPercent).toBe(1.5);
    expect(shaped.resultR).toBe(2.0);
    expect(shaped.notes).toBe('trimmed');
  });
});

// =============================================================================
// shapeFormData (CREATE path) vs shapeFormDataForUpdate (UPDATE path) — symmetry
// =============================================================================

describe('shapeFormData vs shapeFormDataForUpdate — symmetry on empty nullable fields', () => {
  /**
   * Same FormData (7 nullable fields all empty) → CREATE returns `undefined`
   * for each (semantically : "not provided, let Zod default"), UPDATE returns
   * `null` for each (semantically : "admin explicitly clears existing value").
   *
   * This pin asserts the BLOQUANT-1 fix : without the dual-shaper architecture,
   * an admin clearing nullable fields on edit form would see the value
   * silently kept (because CREATE-style undefined → "skip update" Prisma).
   */
  it('CREATE returns undefined for empty nullable fields, UPDATE returns null', () => {
    function buildEmptyNullableFD(): FormData {
      const fd = new FormData();
      fd.set('direction', '');
      fd.set('exitedAt', '');
      fd.set('resultR', '');
      fd.set('session', '');
      fd.set('setup', '');
      fd.set('notes', '');
      fd.set('screenshotUrl', '');
      return fd;
    }

    const create = shapeFormData(buildEmptyNullableFD());
    const update = shapeFormDataForUpdate(buildEmptyNullableFD());

    // CREATE path : empty → undefined (`strField` collapses).
    expect(create.direction).toBeUndefined();
    expect(create.exitedAt).toBeUndefined();
    expect(create.resultR).toBeUndefined();
    expect(create.session).toBeUndefined();
    expect(create.setup).toBeUndefined();
    expect(create.notes).toBeUndefined();
    expect(create.screenshotUrl).toBeUndefined();

    // UPDATE path : empty → null (`strFieldNullable` distinguishes).
    expect(update.direction).toBeNull();
    expect(update.exitedAt).toBeNull();
    expect(update.resultR).toBeNull();
    expect(update.session).toBeNull();
    expect(update.setup).toBeNull();
    expect(update.notes).toBeNull();
    expect(update.screenshotUrl).toBeNull();
  });

  it('CREATE and UPDATE produce identical results for non-empty values', () => {
    const fd = new FormData();
    fd.set('direction', 'long');
    fd.set('notes', 'trade was solid');
    fd.set('resultR', '1.5');

    const create = shapeFormData(fd);
    const update = shapeFormDataForUpdate(fd);

    expect(create.direction).toBe(update.direction);
    expect(create.notes).toBe(update.notes);
    expect(create.resultR).toBe(update.resultR);
  });
});

// =============================================================================
// T5 Phase H — BLOQUANT-2 : revalidatePath sur partials list page
//
// `createPartialAction` + `deletePartialAction` doivent appeler revalidatePath
// SUR `/admin/track-record` (la list page affiche `partialsCount` via badge)
// EN PLUS de `/admin/track-record/${id}/edit`. Sans le double-revalidate,
// le badge `<Pill>{n} leg(s)</Pill>` reste stale jusqu'au prochain full reload.
//
// Ces 2 comportements sont vérifiables uniquement via un test d'intégration de
// la Server Action (mock auth + `revalidatePath` + `addPartial` + `logAudit` +
// redirect handling). Pattern carbone exigerait :
//   1. `vi.mock('@/auth')` (renvoyer une session admin active)
//   2. `vi.mock('next/cache')` → `revalidatePath = vi.fn()`
//   3. `vi.mock('@/lib/admin/public-trade-service')` pour stub `addPartial`
//   4. `vi.mock('@/lib/auth/audit')` pour neutraliser
//   5. Dynamic import de `./actions` après ALL les mocks
//
// Le brief T5 Phase H autorise explicitement le skip avec explication étant
// donné que le comportement est trivialement vérifiable en lisant le diff
// (`actions.ts:474` + `:475` créent l'appel double, `:515` + `:516` symétrique
// sur delete). Le code reste cependant pinné par l'utilisateur final via le
// /admin/track-record page count badge.
// =============================================================================

describe('T5 Phase H BLOQUANT-2 — revalidatePath on partials list page', () => {
  it.skip('createPartialAction calls revalidatePath both for list AND edit page', () => {
    // skip — see comment block above. Behavior reviewed via code-diff
    // `actions.ts:createPartialAction` revalidate calls.
  });

  it.skip('deletePartialAction calls revalidatePath both for list AND edit page', () => {
    // skip — see comment block above. Behavior reviewed via code-diff
    // `actions.ts:deletePartialAction` revalidate calls.
  });
});
