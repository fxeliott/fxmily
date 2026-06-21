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

// jsdom ships no `IntersectionObserver`. framer-motion's `useInView`
// (consumed by AnimatedNumber's count-up gate, and any future scroll-reveal
// component) instantiates one in a mount effect and throws without it. Provide
// an inert stub: `observe` never fires the callback, so in-view stays false and
// the component renders its final/SSR value — exactly the untriggered state we
// assert in unit tests (the real intersection behaviour is proven in-browser).
if (typeof window !== 'undefined' && typeof window.IntersectionObserver !== 'function') {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly scrollMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = IntersectionObserverStub;
  globalThis.IntersectionObserver = IntersectionObserverStub;
}
