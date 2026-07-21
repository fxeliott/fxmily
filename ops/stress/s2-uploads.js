// S2 — Uploads simultanés (50 VUs, preuve MT5 ~5 Mo).
//
// Modélise 50 membres qui envoient leur capture MT5 en même temps. Le vrai
// driver d'OOM identifié par la revue (#8) n'est PAS le buffering de
// `req.formData()` (borné par le pré-check content-length) mais la
// normalisation `sharp` (normalizeProofImage) : sans borne de concurrence, 50
// décodages/re-encodages simultanés d'images ~5 Mo peuvent faire exploser la
// RAM (heap libvips). Ce scénario prouve, sous 50 uploads concurrents :
//   - 0 réponse 5xx (le seuil pass/fail : `upload_server_errors == 0`) ;
//   - le process serveur ne meurt pas (OOM) — surveillé côté driver (RSS).
//
// PRÉREQUIS RÉALISME (BOLA) : l'upload exige une session membre ACTIVE qui
// POSSÈDE un accountId (le contrôle d'accès refuse un accountId non-possédé).
// La cohorte seedée (1000 membres) n'a AUCUN compte MT5 → S2 a besoin d'un
// uploader dédié fourni au run :
//   UPLOAD_EMAIL, UPLOAD_PASSWORD, UPLOAD_ACCOUNT_ID (jamais commités).
// Sans ces variables, setup() échoue avec un message explicite.
//
//   k6 run -e UPLOAD_EMAIL=... -e UPLOAD_PASSWORD=... -e UPLOAD_ACCOUNT_ID=... \
//          ops/stress/s2-uploads.js
//   (le fixture ./fixtures/proof-5mb.jpg doit exister — cf. gen-fixture.mjs)

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, S2, UPLOAD_EMAIL, UPLOAD_PASSWORD, UPLOAD_ACCOUNT_ID } from './lib/config.js';
import { login, authParams } from './lib/auth.js';

// Le fixture est chargé une seule fois au parsing (contexte init), en binaire.
// Il est gitignoré (public repo) — généré localement par gen-fixture.mjs.
const PROOF = open('./fixtures/proof-5mb.jpg', 'b');

// 5xx = échec dur (OOM/crash) → doit rester à 0. Les 4xx attendus sous burst
// (429 rate-limit, 409 dédup, 413 trop gros) ne comptent PAS comme un échec
// serveur : ils prouvent au contraire que les gardes tiennent.
const uploadServerErrors = new Rate('upload_server_errors');
const uploadOk = new Rate('upload_ok');
const uploadDuration = new Trend('upload_duration_ms', true);

export const options = {
  scenarios: {
    uploads_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: S2.vus }, // montée
        { duration: '30s', target: S2.vus }, // 50 uploads concurrents soutenus
        { duration: '10s', target: 0 },
      ],
      gracefulStop: '20s',
    },
  },
  thresholds: {
    // Le critère « Done » de J7 pour S2 : 0 erreur serveur sur la rafale.
    upload_server_errors: ['rate==0'],
  },
};

export function setup() {
  if (!UPLOAD_EMAIL || !UPLOAD_PASSWORD || !UPLOAD_ACCOUNT_ID) {
    throw new Error(
      'S2 setup: UPLOAD_EMAIL / UPLOAD_PASSWORD / UPLOAD_ACCOUNT_ID requis. ' +
        "L'upload MT5 exige un membre actif propriétaire d'un accountId " +
        "(la cohorte seedée n'a pas de compte MT5). Voir README.md § S2.",
    );
  }
  const token = login(UPLOAD_EMAIL, UPLOAD_PASSWORD);
  if (!token) {
    throw new Error('S2 setup: login uploader échoué. Vérifie UPLOAD_EMAIL/PASSWORD + BASE_URL.');
  }
  return { token, accountId: UPLOAD_ACCOUNT_ID };
}

export default function (data) {
  const payload = {
    kind: 'mt5-proof',
    accountId: data.accountId,
    file: http.file(PROOF, 'proof.jpg', 'image/jpeg'),
  };
  const res = http.post(
    `${BASE_URL}/api/uploads`,
    payload,
    authParams(data.token, { tags: { name: 'upload' }, timeout: '60s' }),
  );

  uploadDuration.add(res.timings.duration);
  uploadServerErrors.add(res.status >= 500);
  uploadOk.add(res.status >= 200 && res.status < 300);

  // On documente (sans faire échouer) les statuts non-2xx attendus.
  check(res, {
    'upload pas de 5xx': (r) => r.status < 500,
    'upload traité (2xx) ou borné (4xx attendu)': (r) =>
      (r.status >= 200 && r.status < 300) || [400, 409, 413, 429].includes(r.status),
  });
}
