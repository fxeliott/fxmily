import { describe, expect, it, vi } from 'vitest';

import {
  imageNormalizeSemaphore,
  MAX_CONCURRENT_IMAGE_NORMALIZE,
  runWithImageNormalizeLimit,
  Semaphore,
} from './image-normalize-concurrency';

/**
 * Instrumented probe driven by the mocked sharp pipeline's `toBuffer()`. It
 * records how many sharp re-encodes are genuinely mid-flight at once, and a
 * `gate` lets the test hold them open to observe the peak deterministically.
 *
 * Mocking sharp (rather than decoding real images) keeps this test free of the
 * native libvips binary AND lets us prove the exact invariant that matters: the
 * number of concurrent `.toBuffer()` calls is capped by the semaphore. If the
 * limiter is removed from `normalize-image.ts`, this probe's peak jumps to N.
 */
const sharpProbe = vi.hoisted(() => ({
  inFlight: 0,
  peak: 0,
  gate: null as Promise<void> | null,
  reset(): void {
    this.inFlight = 0;
    this.peak = 0;
    this.gate = null;
  },
}));

interface FakeSharpPipeline {
  rotate: () => FakeSharpPipeline;
  resize: () => FakeSharpPipeline;
  jpeg: () => FakeSharpPipeline;
  webp: () => FakeSharpPipeline;
  toBuffer: () => Promise<Buffer>;
}

vi.mock('sharp', () => {
  const makePipeline = (): FakeSharpPipeline => {
    const pipeline: FakeSharpPipeline = {
      rotate: () => pipeline,
      resize: () => pipeline,
      jpeg: () => pipeline,
      webp: () => pipeline,
      toBuffer: async () => {
        sharpProbe.inFlight += 1;
        sharpProbe.peak = Math.max(sharpProbe.peak, sharpProbe.inFlight);
        if (sharpProbe.gate) await sharpProbe.gate;
        sharpProbe.inFlight -= 1;
        // A minimal JPEG-ish buffer; the callers only forward it downstream.
        return Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      },
    };
    return pipeline;
  };
  return { default: () => makePipeline() };
});

// Imported AFTER vi.mock so the module graph picks up the mocked sharp.
const { normalizeProofImage, normalizeAvatarImage } = await import('./normalize-image');

/** Resolve after the current microtask + macrotask queue has drained, so every
 *  chained `acquire → fn → release → next acquire` hop has completed. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A non-HEIC magic-byte prefix (PNG) so `isHeic` returns false and the real
 *  `normalizeProofImage`/`normalizeAvatarImage` proceed into the sharp branch. */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('Semaphore', () => {
  it('never runs more than `max` tasks at once, and completes them all', async () => {
    const LIMIT = 2;
    const N = 6;
    const sem = new Semaphore(LIMIT);

    let inFlight = 0;
    let peak = 0;
    const completed: number[] = [];
    const gates = Array.from({ length: N }, () => deferred<void>());

    const runs = gates.map((gate, index) =>
      sem.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
        completed.push(index);
        return index;
      }),
    );

    // Let the first LIMIT tasks acquire a slot and enter their body; the rest
    // must be queued behind the bound.
    await tick();
    expect(inFlight).toBe(LIMIT);
    expect(sem.activeCount).toBe(LIMIT);

    // Drain the gates one by one. Each release hands the freed slot to the next
    // queued task, so in-flight must stay pinned at the bound the whole time.
    for (const gate of gates) {
      gate.resolve();
      await tick();
      expect(inFlight).toBeLessThanOrEqual(LIMIT);
    }

    const results = await Promise.all(runs);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(completed).toHaveLength(N);
    // The whole point: concurrency never exceeded the configured bound.
    expect(peak).toBe(LIMIT);
    expect(sem.activeCount).toBe(0);
  });

  it('an unbounded gate lets all N run at once (proves the bound is real, not a tautology)', async () => {
    // Same N tasks, but the gate is sized to N → no effective bound. Peak now
    // reaches N. This is exactly what the test above would look like if the
    // semaphore did NOT constrain concurrency — so the `peak === LIMIT`
    // assertion above genuinely depends on the bound.
    const N = 6;
    const sem = new Semaphore(N);

    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: N }, () => deferred<void>());

    const runs = gates.map((gate) =>
      sem.run(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
      }),
    );

    await tick();
    expect(peak).toBe(N);

    for (const gate of gates) gate.resolve();
    await Promise.all(runs);
  });

  it('releases the permit even when the task throws (no permit leak)', async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The single permit must be back — a leak here would deadlock every future
    // caller. This is the `finally`-release invariant.
    expect(sem.activeCount).toBe(0);
    const value = await sem.run(async () => 'recovered');
    expect(value).toBe('recovered');
    expect(sem.activeCount).toBe(0);
  });

  it('rejects a non-positive-integer concurrency', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
    expect(() => new Semaphore(1.5)).toThrow(RangeError);
    expect(() => new Semaphore(Number.NaN)).toThrow(RangeError);
  });
});

describe('runWithImageNormalizeLimit (shared gate)', () => {
  it('bounds concurrency to MAX_CONCURRENT_IMAGE_NORMALIZE across all callers', async () => {
    expect(MAX_CONCURRENT_IMAGE_NORMALIZE).toBe(3);

    imageNormalizeSemaphore.resetPeak();
    let inFlight = 0;
    let peak = 0;
    const N = 9;
    const gates = Array.from({ length: N }, () => deferred<void>());

    const runs = gates.map((gate) =>
      runWithImageNormalizeLimit(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
      }),
    );

    await tick();
    expect(peak).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);
    expect(inFlight).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);

    for (const gate of gates) gate.resolve();
    await Promise.all(runs);
    expect(imageNormalizeSemaphore.activeCount).toBe(0);
  });
});

describe('normalize-image sharp calls route through the shared limiter', () => {
  it('normalizeProofImage caps concurrent sharp re-encodes (fails if the wrap is removed)', async () => {
    imageNormalizeSemaphore.resetPeak();
    sharpProbe.reset();
    const gate = deferred<void>();
    sharpProbe.gate = gate.promise;

    const N = 9; // > MAX so the bound is actually exercised
    const runs = Array.from({ length: N }, () => normalizeProofImage(PNG_MAGIC));

    await tick();
    // Only MAX sharp pipelines may be mid-`toBuffer()` at once. Without the
    // limiter wrapping the sharp call, all N would run and this would be N.
    expect(sharpProbe.peak).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);
    expect(imageNormalizeSemaphore.peakConcurrency).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);

    gate.resolve();
    const results = await Promise.all(runs);

    // Functional identity: every call still resolves to the canonical JPEG shape.
    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);
    const first = results[0];
    if (first?.ok) {
      expect(first.ext).toBe('jpg');
      expect(first.mime).toBe('image/jpeg');
    }
    // The bound held for the whole burst, and no permit leaked.
    expect(sharpProbe.peak).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);
    expect(imageNormalizeSemaphore.activeCount).toBe(0);
  });

  it('proof + avatar normalisers share ONE process-wide sharp bound', async () => {
    imageNormalizeSemaphore.resetPeak();
    sharpProbe.reset();
    const gate = deferred<void>();
    sharpProbe.gate = gate.promise;

    // 6 mixed calls launched at once; the shared limiter must still cap sharp
    // concurrency at MAX regardless of which normaliser drives it.
    const runs = [
      normalizeProofImage(PNG_MAGIC),
      normalizeProofImage(PNG_MAGIC),
      normalizeProofImage(PNG_MAGIC),
      normalizeAvatarImage(PNG_MAGIC),
      normalizeAvatarImage(PNG_MAGIC),
      normalizeAvatarImage(PNG_MAGIC),
    ];

    await tick();
    expect(sharpProbe.peak).toBe(MAX_CONCURRENT_IMAGE_NORMALIZE);

    gate.resolve();
    const results = await Promise.all(runs);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(imageNormalizeSemaphore.activeCount).toBe(0);
  });
});
