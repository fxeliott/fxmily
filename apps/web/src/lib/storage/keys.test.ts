import { describe, expect, it } from 'vitest';

import {
  ANNOTATION_KEY_PATTERN,
  TRAINING_ANNOTATION_KEY_PATTERN,
  TRAINING_KEY_PATTERN,
  extensionForMime,
  generateAnnotationKey,
  generateTradeKey,
  generateTrainingAnnotationKey,
  generateTrainingKey,
  isAllowedMime,
  parseAnnotationKey,
  parseStorageKey,
  parseTradeKey,
  parseTrainingAnnotationKey,
  parseTrainingKey,
  sniffImageMime,
} from './keys';
import { keyBelongsTo, trainingKeyBelongsTo } from './local';

describe('isAllowedMime', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (mime) => {
    expect(isAllowedMime(mime)).toBe(true);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', '', 'text/html'])(
    'rejects %s',
    (mime) => {
      expect(isAllowedMime(mime)).toBe(false);
    },
  );
});

describe('extensionForMime', () => {
  it('maps each MIME to its canonical extension', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });
});

describe('generateTradeKey', () => {
  it('produces a key matching the canonical regex', () => {
    const key = generateTradeKey('clx0abc123', 'image/jpeg');
    expect(key).toMatch(/^trades\/clx0abc123\/[a-zA-Z0-9_-]{32}\.jpg$/);
  });

  it('produces unique keys across calls', () => {
    const a = generateTradeKey('clx0abc123', 'image/png');
    const b = generateTradeKey('clx0abc123', 'image/png');
    expect(a).not.toBe(b);
  });

  it('throws on a non-alnum userId (defense against schema drift)', () => {
    expect(() => generateTradeKey('clx0abc..', 'image/jpeg')).toThrow();
    expect(() => generateTradeKey('CLX0ABC', 'image/jpeg')).toThrow();
  });
});

describe('generateAnnotationKey (J4)', () => {
  it('produces a key under the annotations/ prefix', () => {
    const key = generateAnnotationKey('clx0trade1', 'image/png');
    expect(key).toMatch(/^annotations\/clx0trade1\/[a-zA-Z0-9_-]{32}\.png$/);
  });

  it('produces unique keys across calls', () => {
    const a = generateAnnotationKey('clx0trade1', 'image/webp');
    const b = generateAnnotationKey('clx0trade1', 'image/webp');
    expect(a).not.toBe(b);
  });

  it('throws on a malformed tradeId', () => {
    expect(() => generateAnnotationKey('clx0../', 'image/jpeg')).toThrow();
    expect(() => generateAnnotationKey('UPPERCASE', 'image/jpeg')).toThrow();
  });
});

describe('parseTradeKey', () => {
  it('extracts userId, filename, ext from a valid key', () => {
    const key = 'trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    expect(parseTradeKey(key)).toEqual({
      kind: 'trade',
      userId: 'clx0abc123',
      filename: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ext: 'png',
    });
  });

  it.each([
    'trades/clx/short.jpg', // filename too short (< 12)
    'trades/clx/aaaaaaaaaaaa.bmp', // wrong extension
    'trades/CLX/aaaaaaaaaaaa.jpg', // uppercase userId
    'trades/clx/aaaaaaaaaaaa.JPG', // uppercase extension
    'trades/clx//aaaaaaaaaaaa.jpg', // empty userId fragment
    'trades/clx/aaaaaaaaaaaa.jpg/foo', // extra segment
    '../trades/clx/aaaaaaaaaaaa.jpg', // relative escape
    'trades/clx/..bbbbbbbbbb.jpg', // dotdot in filename
    '',
    'random',
    'annotations/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', // wrong prefix
  ])('rejects malformed key: %s', (key) => {
    expect(() => parseTradeKey(key)).toThrow();
  });
});

describe('parseAnnotationKey (J4)', () => {
  it('extracts tradeId, filename, ext from a valid annotation key', () => {
    const key = 'annotations/clx0trade1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp';
    expect(parseAnnotationKey(key)).toEqual({
      kind: 'annotation',
      tradeId: 'clx0trade1',
      filename: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ext: 'webp',
    });
  });

  it.each([
    'annotations/clx/short.jpg', // filename too short
    'annotations/clx/aaaaaaaaaaaa.gif', // disallowed extension
    'annotations/CLX/aaaaaaaaaaaa.jpg', // uppercase tradeId
    'annotations/../escape/aaaaaaaaaaaa.jpg',
    'trades/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', // wrong prefix
    'annotations/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4', // J4.5 not yet
    '',
  ])('rejects malformed annotation key: %s', (key) => {
    expect(() => parseAnnotationKey(key)).toThrow();
  });
});

describe('parseStorageKey (J4)', () => {
  it('discriminates a trade key', () => {
    const parsed = parseStorageKey('trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg');
    expect(parsed.kind).toBe('trade');
    if (parsed.kind === 'trade') {
      expect(parsed.userId).toBe('clx0abc123');
    }
  });

  it('discriminates an annotation key', () => {
    const parsed = parseStorageKey('annotations/clx0trade1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png');
    expect(parsed.kind).toBe('annotation');
    if (parsed.kind === 'annotation') {
      expect(parsed.tradeId).toBe('clx0trade1');
    }
  });

  it('discriminates a training key (J-T2)', () => {
    const parsed = parseStorageKey('training/clx0abc123/cccccccccccccccccccccccccccccccc.webp');
    expect(parsed.kind).toBe('training');
    if (parsed.kind === 'training') {
      expect(parsed.userId).toBe('clx0abc123');
    }
  });

  it('rejects an unknown prefix', () => {
    expect(() => parseStorageKey('uploads/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => parseStorageKey('')).toThrow();
  });
});

describe('ANNOTATION_KEY_PATTERN (J4 SSOT regex)', () => {
  it('matches a canonical annotation key', () => {
    expect(
      ANNOTATION_KEY_PATTERN.test('annotations/clx0trade1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg'),
    ).toBe(true);
  });

  it('rejects a trade-prefixed key', () => {
    expect(
      ANNOTATION_KEY_PATTERN.test('trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'),
    ).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(ANNOTATION_KEY_PATTERN.test('annotations/../escape/aaaaaaaaaaaa.jpg')).toBe(false);
  });
});

describe('keyBelongsTo (J4 — guards against annotation key reuse)', () => {
  it('returns true for a trade key whose userId matches the session', () => {
    expect(
      keyBelongsTo('trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', 'clx0abc123'),
    ).toBe(true);
  });

  it('returns false for an annotation key — annotation ownership goes through DB', () => {
    // This guards against a future "improvement" that would silently treat
    // annotations/{tradeId}/... as if `tradeId` were the userId. Such a
    // change would BOLA the trade-screenshot route into accepting any
    // member's annotation key.
    expect(
      keyBelongsTo('annotations/clx0trade1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', 'clx0trade1'),
    ).toBe(false);
  });

  it('returns false on malformed keys', () => {
    expect(keyBelongsTo('not-a-key', 'clx0abc123')).toBe(false);
  });
});

describe('generateTrainingKey (J-T2 Mode Entraînement)', () => {
  it('produces a key under the training/ prefix matching TRAINING_KEY_PATTERN', () => {
    const key = generateTrainingKey('clx0abc123', 'image/webp');
    expect(key).toMatch(/^training\/clx0abc123\/[a-zA-Z0-9_-]{32}\.webp$/);
    expect(TRAINING_KEY_PATTERN.test(key)).toBe(true);
  });

  it('produces unique keys across calls', () => {
    const a = generateTrainingKey('clx0abc123', 'image/png');
    const b = generateTrainingKey('clx0abc123', 'image/png');
    expect(a).not.toBe(b);
  });

  it('uses the member userId as the path-owner segment (mirror trade, NOT annotation)', () => {
    // The backtest row does not exist yet at upload time — ownership is the
    // uploading member, exactly like J2 trade-screenshot `trades/{userId}/…`.
    const key = generateTrainingKey('clx0member9', 'image/jpeg');
    expect(parseTrainingKey(key).userId).toBe('clx0member9');
  });

  it('throws on a non-alnum userId (defense against schema drift)', () => {
    expect(() => generateTrainingKey('clx0abc..', 'image/jpeg')).toThrow();
    expect(() => generateTrainingKey('CLX0ABC', 'image/jpeg')).toThrow();
  });
});

describe('parseTrainingKey (J-T2 Mode Entraînement)', () => {
  it('extracts userId, filename, ext from a valid training key', () => {
    const key = 'training/clx0abc123/cccccccccccccccccccccccccccccccc.webp';
    expect(parseTrainingKey(key)).toEqual({
      kind: 'training',
      userId: 'clx0abc123',
      filename: 'cccccccccccccccccccccccccccccccc',
      ext: 'webp',
    });
  });

  it.each([
    'training/clx/short.jpg', // filename too short (< 12)
    'training/clx/aaaaaaaaaaaa.bmp', // wrong extension
    'training/CLX/aaaaaaaaaaaa.jpg', // uppercase userId
    'training/clx/aaaaaaaaaaaa.JPG', // uppercase extension
    'training/clx//aaaaaaaaaaaa.jpg', // empty userId fragment
    'training/clx/aaaaaaaaaaaa.jpg/foo', // extra segment
    '../training/clx/aaaaaaaaaaaa.jpg', // relative escape
    'training/clx/..bbbbbbbbbb.jpg', // dotdot in filename
    '',
    'random',
    'trades/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', // wrong prefix
    'training_annotations/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', // J-T3 prefix, not J-T2
  ])('rejects malformed training key: %s', (key) => {
    expect(() => parseTrainingKey(key)).toThrow();
  });
});

describe('TRAINING_KEY_PATTERN (J-T1 SSOT regex, dispatched J-T2)', () => {
  it('matches a canonical training key', () => {
    expect(
      TRAINING_KEY_PATTERN.test('training/clx0abc123/cccccccccccccccccccccccccccccccc.png'),
    ).toBe(true);
  });

  it('rejects a trade-prefixed key', () => {
    expect(
      TRAINING_KEY_PATTERN.test('trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'),
    ).toBe(false);
  });

  it('rejects the J-T3 training_annotations/ prefix (separate SSOT)', () => {
    expect(
      TRAINING_KEY_PATTERN.test('training_annotations/clx0t/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'),
    ).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(TRAINING_KEY_PATTERN.test('training/../escape/aaaaaaaaaaaa.jpg')).toBe(false);
  });
});

describe('trainingKeyBelongsTo (J-T2 — BOLA guard, mirror keyBelongsTo)', () => {
  it('returns true for a training key whose userId matches the session', () => {
    expect(
      trainingKeyBelongsTo(
        'training/clx0abc123/cccccccccccccccccccccccccccccccc.jpg',
        'clx0abc123',
      ),
    ).toBe(true);
  });

  it('returns false when the userId segment does not match the session', () => {
    expect(
      trainingKeyBelongsTo(
        'training/clx0abc123/cccccccccccccccccccccccccccccccc.jpg',
        'clx0other99',
      ),
    ).toBe(false);
  });

  it('returns false for a trade key — never cross-accept another prefix', () => {
    // Guards against a future "improvement" that would let a member attach a
    // trades/{userId}/… screenshot to a backtest (or vice-versa). The
    // training BOLA check must reject every non-training prefix outright.
    expect(
      trainingKeyBelongsTo('trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', 'clx0abc123'),
    ).toBe(false);
  });

  it('returns false on malformed keys', () => {
    expect(trainingKeyBelongsTo('not-a-key', 'clx0abc123')).toBe(false);
  });
});

describe('generateTrainingAnnotationKey (J-T3 admin corrections)', () => {
  it('produces a key under the training_annotations/ prefix matching TRAINING_ANNOTATION_KEY_PATTERN', () => {
    const key = generateTrainingAnnotationKey('clx0tt0001', 'image/png');
    expect(key).toMatch(/^training_annotations\/clx0tt0001\/[a-zA-Z0-9_-]{32}\.png$/);
    expect(TRAINING_ANNOTATION_KEY_PATTERN.test(key)).toBe(true);
  });

  it('produces unique keys across calls', () => {
    const a = generateTrainingAnnotationKey('clx0tt0001', 'image/webp');
    const b = generateTrainingAnnotationKey('clx0tt0001', 'image/webp');
    expect(a).not.toBe(b);
  });

  it('uses the trainingTradeId as the path-owner segment (mirror J4 annotation, NOT the userId)', () => {
    // Admin correction media attaches to the parent backtest, so ownership
    // resolves via a single `db.trainingTrade.findUnique` — exactly the J4
    // `annotations/{tradeId}/…` pattern, never `training/{userId}/…`.
    const key = generateTrainingAnnotationKey('clx0tt0042', 'image/jpeg');
    expect(parseTrainingAnnotationKey(key).trainingTradeId).toBe('clx0tt0042');
  });

  it('throws on a non-alnum trainingTradeId (defense against schema drift)', () => {
    expect(() => generateTrainingAnnotationKey('clx0tt..', 'image/jpeg')).toThrow();
    expect(() => generateTrainingAnnotationKey('CLX0TT', 'image/jpeg')).toThrow();
  });
});

describe('parseTrainingAnnotationKey (J-T3 admin corrections)', () => {
  it('extracts trainingTradeId, filename, ext from a valid key', () => {
    const key = 'training_annotations/clx0tt0001/dddddddddddddddddddddddddddddddd.webp';
    expect(parseTrainingAnnotationKey(key)).toEqual({
      kind: 'training_annotation',
      trainingTradeId: 'clx0tt0001',
      filename: 'dddddddddddddddddddddddddddddddd',
      ext: 'webp',
    });
  });

  it.each([
    'training_annotations/clx/short.jpg', // filename too short (< 12)
    'training_annotations/clx/aaaaaaaaaaaa.bmp', // wrong extension
    'training_annotations/CLX/aaaaaaaaaaaa.jpg', // uppercase id
    'training_annotations/clx/aaaaaaaaaaaa.JPG', // uppercase extension
    'training_annotations/clx//aaaaaaaaaaaa.jpg', // empty id fragment
    'training_annotations/clx/aaaaaaaaaaaa.jpg/foo', // extra segment
    '../training_annotations/clx/aaaaaaaaaaaa.jpg', // relative escape
    'training_annotations/clx/..bbbbbbbbbb.jpg', // dotdot in filename
    '',
    'random',
    'annotations/clx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', // real-edge prefix
    'training/clx0abc123/cccccccccccccccccccccccccccccccc.jpg', // J-T2 member prefix, NOT J-T3
  ])('rejects malformed training annotation key: %s', (key) => {
    expect(() => parseTrainingAnnotationKey(key)).toThrow();
  });
});

describe('parseStorageKey discriminates the J-T3 training_annotation prefix', () => {
  it('dispatches training_annotations/ to the training_annotation kind', () => {
    const parsed = parseStorageKey(
      'training_annotations/clx0tt0001/dddddddddddddddddddddddddddddddd.png',
    );
    expect(parsed.kind).toBe('training_annotation');
    if (parsed.kind === 'training_annotation') {
      expect(parsed.trainingTradeId).toBe('clx0tt0001');
    }
  });

  it('does NOT confuse training_annotations/ with the J-T2 training/ member prefix', () => {
    // `'training_annotations/…'.startsWith('training/')` is false (char 8 is
    // `_`, not `/`) — the prefixes are disjoint. Guard the discriminant so a
    // future refactor can never route an admin correction key to the member
    // BOLA branch (statistical isolation §21.5).
    const parsed = parseStorageKey(
      'training_annotations/clx0tt0001/dddddddddddddddddddddddddddddddd.jpg',
    );
    expect(parsed.kind).toBe('training_annotation');
    expect(parsed.kind).not.toBe('training');
  });
});

describe('sniffImageMime', () => {
  it('detects a JPEG header', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImageMime(bytes)).toBe('image/jpeg');
  });

  it('detects a PNG header', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(sniffImageMime(bytes)).toBe('image/png');
  });

  it('detects a WebP header', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMime(bytes)).toBe('image/webp');
  });

  it('returns null for short buffers', () => {
    expect(sniffImageMime(new Uint8Array([0xff]))).toBeNull();
  });

  it('returns null for unrelated content (PDF magic)', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
    expect(sniffImageMime(bytes)).toBeNull();
  });

  it('returns null for a fake mp4 ftyp header (J4.5 not wired)', () => {
    // mp4 ftyp box at offset 4 = "ftyp" + brand "isom" at offset 8
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    expect(sniffImageMime(bytes)).toBeNull();
  });
});
