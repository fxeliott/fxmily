import { SplashHero } from './splash-hero';

/**
 * Splash / accueil public — `/` (V2 refonte).
 *
 * Server Component de bout en bout : SplashHero est server-rendered (les
 * animations word-rise / emblème orbital / orbes sont du CSS pur) ; seul le
 * pointer-parallax vit dans l'îlot client SplashParallax.
 *
 * Posture : accueil ÉPURÉ (pas un dashboard) — bienvenue + 2 actions
 * (connexion / demande d'accès), accent bleu lumineux DS-v3, anti-AI-slop.
 * Public route (whitelisted dans authConfig.authorized).
 */
export default function HomePage() {
  return <SplashHero />;
}
