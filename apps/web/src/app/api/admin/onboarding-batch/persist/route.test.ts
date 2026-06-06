import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CP13 — Tests for POST /api/admin/onboarding-batch/persist (V2.4 Phase A.2).
 *
 * Closes the route-coverage asymmetry : weekly-batch + monthly-batch both had
 * persist/pull route tests, onboarding-batch did not — despite carrying the
 * jalon-B onboarding-safety hardening (anti-skip Sentry escalation). These
 * tests pin the route handler's defensive layers as a non-regression net.
 *
 * Pattern carbone `weekly-batch/persist/route.test.ts`, adapted to the
 * onboarding wire contract :
 *   - validation error key is `validation_failed` (NOT `envelope_validation_failed`)
 *   - body shape is `{ results: [...] }` (no weekStart/weekEnd envelope)
 *   - `body_read_failed` escalates via `reportWarning` (NOT `reportError`)
 *   - the 500 catch emits `reportError` only (no audit row, unlike weekly)
 *
 * What we pin :
 *   - 401 missing / wrong X-Admin-Token (auth gate wired)
 *   - 405 GET
 *   - 400 empty body
 *   - 400 invalid JSON
 *   - 400 validation_failed (empty results array — schema min(1))
 *   - 400 validation_failed (malformed entry — output too short)
 *   - 413 Content-Length declared too large (cheap header reject)
 *   - 413 UTF-8 byte length > 16 MiB (emoji amplification, spoofed Content-Length)
 *   - 400 body_read_failed + reportWarning when req.text() rejects
 *   - happy path returns { ok, persisted, skipped, errors, total }
 *   - 500 + reportError when persistGeneratedProfiles throws
 */

const TEST_TOKEN = 'test_admin_batch_token_64_hex_dummy_value_aaaaaaaaaaaaaaaaaaaaaaaa';

const persistMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const reportErrorMock = vi.fn<(...args: unknown[]) => unknown>();
const reportWarningMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/onboarding-interview/batch', () => ({
  persistGeneratedProfiles: persistMock,
}));

vi.mock('@/lib/observability', () => ({
  reportError: reportErrorMock,
  reportWarning: reportWarningMock,
  flushSentry: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: {
    ADMIN_BATCH_TOKEN: TEST_TOKEN,
  },
}));

const { POST, GET } = await import('./route');

beforeEach(() => {
  persistMock.mockReset();
  reportErrorMock.mockReset();
  reportWarningMock.mockReset();
});

function makeRequest(opts: {
  token?: string;
  ip: string;
  body?: string;
  declaredLength?: number;
}): Request {
  const url = 'https://app.fxmilyapp.com/api/admin/onboarding-batch/persist';
  const headers: Record<string, string> = {
    'x-forwarded-for': opts.ip,
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) headers['x-admin-token'] = opts.token;
  if (opts.declaredLength !== undefined) {
    headers['content-length'] = String(opts.declaredLength);
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.body ?? '',
  });
}

/**
 * A `MemberProfileOutput` that passes the real `memberProfileOutputSchema`
 * (we use the REAL schema, not a mock — it's a pure module with no DB/env).
 * Bounds: summary 100-800 chars, highlights 3-7, axes_prioritaires 3-5.
 */
const VALID_OUTPUT = {
  summary:
    "Membre méthodique qui structure ses sessions de trading autour d'un plan écrit et " +
    'documenté. Il reconnaît ses moments de FOMO et travaille activement sa patience ainsi ' +
    'que sa discipline au quotidien, sans se précipiter sur les entrées.',
  highlights: [
    {
      key: 'discipline-plan',
      label: 'Suit un plan écrit avant chaque session',
      evidence: ['je note toujours mon plan avant de trader'],
    },
    {
      key: 'patience-fomo',
      label: 'Travaille activement sa patience',
      evidence: ["j'attends que mon setup se présente"],
    },
    {
      key: 'uncertainty-acceptance',
      label: "Accepte l'incertitude du marché",
      evidence: ['je sais que tout peut arriver sur un trade'],
    },
  ],
  axes_prioritaires: [
    'Renforcer la routine de préparation pré-session',
    'Réduire les entrées impulsives déclenchées par la FOMO',
    'Consolider la gestion du risque par trade',
  ],
};

const VALID_BODY = JSON.stringify({
  results: [
    {
      userId: 'cuid_test_member_a',
      interviewId: 'cuid_test_interview_a',
      output: VALID_OUTPUT,
    },
  ],
});

describe('GET /api/admin/onboarding-batch/persist', () => {
  it('returns 405 method_not_allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});

describe('POST /api/admin/onboarding-batch/persist — auth gate', () => {
  it('returns 401 when X-Admin-Token missing', async () => {
    const res = await POST(makeRequest({ ip: '10.82.0.1', body: VALID_BODY }) as never);
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 401 when X-Admin-Token is wrong', async () => {
    const res = await POST(
      makeRequest({ token: 'WRONG' + 'a'.repeat(60), ip: '10.82.0.2', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/onboarding-batch/persist — body validation', () => {
  it('returns 400 on empty body', async () => {
    const res = await POST(makeRequest({ token: TEST_TOKEN, ip: '10.82.0.3', body: '' }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('empty_body');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.82.0.4', body: '{not_json' }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 validation_failed when results array is empty (schema min 1)', async () => {
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.82.0.5',
        body: JSON.stringify({ results: [] }),
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_failed');
    expect(body.issues).toBeInstanceOf(Array);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 validation_failed on malformed entry (output too short, no highlights/axes)', async () => {
    const malformed = JSON.stringify({
      results: [
        {
          userId: 'cuid_test_member_a',
          interviewId: 'cuid_test_interview_a',
          output: { summary: 'trop court' },
        },
      ],
    });
    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.82.0.6', body: malformed }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_failed');
    expect(typeof body.issuesCount).toBe('number');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 413 when declared Content-Length exceeds MAX_BODY_BYTES', async () => {
    const TWENTY_MIB = 20 * 1024 * 1024;
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.82.0.7',
        body: VALID_BODY,
        declaredLength: TWENTY_MIB,
      }) as never,
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe('payload_too_large');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 413 when UTF-8 byte length > 16 MiB even if Content-Length lies', async () => {
    // Pin the post-read Buffer.byteLength('utf8') defense — 4-byte codepoints
    // (🚀) inflate the wire size 2-4× vs JS UTF-16 char count. The structure
    // need not be Zod-valid : the 413 fires BEFORE Zod parsing.
    const emoji = '🚀'; // 4 UTF-8 bytes per char
    const oversizedSummary = emoji.repeat(5_000_000); // ~20 MiB UTF-8
    const body = JSON.stringify({
      results: [
        {
          userId: 'cuid_emoji_test',
          interviewId: 'cuid_emoji_interview',
          output: { summary: oversizedSummary, highlights: [], axes_prioritaires: [] },
        },
      ],
    });
    const res = await POST(
      makeRequest({
        token: TEST_TOKEN,
        ip: '10.82.0.8',
        body,
        declaredLength: 100, // lying low to bypass the cheap header check
      }) as never,
    );
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe('payload_too_large');
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('returns 400 body_read_failed + reportWarning when req.text() rejects', async () => {
    // Pin the try/catch around req.text(). If the underlying ReadableStream
    // errors mid-read, return a clear 400 and escalate via reportWarning
    // (NOT reportError — divergence from weekly-batch).
    const req = new Request('https://app.fxmilyapp.com/api/admin/onboarding-batch/persist', {
      method: 'POST',
      headers: {
        'x-admin-token': TEST_TOKEN,
        'x-forwarded-for': '10.82.0.9',
        'content-type': 'application/json',
      },
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error('simulated_stream_abort'));
        },
      }),
      // @ts-expect-error — duplex is required when body is a ReadableStream
      duplex: 'half',
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('body_read_failed');
    expect(reportWarningMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/onboarding-batch/persist — happy path', () => {
  it('returns { ok, persisted, skipped, errors, total } on success', async () => {
    persistMock.mockResolvedValueOnce({ persisted: 1, skipped: 0, errors: 0 });

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.82.0.10', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, persisted: 1, skipped: 0, errors: 0, total: 1 });
    expect(persistMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/onboarding-batch/persist — error path', () => {
  it('returns 500 + reportError when persistGeneratedProfiles throws', async () => {
    persistMock.mockRejectedValueOnce(new Error('db_unreachable'));

    const res = await POST(
      makeRequest({ token: TEST_TOKEN, ip: '10.82.0.11', body: VALID_BODY }) as never,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('batch_persist_failed');
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });
});
