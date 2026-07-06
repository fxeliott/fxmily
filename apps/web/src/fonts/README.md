# Fontes locales

## Clash Display (Indian Type Foundry)

Fonte display (titres, hero, KPI) chargée via `next/font/local` dans
`src/app/layout.tsx` sous la variable CSS `--font-display-face`.

- **Graisses** : Medium (500), Semibold (600) et Bold (700), format `woff2`.
  Le Medium est la graisse par defaut des titres depuis le tour 16 : en dark
  mode l'halation fait percevoir une graisse un cran au-dessus (un 600 se lit
  comme un 700), et le stroke-contrast "pinche" de Clash Display ne devient
  prononce que sur les graisses lourdes.
- **Source** : kit officiel Fontshare (https://www.fontshare.com/fonts/clash-display),
  fichiers `woff2` utilises **tels quels**, sans conversion (exige par la licence).
- **Licence** : ITF Free Font License, voir `ClashDisplay-LICENSE-FFL.txt`.
  Usage commercial autorise, y compris web/apps a toute echelle. Interdits :
  modifier/re-exporter le fichier, redistribuer les fichiers, convertir le format.
- **Couverture** : Latin + Latin Extended. Tous les diacritiques francais verifies
  present dans les deux graisses (majuscules accentuees, minuscules accentuees,
  ligatures oe/OE, apostrophes, euro), 380 glyphes, unitsPerEm 1000.

Les fichiers de licence et ce README ne sont pas des assets runtime : ils restent
ici pour tracer la provenance et la conformite.
