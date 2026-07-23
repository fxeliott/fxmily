import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectPlatform, isStandalone } from './platform';

describe('detectPlatform', () => {
  it('detects iOS from an iPhone UA', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua)).toBe('ios');
  });

  it('detects iOS from an iPad UA', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(detectPlatform(ua)).toBe('ios');
  });

  it('detects iOS from an iPod UA', () => {
    expect(detectPlatform('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)')).toBe(
      'ios',
    );
  });

  it('detects Android from an Android phone UA', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    expect(detectPlatform(ua)).toBe('android');
  });

  it('falls back to desktop for a Windows Chrome UA', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    expect(detectPlatform(ua)).toBe('desktop');
  });

  it('falls back to desktop for a macOS Safari UA', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(detectPlatform(ua)).toBe('desktop');
  });

  it('detects an iPad masquerading as a macOS Safari UA via maxTouchPoints', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(detectPlatform(ua, 5)).toBe('ios');
  });

  it('keeps a real Mac (maxTouchPoints 0) as desktop despite the Macintosh UA', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(detectPlatform(ua, 0)).toBe('desktop');
  });

  it('falls back to desktop for an empty UA', () => {
    expect(detectPlatform('')).toBe('desktop');
  });

  it('is case-insensitive', () => {
    expect(detectPlatform('SOMETHING-IPHONE-SOMETHING')).toBe('ios');
    expect(detectPlatform('SOMETHING-ANDROID-SOMETHING')).toBe('android');
  });
});

describe('isStandalone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false during SSR (window is undefined in the node test env)', () => {
    // Vitest's default environment is `node`, so there is no `window` here —
    // this exercises the SSR guard branch directly.
    expect(typeof window).toBe('undefined');
    expect(isStandalone()).toBe(false);
  });

  it('returns true when the legacy iOS navigator.standalone flag is set', () => {
    vi.stubGlobal('window', {
      navigator: { standalone: true },
      matchMedia: () => ({ matches: false }),
    });
    expect(isStandalone()).toBe(true);
  });

  it('returns true when the display-mode:standalone media query matches', () => {
    vi.stubGlobal('window', {
      navigator: {},
      matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' }),
    });
    expect(isStandalone()).toBe(true);
  });

  it('returns false when neither standalone signal is present', () => {
    vi.stubGlobal('window', {
      navigator: {},
      matchMedia: () => ({ matches: false }),
    });
    expect(isStandalone()).toBe(false);
  });

  it('returns false (fails closed) when matchMedia throws', () => {
    vi.stubGlobal('window', {
      navigator: {},
      matchMedia: () => {
        throw new Error('SecurityError');
      },
    });
    expect(isStandalone()).toBe(false);
  });

  it('returns false when there is no matchMedia and no standalone flag', () => {
    vi.stubGlobal('window', { navigator: {} });
    expect(isStandalone()).toBe(false);
  });
});
