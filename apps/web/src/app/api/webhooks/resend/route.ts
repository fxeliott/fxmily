import { NextResponse, type NextRequest } from 'next/server';
import { Resend } from 'resend';

import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { normalizeEmail, upsertSuppression, type SuppressionReason } from '@/lib/email/suppression';
import { flushSentry, reportError, reportInfo, reportWarning } from '@/lib/observability';

/**
 * Webhook Resend (J2) — bounce / complaint / delivery.
 *
 * Resend signe chaque livraison avec svix (standard webhooks). Cet endpoint :
 *   1. refuse de tourner sans `RESEND_WEBHOOK_SECRET` (503, route désarmée) ;
 *   2. lit le corps BRUT (`req.text()`) — svix signe les octets exacts, donc on
 *      ne re-sérialise JAMAIS via `req.json()` ;
 *   3. vérifie la signature (invalide → 400, JAMAIS 500 : un 5xx ferait retenter
 *      Resend à l'infini sur une requête forgée) ;
 *   4. persiste chaque événement de façon idempotente (clé = en-tête `svix-id`,
 *      unique en base ; un rejeu lève P2002 → on acquitte sans rejouer) ;
 *   5. alimente la liste de suppression sur hard bounce / plainte.
 *
 * Wiring prod attendu (Resend Dashboard → Webhooks) :
 *   https://app.fxmilyapp.com/api/webhooks/resend
 *
 * PII : aucun log/Sentry ne porte l'adresse, le sujet ou le payload. Les extras
 * se limitent à des compteurs + le type d'événement + le `svix-id` (SPEC §16).
 */

// Lit env + DB + vérifie une signature Node → doit tourner sur Node.js, pas Edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Vérificateur de signature. `webhooks.verify()` instancie en interne
 * `new svix.Webhook(secret)` depuis les node_modules de `resend` — inutile donc
 * d'ajouter `svix` à ce package ou de l'importer ici. Le constructeur `Resend`
 * ne lève que si la clé est absente ET `process.env.RESEND_API_KEY` non plus ;
 * un placeholder non vide suffit donc en dev, et `verify()` n'utilise de toute
 * façon que `webhookSecret`, jamais la clé API.
 */
const resendVerifier = new Resend(env.RESEND_API_KEY ?? 'resend-webhook-verify-only');

interface ResendBounce {
  type?: string;
  subType?: string;
  message?: string;
}

interface ResendEventData {
  email_id?: string;
  to?: string[];
  bounce?: ResendBounce;
}

/** Vue structurelle minimale du payload Resend vérifié (cf. resend@6 types). */
interface ResendWebhookEvent {
  type: string;
  data?: ResendEventData;
}

function isResendWebhookEvent(value: unknown): value is ResendWebhookEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}

/** Détecteur de violation de contrainte unique Prisma (idiome inline du repo). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'P2002'
  );
}

function errorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string'
    ? err.code
    : 'unknown';
}

/**
 * Un hard bounce (`bounce.type === 'Permanent'`, comparé insensible à la casse)
 * ou une plainte suppriment l'adresse. Un bounce transitoire et les événements
 * delivered/sent ne suppriment rien.
 */
function resolveSuppressionReason(
  eventType: string,
  bounceType: string | null,
): SuppressionReason | null {
  if (eventType === 'email.complained') return 'complaint';
  if (eventType === 'email.bounced' && bounceType?.toLowerCase() === 'permanent') {
    return 'hard_bounce';
  }
  return null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Route désarmée si le secret de signature est absent (comme CRON_SECRET).
  //    On refuse plutôt que d'accepter un webhook non vérifié — même en dev.
  if (!env.RESEND_WEBHOOK_SECRET) {
    reportWarning('webhook.resend', 'webhook disabled: RESEND_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'webhook_disabled', detail: 'RESEND_WEBHOOK_SECRET not configured.' },
      { status: 503 },
    );
  }

  // 2. En-têtes de signature svix. Un seul manquant → 400 (requête malformée).
  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'missing_signature_headers' }, { status: 400 });
  }

  // 3. Corps BRUT : svix signe les octets exacts. `req.text()` les préserve ;
  //    `req.json()` les altérerait (re-sérialisation) et casserait la signature.
  const rawBody = await req.text();

  // 4. Vérification. Tout throw (signature invalide, dérive d'horodatage, corps
  //    altéré) → 400. JAMAIS 500 ici : un 5xx ferait retenter Resend à l'infini
  //    sur une requête forgée/dupliquée. `verify()` lève une
  //    WebhookVerificationError (classe non importable — svix est transitif et
  //    resend ne la ré-exporte pas), donc on catch largement. Log PII-free.
  let verified: unknown;
  try {
    verified = resendVerifier.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: env.RESEND_WEBHOOK_SECRET,
    });
  } catch {
    reportWarning('webhook.resend', 'signature verification failed', { svixId });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // 5. Traitement de l'événement vérifié. Enveloppé pour qu'une exception
  //    inattendue (hoquet DB transitoire) devienne un 500 → Resend retentera.
  try {
    return await processVerifiedEvent(verified, svixId);
  } catch (err) {
    reportError('webhook.resend', err, {
      route: '/api/webhooks/resend',
      svixId,
      code: errorCode(err),
    });
    await flushSentry();
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }
}

async function processVerifiedEvent(event: unknown, svixId: string): Promise<NextResponse> {
  // Garde structurelle : Resend envoie toujours `{ type, data }`. Sinon on logge
  // la forme inattendue (type/svixId seuls, jamais de PII) et on acquitte pour
  // que Resend ne retente pas indéfiniment une forme qu'on ne traitera jamais.
  if (!isResendWebhookEvent(event)) {
    reportWarning('webhook.resend', 'unexpected event shape', { svixId });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const eventType = event.type;
  const data = event.data ?? {};
  const recipient = data.to?.[0];
  const resendEmailId = data.email_id ?? null;

  // Seuls les événements `email.*` portent `data.to` ; `contact.*` / `domain.*`
  // non. Notre ligne EmailEvent exige une adresse (colonne NOT NULL) → sans
  // destinataire on acquitte sans persister (hors périmètre J2).
  if (!recipient) {
    reportInfo('webhook.resend', 'event without recipient skipped', { svixId, eventType });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const email = normalizeEmail(recipient);

  // Résolution membre best-effort (pas de FK — l'adresse peut ne pas être un
  // membre). Un échec de lookup ne doit pas perdre l'événement : on persiste
  // alors sans le lien `userId`.
  let userId: string | null = null;
  try {
    const user = await db.user.findFirst({ where: { email }, select: { id: true } });
    userId = user?.id ?? null;
  } catch (err) {
    reportWarning('webhook.resend', 'member lookup failed', { svixId, code: errorCode(err) });
  }

  const bounce = data.bounce;
  const bounceType = bounce?.type ?? null;
  const bounceSubType = bounce?.subType ?? null;

  // IDEMPOTENCE : la contrainte unique `svix_id` est la barrière. Un rejeu du
  // même webhook (retry Resend) lève P2002 → déjà traité, on acquitte SANS
  // rejouer les effets de bord.
  try {
    await db.emailEvent.create({
      data: {
        svixId,
        eventType,
        email,
        resendEmailId,
        userId,
        bounceType,
        bounceSubType,
        // La colonne JSON est `JsonValue` (inclut index signatures) ; le double
        // cast est l'idiome du repo pour un objet vérifié écrit tel quel.
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Déjà traité sur la première livraison — effets de bord déjà appliqués.
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    throw err; // vraie erreur DB → catch global → 500 → Resend retente.
  }

  // Effets de bord APRÈS l'insertion réussie (première livraison uniquement).
  // `upsertSuppression` est idempotent (upsert sur l'email), donc rejouable sans
  // dommage si jamais il échouait après l'insert.
  const suppressionReason = resolveSuppressionReason(eventType, bounceType);
  if (suppressionReason) {
    await upsertSuppression({
      email,
      reason: suppressionReason,
      bounceType,
      bounceSubType,
      resendEmailId,
      userId,
    });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

export function GET(): NextResponse {
  // POST-only : bloque un GET accidentel (les autres méthodes → 405 auto Next).
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
