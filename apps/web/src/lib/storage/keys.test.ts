import { describe, expect, it } from 'vitest';

import {
  extensionForMime,
  generateTradeKey,
  isAllowedMime,
  parseTradeKey,
  sniffImageMime,
} from './keys';

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

describe('parseTradeKey', () => {
  it('extracts userId, filename, ext from a valid key', () => {
    const key = 'trades/clx0abc123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    expect(parseTradeKey(key)).toEqual({
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
  ])('rejects malformed key: %s', (key) => {
    expect(() => parseTradeKey(key)).toThrow();
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
});
