/**
 * Seed demo "séances" (Réunion Trading Hub re-platform — J2 runtime fixtures).
 *
 * Platform-wide content (ReplaySession has 0 FK to User), so this seed is fully
 * decoupled from the demo member: it only upserts `replay_sessions` +
 * `replay_assets` + `replay_messages` rows so the `/seances` member hub and the
 * `/seances/[date]/[slot]` page render with real, faithful content at runtime.
 *
 * Faithfulness (Règle n°1): the published `analyse` of 2026-06-29 is transcribed
 * VERBATIM from the live pipeline artefact
 * `D:\Projects\reunion-trading-hub\data\meetings.json` (Eliott's own words, zero
 * invention). The two extra rows exercise the degraded states ONLY — a
 * `cancelled` slot (minimal page, no analysis) and a `scheduled` slot (not yet
 * published) — so they carry NO fabricated trading content.
 *
 * Idempotent: upserts on the `(date, slot)` unique key and replaces the child
 * assets/messages, so re-running is byte-stable. Touches NOTHING member-scoped.
 *
 * Usage (from D:\Fxmily):
 *   $env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
 *   pnpm --filter @fxmily/web exec tsx scripts/seed-seances-demo.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-seances] DATABASE_URL is required. See script header.');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const db = new PrismaClient({ adapter });

/** `@db.Date` (UTC-midnight) value for a civil `YYYY-MM-DD`. */
function dbDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

type Slot = 'analyse' | 'debrief';
type Status = 'scheduled' | 'done' | 'cancelled';
type Bias = 'haussier' | 'baissier' | 'neutre';

interface AssetSeed {
  symbol: string;
  name: string;
  bias?: Bias;
  macro?: boolean;
  levels: { label: string; value: string }[];
  reading: string[];
}

interface MessageSeed {
  asset: string;
  text: string;
}

interface SessionSeed {
  date: string;
  slot: Slot;
  status: Status;
  title: string;
  time?: string;
  summary?: string;
  keyTakeaways?: string[];
  cancelReason?: string;
  transcriptSource?: 'fathom' | 'whisper' | 'manual';
  transcriptLang?: string;
  contentGenerated?: boolean;
  contentModel?: string;
  assets?: AssetSeed[];
  messages?: MessageSeed[];
}

// ── Published analyse of 2026-06-29 — VERBATIM from the live pipeline artefact ──
const ANALYSE_2026_06_29: SessionSeed = {
  date: '2026-06-29',
  slot: 'analyse',
  status: 'done',
  title: 'Analyse de séance — un dollar qui souffle, GBPUSD et Nasdaq en priorité',
  time: '12h00',
  summary:
    'Le dollar marque une pause sous son plus haut de 13 mois, sans changer de cap : une simple respiration. Les scénarios principaux du jour : GBPUSD à la baisse sur rejet de sa zone, indices (Nasdaq, S&P 500) en continuation haussière.',
  keyTakeaways: [
    'Le dollar reflue sous son plus haut de 13 mois (au-delà de 101,8 le 24 juin) vers 101,29 après un PCE conforme aux attentes : une respiration, pas un retournement. La force de fond reste intacte.',
    'Deux lectures coexistent. Icor voit une continuation du reflux baissier du dollar (donc euro et livre soutenus) ; Eliott anticipe un retournement haussier du dollar dès qu’un rejet se confirme sur les zones.',
    'Scénario principal n°1 — GBPUSD à la baisse : retour dans la Golden Zone sur une origine vendeuse, premier rejet déjà observé. On attend une clôture H1 avec une mèche de rejet pour confirmer la continuation baissière.',
    'Scénario principal n°2 — Nasdaq à la hausse : la structure baissière est cassée, on guette une manipulation vers une origine acheteuse avant l’open US (15h30) pour une continuation. Même logique sur le S&P 500, mais Eliott préfère le Nasdaq, plus amplifié.',
    'EURUSD nettement moins prioritaire : une réaction baissière est possible mais « dans le vide », sans zone structurante. Repère d’Icor : biais haussier tant que le prix tient au-dessus de 1,13.',
    'Or (XAUUSD) écarté du jour : il s’est découplé du dollar (le dollar recule mais l’or baisse aussi), car il suit les rendements réels. Intéressant seulement sur un plan technique (sortie du canal baissier).',
    'Contexte risk on (désescalade US-Iran avant les pourparlers de Doha), mais rebond fragile : environ 165 milliards de ventes liées au rééquilibrage de fin de trimestre menacent l’après-midi. Aucun catalyseur fort aujourd’hui, hormis le discours d’ouverture de Lagarde à 20h.',
  ],
  transcriptSource: 'fathom',
  transcriptLang: 'fr',
  contentGenerated: true,
  contentModel: 'producteur-humain',
  assets: [
    {
      symbol: 'GBPUSD',
      name: 'Livre / Dollar',
      bias: 'baissier',
      levels: [
        { label: 'Zone clé', value: 'Golden Zone — origine vendeuse' },
        { label: 'Structure', value: 'Rejet du nouveau plus haut' },
      ],
      reading: [
        'Scénario principal du jour, à la baisse. Le marché est revenu dans sa Golden Zone, sur une origine vendeuse héritée de la session de New York précédente.',
        'On est en compréhension de marché de retournement : les corrections sont de plus en plus grandes, les poussées acheteuses de moins en moins franches — bougies d’incertitude avec intervention des vendeurs, là où un vrai départ haussier serait direct et en momentum.',
        'Un premier rejet a déjà eu lieu à l’arrivée sur la zone, alors qu’une vraie continuation haussière aurait cassé directement à la hausse. Eliott attend un nouveau retour sur la zone, puis une clôture H1 marquant une belle mèche de rejet, pour confirmer la continuation baissière.',
        'Par corrélation, Icor attend plutôt une hausse (dollar mou à court terme) ; mais sur le fond le dollar reste haussier et aucun catalyseur ne soutient une baisse durable du DXY aujourd’hui.',
      ],
    },
    {
      symbol: 'NQ',
      name: 'Nasdaq 100',
      bias: 'haussier',
      levels: [
        { label: 'Zone clé', value: 'Origine acheteuse (repli)' },
        { label: 'Catalyseur', value: 'Open US — 15h30' },
      ],
      reading: [
        'Priorité du jour, à la hausse. Le Nasdaq a bien cassé la structure baissière : poussées baissières de moins en moins fortes, rejet de la création d’un nouveau plus bas.',
        'On attend une légère manipulation baissière qui vienne chercher une origine acheteuse importante — à l’origine d’un précédent fort mouvement haussier — avant une continuation jusqu’à une origine vendeuse.',
        'La fenêtre clé est l’ouverture américaine (15h30), avec une forte volatilité et une possible manipulation de précession entre 15h et 15h30, voire à l’open. Contexte risk on (désescalade US-Iran).',
        'Eliott préfère le Nasdaq au S&P 500 : ses mouvements sont beaucoup plus amplifiés, c’est l’actif qui l’intéresse le plus aujourd’hui.',
      ],
    },
    {
      symbol: 'SP500',
      name: 'S&P 500',
      bias: 'haussier',
      levels: [
        { label: 'Zone clé', value: 'Origines acheteuses (repli)' },
        { label: 'Catalyseur', value: 'Open US — 15h30' },
      ],
      reading: [
        'Même logique que le Nasdaq : continuation haussière attendue, en risk on (désescalade US-Iran).',
        'On guette une légère manipulation baissière vers les origines acheteuses avant de suivre le mouvement.',
        'Le S&P 500 peut être plus structuré et lisible, mais Eliott lui préfère le Nasdaq pour l’amplitude de ses mouvements.',
      ],
    },
    {
      symbol: 'EURUSD',
      name: 'Euro / Dollar',
      bias: 'baissier',
      levels: [{ label: 'Pivot (déclencheur)', value: '1,13' }],
      reading: [
        'Actif nettement moins prioritaire aujourd’hui. Une réaction baissière est possible, mais l’euro est trop volatile et n’offre pas de zones réellement structurantes : la réaction risque de se faire « dans le vide ».',
        'Déclencheur d’Icor : tant que l’EURUSD tient au-dessus de 1,13, le biais reste haussier ; une cassure sous ce pivot, accompagnée d’un dollar qui reprend sa tendance, ouvre la baisse.',
        'Eliott est bien plus intéressé par le GBPUSD, qui revient sur une Golden Zone et une belle origine vendeuse, plus structuré que l’euro.',
      ],
    },
    {
      symbol: 'XAUUSD',
      name: 'Or',
      bias: 'neutre',
      levels: [
        { label: 'Corrélation', value: 'Rompue avec le dollar' },
        { label: 'Structure', value: 'Sortie du canal baissier' },
      ],
      reading: [
        'Écarté des priorités du jour. L’or s’est découplé du dollar : le dollar recule, mais l’or baisse quand même, car il suit les rendements réels élevés et le dégonflement de la prime géopolitique.',
        'Sur le plan strictement technique, une continuation haussière serait envisageable (sortie du canal baissier), mais Icor attend plutôt une baisse : beaucoup de désaccords.',
        'Eliott ne s’y intéresse que lorsque l’or est corrélé au DXY ; aujourd’hui il « n’en fait qu’à sa tête », donc hors radar. Rappel de contexte : record à environ 5995 fin janvier, puis correction de 25 à 29 %.',
      ],
    },
    {
      symbol: 'DXY',
      name: 'Indice dollar',
      bias: 'haussier',
      macro: true,
      levels: [
        { label: 'Plus haut 13 mois (24 juin)', value: '101,8' },
        { label: 'Reflux actuel', value: '101,29' },
      ],
      reading: [
        'Fil conducteur du jour : « un dollar qui souffle ». Le dollar reflue sous son sommet de 13 mois (au-delà de 101,8 le 24 juin) vers 101,29 après un PCE conforme aux attentes — un débouclage léger des paris de hausse, pas un retournement.',
        'Sur le fond, le régime reste celui d’un dollar fort qui se repose : la Fed (sous Kevin Walsh) a relevé ses projections le 17 juin, le marché price plusieurs hausses en 2026 et une faible probabilité de baisse cette année.',
        'Lecture technique d’Eliott : le DXY est revenu dans sa Golden Zone, sorti d’un canal baissier. Il anticipe un retournement haussier — un rejet en H1 de l’origine acheteuse, un retour dans la zone, puis une reprise à la hausse, idéalement vers la clôture de 14h-15h.',
        'Icor, lui, n’exclut pas une continuation du reflux baissier à court terme. Aucun catalyseur fort aujourd’hui (seul le discours d’ouverture de Lagarde à 20h, après la fenêtre de prise de position).',
      ],
    },
  ],
  messages: [
    {
      asset: 'GBPUSD',
      text: 'GBPUSD — Scénario principal du jour, à la baisse. Retour dans la Golden Zone sur une origine vendeuse, premier rejet déjà en place. On attend une clôture H1 avec une belle mèche de rejet pour confirmer la continuation baissière, en parallèle d’un DXY qui rejette aussi sa zone. Pas d’anticipation avant la confirmation.',
    },
    {
      asset: 'NQ',
      text: 'NASDAQ (NQ) — Priorité haussière. La structure baissière est cassée ; on attend une légère manipulation vers une origine acheteuse avant une continuation. Forte volatilité à l’open US (15h30), avec une possible manipulation de précession entre 15h et 15h30. C’est l’actif que je préfère aujourd’hui pour l’amplitude de ses mouvements.',
    },
    {
      asset: 'SP500',
      text: 'S&P 500 — Même logique que le Nasdaq : continuation haussière en risk on, après une éventuelle manipulation baissière vers les origines acheteuses. Plus lisible que le Nasdaq, mais je privilégie ce dernier pour l’amplitude.',
    },
    {
      asset: 'EURUSD',
      text: 'EURUSD — Beaucoup moins prioritaire. Réaction baissière possible mais « dans le vide », sans zone structurante. Repère : tant qu’on tient au-dessus de 1,13, le biais reste haussier ; sous ce pivot avec un dollar qui repart, la baisse s’ouvre. Je reste surtout sur le GBPUSD.',
    },
    {
      asset: 'XAUUSD',
      text: 'OR (XAUUSD) — Hors radar aujourd’hui. L’or s’est découplé du dollar : il baisse malgré un dollar qui recule, car il suit les rendements réels. Une hausse technique (sortie de canal baissier) est possible, mais Icor attend une baisse — trop de désaccords, pas corrélé au DXY.',
    },
    {
      asset: 'DXY',
      text: 'DOLLAR (DXY) — Un dollar qui souffle : reflux de 101,8 (plus haut de 13 mois, 24 juin) vers 101,29 après un PCE conforme, sans changer de cap. Sur le fond, dollar fort qui se repose. J’anticipe un retournement haussier après un rejet de l’origine acheteuse, là où Icor voit plutôt la continuation du reflux. Aucun catalyseur fort hormis Lagarde à 20h.',
    },
  ],
};

// ── Degraded-state fixtures (NO fabricated trading content) ──────────────────
const CANCELLED_2026_06_27_DEBRIEF: SessionSeed = {
  date: '2026-06-27',
  slot: 'debrief',
  status: 'cancelled',
  title: 'Débrief du 27 juin',
  time: '20h00',
  cancelReason: 'Pas de réunion ce soir — séance non tenue.',
};

const SCHEDULED_TODAY_DEBRIEF: SessionSeed = {
  date: '2026-06-29',
  slot: 'debrief',
  status: 'scheduled',
  title: 'Débrief du 29 juin',
  time: '20h00',
};

const SESSIONS: SessionSeed[] = [
  ANALYSE_2026_06_29,
  CANCELLED_2026_06_27_DEBRIEF,
  SCHEDULED_TODAY_DEBRIEF,
];

async function seedSession(s: SessionSeed): Promise<void> {
  const base = {
    title: s.title,
    status: s.status,
    time: s.time ?? null,
    summary: s.summary ?? null,
    keyTakeaways: s.keyTakeaways ?? [],
    cancelReason: s.cancelReason ?? null,
    transcriptSource: s.transcriptSource ?? null,
    transcriptLang: s.transcriptLang ?? null,
    contentGenerated: s.contentGenerated ?? false,
    contentModel: s.contentModel ?? null,
    cpTranscript: Boolean(s.transcriptSource),
    cpAi: Boolean(s.contentGenerated),
    pipelineSyncedAt: new Date(),
  };

  const session = await db.replaySession.upsert({
    where: { date_slot: { date: dbDate(s.date), slot: s.slot } },
    create: { date: dbDate(s.date), slot: s.slot, ...base },
    update: base,
    select: { id: true },
  });

  // Replace children deterministically (idempotent re-seed).
  await db.replayAsset.deleteMany({ where: { sessionId: session.id } });
  await db.replayMessage.deleteMany({ where: { sessionId: session.id } });

  if (s.assets?.length) {
    await db.replayAsset.createMany({
      data: s.assets.map((a, i) => ({
        sessionId: session.id,
        symbol: a.symbol,
        name: a.name,
        bias: a.bias ?? null,
        macro: a.macro ?? false,
        levels: a.levels,
        reading: a.reading,
        position: i,
      })),
    });
  }

  if (s.messages?.length) {
    await db.replayMessage.createMany({
      data: s.messages.map((m, i) => ({
        sessionId: session.id,
        asset: m.asset,
        text: m.text,
        position: i,
      })),
    });
  }

  console.log(`[seed-seances] upserted ${s.date}/${s.slot} (${s.status})`);
}

async function main(): Promise<void> {
  for (const s of SESSIONS) {
    await seedSession(s);
  }
  const count = await db.replaySession.count();
  console.log(`[seed-seances] done — ${count} replay session(s) total.`);
}

main()
  .catch((err) => {
    console.error('[seed-seances] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
