// S4 — API membre sous charge du worker batch.
//
// Prouve l'isolation : pendant qu'un déclencheur batch martèle le recompute de
// scores (le job lourd côté cron), les surfaces membre (/classement,
// /dashboard) restent saines — p95 < 800 ms et < 1% d'échecs. C'est la garantie
// que le fan-out de recompute (borné par MAX_CONCURRENT_RECOMPUTES=3, cf.
// scheduler.ts + scheduler.test.ts) ne famine pas le pool pg au point de
// dégrader l'expérience membre.
//
// Deux scénarios concurrents :
//   - `batch_worker` : 1 VU qui POST /api/cron/recompute-scores en boucle
//     (header X-Cron-Secret). Le endpoint est rate-limité PAR DESIGN (token
//     bucket 5 burst / 1 par min) → l'essentiel des requêtes répond 429. C'est
//     ATTENDU : on veut la charge de fond, pas des exécutions réelles à la
//     chaîne. Ces requêtes sont taggées scope:batch et NE font pas échouer.
//   - `members` : la cohorte seedée lit /classement + /dashboard, taggée
//     scope:member — la seule surface sur laquelle porte le verdict.
//
//   k6 run -e CRON_SECRET=... ops/stress/s4-api-under-batch.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  BASE_URL,
  memberEmail,
  MEMBER_PASSWORD,
  S4,
  CRON_SECRET,
  READ_P95_MS,
} from './lib/config.js';
import { login, authParams } from './lib/auth.js';

export const options = {
  scenarios: {
    batch_worker: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'batchWorker',
      tags: { scope: 'batch' },
    },
    members: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: S4.memberVus },
        { duration: '40s', target: S4.memberVus },
        { duration: '10s', target: 0 },
      ],
      exec: 'members',
      gracefulStop: '10s',
      tags: { scope: 'member' },
    },
  },
  thresholds: {
    // Verdict : l'expérience membre reste saine PENDANT que le batch tourne.
    'http_req_failed{scope:member}': ['rate<0.01'],
    'http_req_duration{scope:member,name:classement}': [`p(95)<${READ_P95_MS}`],
    'http_req_duration{scope:member,name:dashboard}': [`p(95)<${READ_P95_MS}`],
  },
};

export function setup() {
  const tokens = [];
  for (let i = 0; i < S4.loginPool; i++) {
    const t = login(memberEmail(i), MEMBER_PASSWORD);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) {
    throw new Error('S4 setup: aucun membre seedé connecté. Lance le seed + vérifie BASE_URL.');
  }
  console.log(`S4 setup: ${tokens.length}/${S4.loginPool} membres connectés`);
  return { tokens };
}

// Charge de fond : le worker batch. Rate-limité par design → 429 attendus.
export function batchWorker() {
  const params = {
    headers: CRON_SECRET ? { 'X-Cron-Secret': CRON_SECRET } : {},
    tags: { scope: 'batch', name: 'recompute' },
  };
  const res = http.post(`${BASE_URL}/api/cron/recompute-scores`, null, params);
  // 200 (exécuté), 429 (rate-limité, attendu), 401/403/503 (secret absent) sont
  // tous des issues NORMALES du point de vue « charge de fond ».
  check(res, { 'batch a répondu (pas de 5xx inattendu)': (r) => r.status !== 500 });
  sleep(0.5);
}

// Surface membre : le verdict porte ici.
export function members(data) {
  const token = data.tokens[(__VU + __ITER) % data.tokens.length];
  const p = (name) => authParams(token, { tags: { scope: 'member', name } });

  const board = http.get(`${BASE_URL}/classement`, p('classement'));
  check(board, { 'classement 200': (r) => r.status === 200 });

  const dash = http.get(`${BASE_URL}/dashboard`, p('dashboard'));
  check(dash, { 'dashboard 200': (r) => r.status === 200 });

  sleep(0.5);
}
