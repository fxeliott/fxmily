// S1 — Burst de check-ins à 21h (100 VUs).
//
// Modélise le pic réaliste du soir : ~100 membres ouvrent l'app et consultent
// dashboard + check-in + classement en même temps. Mesure que les surfaces
// membre tiennent p95 < 800 ms et 0 5xx sous 100 VUs simultanés.
//
// NOTE RECOMPUTE (le vrai goulot S1) : la soumission d'un check-in du soir passe
// par une Server Action Next.js (pas une route API JSON scriptable stablement),
// qui planifie un recompute de score. Le fan-out de recompute au burst est le
// goulot identifié par la revue (#9). Il est BORNÉ par le sémaphore
// MAX_CONCURRENT_RECOMPUTES=3 (src/lib/scoring/scheduler.ts) — prouvé par
// scheduler.test.ts (3/3) et observable en prod via l'audit
// `cron.recompute_scores.scan` + les logs serveur pendant un vrai burst.
// S1 mesure donc le pic de LECTURE concurrente ; la borne du recompute est
// prouvée séparément (cf. RESULTS.md § Recompute borné).

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, memberEmail, MEMBER_PASSWORD, S1, READ_P95_MS } from './lib/config.js';
import { login, authParams } from './lib/auth.js';

export const options = {
  scenarios: {
    checkin_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: S1.vus },
        { duration: '45s', target: S1.vus },
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Gate the advisory status===200 checks: a run whose tokens silently 307→/login
    // would otherwise pass failed-rate+p95 (k6 counts 307 as non-failed, /login is
    // fast) while measuring /login. This makes a broken-auth run FAIL loudly.
    checks: ['rate>0.99'],
    'http_req_duration{name:dashboard}': [`p(95)<${READ_P95_MS}`],
    'http_req_duration{name:checkin}': [`p(95)<${READ_P95_MS}`],
    'http_req_duration{name:classement}': [`p(95)<${READ_P95_MS}`],
  },
};

export function setup() {
  const tokens = [];
  for (let i = 0; i < S1.loginPool; i++) {
    const t = login(memberEmail(i), MEMBER_PASSWORD);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) {
    throw new Error('S1 setup: aucun membre seedé connecté. Lance le seed + vérifie BASE_URL.');
  }
  console.log(`S1 setup: ${tokens.length}/${S1.loginPool} membres connectés`);
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU + __ITER) % data.tokens.length];
  const p = (name) => authParams(token, { tags: { name } });

  const dash = http.get(`${BASE_URL}/dashboard`, p('dashboard'));
  check(dash, { 'dashboard 200': (r) => r.status === 200 });

  const checkin = http.get(`${BASE_URL}/checkin`, p('checkin'));
  check(checkin, { 'checkin 200': (r) => r.status === 200 });

  const board = http.get(`${BASE_URL}/classement`, p('classement'));
  check(board, { 'classement 200': (r) => r.status === 200 });

  sleep(0.5);
}
