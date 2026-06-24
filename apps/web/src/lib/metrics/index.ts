/**
 * Catalogue de métriques centralisé — point d'entrée public.
 *
 * Source unique de vérité de TOUTES les métriques trackées (clé, libellé FR,
 * type, axe, unité, agrégation, statut). Les sessions 2 → 10 importent d'ici au
 * lieu de re-définir leurs métriques ad-hoc. Voir `./registry` pour le contrat.
 */
export {
  ALL_METRICS,
  childMetrics,
  getMetric,
  METRIC_KEYS,
  METRICS,
  metricsByAxis,
  type MetricAggregation,
  type MetricAxis,
  type MetricDef,
  type MetricKey,
  type MetricStatus,
  type MetricType,
  type MetricUnit,
} from './registry';
