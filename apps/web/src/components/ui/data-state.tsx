import type { ReactNode } from 'react';

import { SkeletonText } from '@/components/ui/skeleton';

export type DataStatus = 'loading' | 'empty' | 'error' | 'ready';

export interface DataStateProps {
  status: DataStatus;
  /**
   * Rendu pendant le chargement. Défaut : `<SkeletonText lines={4} />`.
   * Passe un skeleton calé sur le layout réel pour l'anti-CLS.
   */
  loading?: ReactNode;
  /** Rendu quand vide — passe un `<EmptyState … />`. */
  empty?: ReactNode;
  /** Rendu en erreur — passe un `<ErrorState … />`. */
  error?: ReactNode;
  /** Contenu prêt (status `ready`). */
  children?: ReactNode;
}

/**
 * DataState — aiguilleur d'état de données unifié du design system (S9).
 *
 * Centralise le pattern `loading / empty / error / ready` pour que chaque
 * surface de suivi reste lisible et rassurante quand la donnée charge, manque
 * ou échoue — fini les écrans morts, chaque page n'a plus à recâbler ce
 * branchement à la main.
 *
 * Framework-neutre (aucun hook, pas de `'use client'`) : utilisable depuis un
 * Server Component comme depuis un Client Component. Les enfants `empty` /
 * `error` peuvent être des îlots client (`<ErrorState>`).
 */
export function DataState({ status, loading, empty, error, children }: DataStateProps) {
  if (status === 'loading') return <>{loading ?? <SkeletonText lines={4} />}</>;
  if (status === 'empty') return <>{empty ?? null}</>;
  if (status === 'error') return <>{error ?? null}</>;
  return <>{children}</>;
}
