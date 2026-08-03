/**
 * J9 — the version strings the two watchdogs ACTUALLY emit.
 *
 * These are not decoration. `labelEmittedByServer` in `health.ts` decides which
 * machine's repair command a label card prints, and it decides it by reading
 * this string off the heartbeat. A test that feeds it an invented value proves
 * nothing about production: the first version of that test used `v4`/`v4-obs`,
 * which no emitter has ever written, and it passed against code that would have
 * printed a PowerShell command for a Linux fault.
 *
 * `watchdog-versions.guard.test.ts` reads both emitter scripts and asserts these
 * three constants are what they compose. Bump `WATCHDOG_VERSION` in the shell
 * script and that guard goes red — which is the point. Do not "fix" it by
 * editing these constants without re-reading the scripts.
 */

/** `ops/cron/fxmily-worker-watchdog` — base, before any suffix. */
export const SERVER_WATCHDOG_VERSION_BASE = 'j9-1.0';

/**
 * Server watchdog, observation window OFF (`FXMILY_WORKER_DRY_RUN=0`).
 * The `-srv` marker is appended unconditionally, so the server stays
 * identifiable after the observation window closes — the one window where a
 * real generation failure can occur while `WORKER_HOST` still says `pc`.
 */
export const SERVER_WATCHDOG_VERSION_LIVE = 'j9-1.0-srv';

/** Server watchdog, observation window ON (`FXMILY_WORKER_DRY_RUN=1`, the default). */
export const SERVER_WATCHDOG_VERSION_OBSERVING = 'j9-1.0-srv-obs';

/** `ops/worker/watchdog.ps1` — the Windows watchdog. Shares no marker with the server. */
export const PC_WATCHDOG_VERSION = '1.1.0';
