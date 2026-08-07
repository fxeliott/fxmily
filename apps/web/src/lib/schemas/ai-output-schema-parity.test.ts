import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CALENDAR_OUTPUT_JSON_SCHEMA } from '@/lib/calendar/prompt';
import { MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA } from '@/lib/member-profile-monthly/prompt';
import { MONTHLY_DEBRIEF_OUTPUT_JSON_SCHEMA } from '@/lib/monthly-debrief/prompt';
import { MEMBER_PROFILE_OUTPUT_JSON_SCHEMA } from '@/lib/onboarding-interview/prompt';
import { adaptiveCalendarOutputSchema } from '@/lib/schemas/adaptive-calendar';
import { memberProfileMonthlySnapshotOutputSchema } from '@/lib/schemas/member-profile-monthly-snapshot';
import { monthlyDebriefOutputSchema } from '@/lib/schemas/monthly-debrief';
import { memberProfileOutputSchema } from '@/lib/schemas/onboarding-interview';
import { verificationVisionOutputSchema } from '@/lib/schemas/verification';
import { weeklyReportOutputSchema } from '@/lib/schemas/weekly-report';
import { VERIFICATION_VISION_OUTPUT_JSON_SCHEMA } from '@/lib/verification/prompt';
import { WEEKLY_REPORT_OUTPUT_JSON_SCHEMA } from '@/lib/weekly-report/prompt';

/**
 * J10 correctif n°4 — anti-dérive des SIX contrats de sortie IA.
 *
 * ## Le défaut
 *
 * Chaque pipeline IA déclare la forme attendue DEUX fois :
 *
 *   - un JSON Schema écrit à la main (`*_OUTPUT_JSON_SCHEMA`, dans `prompt.ts`)
 *     qui voyage jusqu'au modèle et lui dit quoi produire ;
 *   - un schéma Zod (`*OutputSchema`) qui valide ce qui revient, en `.strict()`.
 *
 * Les deux portent `additionalProperties: false` / `.strict()`. Ajouter un champ
 * d'UN SEUL côté est donc une panne de production SILENCIEUSE : le modèle émet
 * légitimement un champ que le contrat de fil autorise, puis Zod rejette
 * l'extraction entière. Aucune erreur de compilation, aucun autre test ne
 * l'attrape. Un seul des six pipelines avait un garde (`verification`) ; les
 * cinq autres n'en avaient aucun.
 *
 * ## Pourquoi ce n'est PAS une génération automatique
 *
 * Le jalon proposait de générer le JSON Schema depuis Zod (`z.toJSONSchema`).
 * Mesuré le 2026-08-07, ce chemin DÉGRADE le contrat :
 *
 *   1. En mode `output`, toutes les bornes de chaînes disparaissent — les
 *      `.transform()` de sécurité (`safeFreeText`, anti-Trojan-Source) rendent
 *      le type non représentable, et Zod rend `{}`. Le modèle recevrait un
 *      contrat sans aucune limite anti-hallucination.
 *   2. En mode `input`, un `z.preprocess` fait perdre le caractère OBLIGATOIRE
 *      d'un champ : `account.login` (vérification MT5) sort du `required`
 *      généré alors qu'il y est aujourd'hui. C'est le pipeline le plus sensible
 *      — il tourne toutes les 5 minutes en production.
 *   3. Les divergences de CONTRAINTES DE VALEUR sont délibérées et documentées :
 *      Zod est le durcissement serveur d'un contrat de fil volontairement plus
 *      lâche (cf. `verification/vision-schema-parity.test.ts`).
 *
 * Ce test verrouille donc ce qui casse la production — la FORME : noms de
 * champs, caractère obligatoire, fermeture des objets, bornes de tableaux — et
 * laisse diverger ce qui doit diverger.
 */

/** Contraintes de VALEUR : divergence assumée entre le fil et la validation. */
const VALUE_ONLY_KEYS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'description',
  'title',
  'default',
  '$schema',
]);

type Node = Record<string, unknown>;

/**
 * Ramène les deux écritures du « nullable » à une forme unique.
 * Le schéma manuel écrit `type: ['string', 'null']` ; Zod génère
 * `anyOf: [{type:'string'}, {type:'null'}]`. Sémantiquement identiques.
 */
function flattenNullable(node: Node): Node {
  const anyOf = node['anyOf'];
  if (!Array.isArray(anyOf)) return node;
  const branches = anyOf as Node[];
  const nullBranch = branches.find((b) => b['type'] === 'null');
  const others = branches.filter((b) => b['type'] !== 'null');
  if (nullBranch === undefined || others.length !== 1) return node;
  const rest = { ...node };
  delete rest['anyOf'];
  const only = others[0] as Node;
  return { ...rest, ...only, type: [only['type'], 'null'] };
}

/** Ne garde que ce qui, s'il diverge, casse la production. */
function shapeOf(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(shapeOf);
  if (input === null || typeof input !== 'object') return input;

  const node = flattenNullable(input as Node);
  const out: Node = {};

  for (const [key, value] of Object.entries(node)) {
    if (VALUE_ONLY_KEYS.has(key)) continue;
    // `minItems: 0` n'exprime rien (un tableau a toujours au moins zéro
    // élément). Le schéma manuel l'écrit par symétrie, Zod l'omet. Aucun des
    // deux ne contraint quoi que ce soit.
    if (key === 'minItems' && value === 0) continue;
    if (key === 'type') {
      out['type'] = Array.isArray(value) ? [...(value as string[])].sort() : value;
      continue;
    }
    if (key === 'required' || key === 'enum') {
      out[key] = [...(value as unknown[])].map(String).sort();
      continue;
    }
    out[key] = shapeOf(value);
  }

  // Deux écritures d'une ÉNUMÉRATION. Le schéma manuel se contente de la
  // liste des valeurs (et y met `null` quand le champ est nullable) ; Zod
  // ajoute le `type` correspondant. Une énumération dit déjà tout ce que le
  // `type` dirait — on garde la forme la plus courte, identique de sens.
  const enumValues = out['enum'];
  if (Array.isArray(enumValues)) {
    const typeValue = out['type'];
    if (
      Array.isArray(typeValue) &&
      (typeValue as string[]).includes('null') &&
      !(enumValues as string[]).includes('null')
    ) {
      out['enum'] = [...(enumValues as string[]), 'null'].sort();
    }
    delete out['type'];
  }
  return out;
}

function wire(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

/**
 * Écarts CONNUS, chacun avec sa raison. Toute autre divergence fait rougir.
 *
 * Le format est `chemin.json.pointe -> raison`. Une entrée qui ne correspond
 * plus à rien fait aussi rougir : une exception périmée est une porte ouverte
 * que plus personne ne regarde.
 */
const KNOWN_GAPS: ReadonlyMap<string, string> = new Map([
  [
    'verification:properties.account.required',
    "`z.preprocess` sur `account.login` : Zod ne peut pas déclarer le type d'ENTRÉE d'un preprocess, donc la génération sort `login` du `required`. Le contrat de fil, lui, l'exige — et doit continuer de l'exiger, sinon le modèle est autorisé à l'omettre. Divergence d'OUTIL, pas de code.",
  ],
]);

const PAIRS = [
  ['weekly', weeklyReportOutputSchema, WEEKLY_REPORT_OUTPUT_JSON_SCHEMA],
  ['monthly', monthlyDebriefOutputSchema, MONTHLY_DEBRIEF_OUTPUT_JSON_SCHEMA],
  ['calendar', adaptiveCalendarOutputSchema, CALENDAR_OUTPUT_JSON_SCHEMA],
  ['profile', memberProfileOutputSchema, MEMBER_PROFILE_OUTPUT_JSON_SCHEMA],
  [
    'profileMonthly',
    memberProfileMonthlySnapshotOutputSchema,
    MEMBER_PROFILE_MONTHLY_OUTPUT_JSON_SCHEMA,
  ],
  ['verification', verificationVisionOutputSchema, VERIFICATION_VISION_OUTPUT_JSON_SCHEMA],
] as const;

/** Applique les exceptions connues à la structure générée. */
function withKnownGaps(pipeline: string, generated: unknown, manual: unknown): unknown {
  if (pipeline !== 'verification') return generated;
  const g = structuredClone(generated) as Node;
  const m = manual as Node;
  const props = g['properties'] as Node;
  const account = props['account'] as Node;
  account['required'] = ((m['properties'] as Node)['account'] as Node)['required'];
  return g;
}

describe('AI output contracts — wire JSON Schema ↔ Zod shape parity', () => {
  it('covers every AI pipeline that ships a JSON Schema (no pipeline left unguarded)', () => {
    // Contrôle de complétude : si un 7ᵉ pipeline apparaît, il doit entrer ici.
    // Sans ce compte, ajouter un pipeline sans garde passerait inaperçu.
    expect(PAIRS).toHaveLength(6);
    expect(PAIRS.map(([n]) => n).sort()).toEqual([
      'calendar',
      'monthly',
      'profile',
      'profileMonthly',
      'verification',
      'weekly',
    ]);
  });

  for (const [name, zodSchema, manual] of PAIRS) {
    it(`${name}: field names, required-ness and object closure match`, () => {
      const generated = shapeOf(wire(zodSchema as z.ZodType));
      const expected = shapeOf(manual);
      expect(withKnownGaps(name, generated, expected)).toEqual(expected);
    });
  }

  it('documents every known gap, and none that no longer applies', () => {
    // Une exception qui ne correspond plus à rien est une porte laissée
    // ouverte. Ici : retirer le `preprocess` de `login` doit forcer à retirer
    // aussi l'exception, sinon la garde s'affaiblit en silence.
    expect([...KNOWN_GAPS.keys()]).toEqual(['verification:properties.account.required']);
    const raw = wire(verificationVisionOutputSchema) as Node;
    const account = (raw['properties'] as Node)['account'] as Node;
    expect(
      (account['required'] as string[]).includes('login'),
      "l'exception `login` n'a plus lieu d'être : la retirer",
    ).toBe(false);
  });

  it('keeps every AI contract closed to unknown fields (anti-hallucination)', () => {
    // `additionalProperties: false` est ce qui empêche le modèle d'inventer un
    // champ. Il doit être vrai des DEUX côtés, sur l'objet racine de chacun.
    for (const [name, zodSchema, manual] of PAIRS) {
      expect((manual as Node)['additionalProperties'], `${name} (fil)`).toBe(false);
      expect((wire(zodSchema as z.ZodType) as Node)['additionalProperties'], `${name} (Zod)`).toBe(
        false,
      );
    }
  });
});
