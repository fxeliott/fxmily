import 'server-only';

/**
 * Bounded-concurrency gate for sharp/libvips image normalisation (J7 stress-test
 * fix — bottleneck #8).
 *
 * Every `normalizeProofImage` / `normalizeAvatarImage` call decodes then
 * re-encodes an image through libvips. A ~5 MiB MT5 proof decodes to tens of MiB
 * of uncompressed pixel buffers for the whole resize pipeline. The upload route
 * already bounds the *buffering* of `req.formData()` via a Content-Length
 * pre-check — but nothing bounded the *normalisation* itself: under a burst of
 * 50 simultaneous MT5 proof uploads, 50 libvips decode/encode pipelines would
 * run at once and blow the container's RAM (OOM).
 *
 * A small semaphore keeps at most `MAX_CONCURRENT_IMAGE_NORMALIZE` normalisations
 * in flight; the rest await a free slot and drain as slots free up. The
 * FUNCTIONAL result is unchanged — we only add a bounded queue in front of the
 * sharp call. Same pattern as the recompute scheduler
 * (`lib/scoring/scheduler.ts::MAX_CONCURRENT_RECOMPUTES`).
 *
 * Single-instance V1 (Hetzner). A multi-instance V2 would move this to a shared
 * limiter (Redis token bucket) without changing the call sites.
 */

/**
 * Max libvips normalisation pipelines allowed to run at once, across the whole
 * process (proofs + avatars share the SAME libvips memory, so the cap is
 * global). Kept at 3 — matching `MAX_CONCURRENT_RECOMPUTES` — a fraction of the
 * container RAM budget while still overlapping enough work to keep the upload
 * path responsive under a burst.
 */
export const MAX_CONCURRENT_IMAGE_NORMALIZE = 3;

/**
 * Minimal async semaphore. Carbon copy of the acquire/release logic in
 * `lib/scoring/scheduler.ts` (direct hand-off to the next waiter so the active
 * count never dips between a release and the next acquire), wrapped as a small
 * reusable class so the concurrency bound is unit-testable in isolation.
 */
export class Semaphore {
  private active = 0;
  /** Highest `active` value ever reached — test-only observability. */
  private peak = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new RangeError(`Semaphore concurrency must be a positive integer, got ${String(max)}`);
    }
  }

  /** Acquire one slot, awaiting a free one if the cap is reached. */
  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      if (this.active > this.peak) this.peak = this.active;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Release a slot, handing it straight to the next waiter if any. */
  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot over directly — `active` stays unchanged, so a waiter can
      // never observe a transient dip below the cap.
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  /**
   * Run `fn` once a slot is free. The slot is released in `finally`, so a
   * throwing `fn` (e.g. sharp on corrupt bytes) never leaks a permit.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Test-only: current number of in-flight runs. */
  get activeCount(): number {
    return this.active;
  }

  /** Test-only: highest concurrency ever observed since the last reset. */
  get peakConcurrency(): number {
    return this.peak;
  }

  /** Test-only: reset the peak watermark between assertions. */
  resetPeak(): void {
    this.peak = this.active;
  }
}

/**
 * Process-wide gate shared by every sharp normalisation. Exported so tests can
 * assert the peak concurrency actually stayed within the bound after a burst.
 */
export const imageNormalizeSemaphore = new Semaphore(MAX_CONCURRENT_IMAGE_NORMALIZE);

/**
 * Run an image-normalisation `fn` (a sharp pipeline `.toBuffer()`) behind the
 * shared concurrency bound. Callers wrap ONLY the sharp work — validation and
 * the typed-rejection mapping stay outside the gate so a queued upload does not
 * hold a slot while it is merely being sniffed.
 */
export function runWithImageNormalizeLimit<T>(fn: () => Promise<T>): Promise<T> {
  return imageNormalizeSemaphore.run(fn);
}
