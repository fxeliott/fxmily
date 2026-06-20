import '@testing-library/jest-dom/vitest';

// Vitest setup file. Add global stubs / matchers here.
//
// We deliberately do NOT mock `process.env` here — tests that need specific
// env values should set them via `vi.stubEnv()` to keep state isolated.

// jsdom (used by `// @vitest-environment jsdom` test files) ships no
// `window.matchMedia`. Components that mount `useReducedMotion()` / `useCountUp()`
// call it, so provide a no-op stub (reduced-motion OFF). Guarded for the default
// `node` environment where `window` is undefined.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
