import { describe, expect, it } from 'vitest';

import { ADMIN_NOTE_BODY_MAX, adminNoteCreateSchema } from './admin-note';

describe('adminNoteCreateSchema', () => {
  it('accepts a normal note', () => {
    const result = adminNoteCreateSchema.safeParse({
      body: 'Très discipliné cette semaine, respecte son plan de hedge.',
    });
    expect(result.success).toBe(true);
  });

  it('trims the body and NFC-normalizes it (safeFreeText)', () => {
    const parsed = adminNoteCreateSchema.parse({ body: '   bon process  \n  ' });
    expect(parsed.body).toBe('bon process');
  });

  it('preserves internal newlines (multi-paragraph notes)', () => {
    const parsed = adminNoteCreateSchema.parse({ body: 'Point 1.\n\nPoint 2.' });
    expect(parsed.body).toBe('Point 1.\n\nPoint 2.');
  });

  it('rejects an empty body', () => {
    expect(adminNoteCreateSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only body', () => {
    expect(adminNoteCreateSchema.safeParse({ body: '   \n  ' }).success).toBe(false);
  });

  it('rejects a body over the cap', () => {
    const result = adminNoteCreateSchema.safeParse({
      body: 'a'.repeat(ADMIN_NOTE_BODY_MAX + 1),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a body exactly at the cap', () => {
    const result = adminNoteCreateSchema.safeParse({ body: 'a'.repeat(ADMIN_NOTE_BODY_MAX) });
    expect(result.success).toBe(true);
  });

  it('rejects a body with a bidi override (Trojan-Source defense)', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — reordering attack vector.
    const result = adminNoteCreateSchema.safeParse({ body: 'note‮evil' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'body')).toBe(true);
    }
  });

  it('rejects a body with a zero-width space', () => {
    // U+200B ZERO WIDTH SPACE — hidden-content vector.
    expect(adminNoteCreateSchema.safeParse({ body: 'hid​den' }).success).toBe(false);
  });

  it('rejects a missing body field', () => {
    expect(adminNoteCreateSchema.safeParse({}).success).toBe(false);
  });
});
