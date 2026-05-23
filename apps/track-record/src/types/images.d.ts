/**
 * Static asset module declarations for TypeScript.
 *
 * Pourquoi ce fichier existe : Next.js génère normalement `next-env.d.ts`
 * (gitignored) qui inclut `/// <reference types="next/image-types/global" />`.
 * En CI, `tsc --noEmit` tourne AVANT `next build` → le fichier `next-env.d.ts`
 * n'existe pas encore → erreur TS2307 sur `import logoFxmily from '*.png'`.
 *
 * Solution : déclarer les modules statiques nous-mêmes via ce fichier
 * commité (vs `next-env.d.ts` que Next.js demande de NE PAS commit).
 *
 * Ref : https://nextjs.org/docs/app/api-reference/config/typescript
 */

/// <reference types="next/image-types/global" />
