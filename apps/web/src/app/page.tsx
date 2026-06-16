import { SplashHero } from './splash-hero';

/**
 * Splash / accueil public — `/` (V2 refonte).
 *
 * Server Component qui délègue à SplashHero (client) pour les animations
 * (word-rise stagger, emblème orbital, orbes dérivants, pointer-parallax).
 *
 * Posture : accueil ÉPURÉ (pas un dashboard) — bienvenue + 2 actions
 * (connexion / demande d'accès), accent bleu lumineux DS-v3, anti-AI-slop.
 * Public route (whitelisted dans authConfig.authorized).
 */
export default function HomePage() {
  return <SplashHero />;
}
