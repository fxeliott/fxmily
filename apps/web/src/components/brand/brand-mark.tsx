/**
 * Marque Fxmily — monogramme « FX » officiel (jalon logo).
 *
 * Source UNIQUE du logo : le tracé vectoriel ci-dessous est la vectorisation
 * fidèle du logo fourni par Eliot (`logo fxmily.jpg`, potrace, fond détouré).
 * Vecteur → net à toute taille (favicon 16px → splash 200px), zéro artefact
 * raster, `fill="currentColor"` → se teinte via la couleur de texte du parent
 * (bleu accent dans les chips, blanc sur le cœur du splash / les favicons).
 *
 * `FX_PATH` / `FX_VIEWBOX` sont exportés pour les surfaces qui ne peuvent pas
 * monter un composant React (génération d'icônes `ImageResponse`, favicon SVG).
 * viewBox resserré sur la bbox du tracé (+ marge) pour que la marque remplisse
 * son conteneur sans cadre mort.
 */

export const FX_VIEWBOX = '118 115 363 295';

export const FX_PATH =
  'M 143.142 132.159 C 140.745 133.345, 137.482 136.112, 135.892 138.308 C 133.012 142.284, 133 142.361, 133 157.150 L 133 172 210.939 172 L 288.878 172 298.069 161.750 C 303.124 156.112, 311.752 146.662, 317.242 140.750 L 327.223 130 237.361 130.001 L 147.500 130.002 143.142 132.159 M 402.428 136.741 C 397.036 142.873, 391.400 149.108, 366.488 176.500 C 361.986 181.450, 352.981 191.575, 346.477 199 C 339.973 206.425, 330.536 217, 325.506 222.500 C 297.210 253.440, 278.555 273.728, 261.561 292.042 C 244.343 310.598, 224.114 332.563, 198.514 360.500 C 189.331 370.522, 173.168 388.551, 169.595 392.757 L 167.690 395 196.285 395 L 224.881 395 233.690 384.849 C 238.536 379.265, 246.325 370.595, 251 365.581 C 280.992 333.416, 309.678 302.429, 310.711 301.081 C 311.751 299.723, 315.780 303.383, 339.247 327 C 354.276 342.125, 375.458 363.619, 386.319 374.765 L 406.066 395.030 435.473 394.765 L 464.880 394.500 402.990 332 C 368.950 297.625, 341.077 269.134, 341.050 268.687 C 341.022 268.239, 344.262 264.404, 348.250 260.163 C 363.227 244.236, 396.868 207.341, 400.120 203.276 C 403.302 199.299, 408.393 193.724, 435.526 164.500 C 454.360 144.215, 466 131.275, 466 130.623 C 466 130.280, 453.030 130, 437.178 130 L 408.355 130 402.428 136.741 M 133.032 311.750 C 133.057 376.215, 133.321 393.166, 134.282 391.920 C 134.952 391.051, 138.197 386.776, 141.492 382.420 C 144.788 378.064, 153.670 367.214, 161.230 358.309 L 174.975 342.117 175.237 306.309 L 175.500 270.500 201 270.166 L 226.500 269.832 239 255.880 C 245.875 248.206, 253.905 239.244, 256.845 235.964 L 262.190 230 197.595 230 L 133 230 133.032 311.750';

interface BrandMarkProps {
  className?: string;
  /** Si fourni → `role="img"` + nom accessible. Sinon décoratif (aria-hidden). */
  title?: string;
}

/**
 * Composant présentationnel pur (server-safe — pas de hook). Le `<path>` hérite
 * de `currentColor`, donc on pilote la couleur via `text-…` sur le parent.
 */
export function BrandMark({ className, title }: BrandMarkProps) {
  return (
    <svg
      viewBox={FX_VIEWBOX}
      fill="currentColor"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <path fillRule="evenodd" d={FX_PATH} />
    </svg>
  );
}
