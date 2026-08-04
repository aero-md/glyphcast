/**
 * Géométrie d'une Glyph Matrix.
 *
 * Les deux matrices Nothing suivent la même construction : une grille carrée de
 * N × N cellules en row-major — l'IntArray attendu par le Glyph Matrix SDK —
 * masquée par un disque centré de rayon N/2. Les cellules hors disque existent
 * dans le tableau mais restent à 0 : le SDK les ignore.
 *
 *   Phone (3)        25 × 25 = 625 cellules, r = 12,5  →  489 LEDs
 *   Phone (4a) Pro   13 × 13 = 169 cellules, r =  6,5  →  137 LEDs
 *
 * Les deux comptes publiés tombent juste avec cette seule formule. C'est ce qui
 * autorise un pipeline unique : changer d'appareil, c'est changer un `size`, pas
 * brancher un deuxième moteur. Rien n'est écrit en dur, tout se recalcule.
 */

export type Geometry = {
  /** Côté de la grille, en cellules. */
  size: number;
  /** `size²` — longueur de l'IntArray attendu par le SDK. */
  cells: number;
  /** Centre du disque, en coordonnées de cellule. */
  cx: number;
  cy: number;
  /** Rayon du masque, en cellules. */
  radius: number;
  /** Indices row-major des cellules à l'intérieur du disque. */
  inside: number[];
  /** Masque par cellule — plus rapide qu'un `inside.includes()` en boucle. */
  isInside: Uint8Array;
  /** Nombre de LEDs pilotables. Calculé, jamais écrit en dur. */
  ledCount: number;
  /**
   * Distance au centre de la LED la plus excentrée, en cellules.
   *
   * Ce n'est pas `radius` : le masque teste le **centre** des cellules, si bien
   * qu'une LED retenue déborde du cercle de rayon `radius` de presque une demi-
   * diagonale. Sur une grille de 13, la plus lointaine est à 6,40 et non 6,5.
   * C'est cette valeur, et pas le rayon nominal, qui dit quel disque contient
   * réellement toutes les LEDs.
   */
  maxDist: number;
  /** Facteur de supersampling : chaque LED intègre `ss × ss` pixels source. */
  ss: number;
  /** Côté du canvas d'échantillonnage, `size × ss`. */
  sample: number;
};

/**
 * Côté visé pour le canvas d'échantillonnage. Le supersampling s'ajuste à la
 * grille plutôt que d'être figé : à facteur constant, une matrice deux fois plus
 * grossière n'échantillonnerait qu'un quart de la surface d'image et l'aliasing
 * reviendrait sur l'appareil qui en a le plus besoin.
 */
const SAMPLE_TARGET = 200;

export function buildGeometry(size: number, radius = size / 2): Geometry {
  const cells = size * size;
  const cx = (size - 1) / 2;
  const cy = cx;

  const inside: number[] = [];
  const isInside = new Uint8Array(cells);
  let maxDist = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const d = Math.hypot(x - cx, y - cy);
      if (d < radius) {
        inside.push(i);
        isInside[i] = 1;
        if (d > maxDist) maxDist = d;
      }
    }
  }

  const ss = Math.max(3, Math.round(SAMPLE_TARGET / size));

  return {
    size,
    cells,
    cx,
    cy,
    radius,
    inside,
    isInside,
    ledCount: inside.length,
    maxDist,
    ss,
    sample: size * ss,
  };
}
