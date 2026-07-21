// S3 — Lecture du classement à l'échelle (1000 membres seedés).
//
// Le scénario le plus robuste de la suite : GET /classement sous charge, avec la
// cohorte de 1000 membres seedée par scripts/seed-stress-cohort.ts. Prouve que la
// lecture leaderboard (couverte par l'index @@index([date, rank]), cf. RESULTS.md
// § EXPLAIN) tient p95 < 800 ms à 1000 lignes.
//
//   k6 run ops/stress/s3-leaderboard-read.js
//   (BASE_URL, S3_VUS surchargeables via -e)

import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, memberEmail, MEMBER_PASSWORD, S3, READ_P95_MS } from './lib/config.js';
import { login, authParams } from './lib/auth.js';

export const options = {
  scenarios: {
    leaderboard_read: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: S3.vus }, // montée
        { duration: '40s', target: S3.vus }, // plateau de charge
        { duration: '10s', target: 0 }, // descente
      ],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:classement}': [`p(95)<${READ_P95_MS}`, 'p(99)<1500'],
  },
};

export function setup() {
  const tokens = [];
  for (let i = 0; i < S3.loginPool; i++) {
    const t = login(memberEmail(i), MEMBER_PASSWORD);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) {
    throw new Error(
      "S3 setup: aucun membre seedé n'a pu se connecter. Lance scripts/seed-stress-cohort.ts " +
        'contre la DB de vérif (port 55432) et vérifie BASE_URL.',
    );
  }
  console.log(`S3 setup: ${tokens.length}/${S3.loginPool} membres seedés connectés`);
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU + __ITER) % data.tokens.length];
  const res = http.get(
    `${BASE_URL}/classement`,
    authParams(token, { tags: { name: 'classement' } }),
  );
  check(res, { 'classement 200': (r) => r.status === 200 });
}
