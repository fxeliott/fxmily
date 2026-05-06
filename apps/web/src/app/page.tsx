import { SplashHero } from './splash-hero';

/**
 * Splash / accueil public — `/`.
 *
 * Server Component qui délègue à SplashHero (client) pour les animations
 * (word-rise stagger, sparkline draw, drift orb).
 *
 * Posture athlète discipline, mono-accent lime, anti-AI-slop.
 * Public route (whitelisted dans authConfig.authorized).
 */
export default function HomePage() {
  return <SplashHero />;
}
