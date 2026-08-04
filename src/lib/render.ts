/**
 * Rendu de la matrice sur un canvas.
 *
 * Une cellule occupe un nombre **entier** de pixels de canvas. Un canvas de
 * taille fixe redimensionné par le navigateur avec un ratio fractionnaire
 * produit une trame irrégulière : une colonne sur n gagne un pixel de gap.
 * La grille est donc calculée depuis le devicePixelRatio, comme dans la préview
 * de GlyphLapse.
 *
 * La géométrie vient de la trame elle-même (`frame.device`) : il n'y a pas de
 * taille de grille à passer en second argument, donc pas de façon de la
 * désaccorder du contenu.
 */

import type { Device } from "./devices";
import type { Frame } from "./pipeline";

export type Grid = {
  /** Pixels de backing par LED — toujours entier. */
  cell: number;
  /** Côté du carré de LEDs, en pixels de backing. */
  size: number;
  /** Côté correspondant en pixels CSS — ratio backing/CSS exactement 1. */
  cssSize: number;
  /** Diamètre du hublot, cerne compris, en pixels de backing. */
  disc: number;
  /** Le même en pixels CSS. */
  discCss: number;
};

/**
 * Une matrice ne va pas jusqu'au bord de sa fenêtre : il reste un cerne noir
 * entre la dernière LED et la découpe. Sa largeur est portée par le profil, en
 * **largeurs de LED** — c'est l'unité dans laquelle l'œil le lit, et la seule
 * qui reste vraie à toutes les tailles d'affichage.
 *
 * Le disque vaut donc `size + 2 × margin` cellules, et c'est de là que se déduit
 * la taille de cellule : sans ça la grille touchait la découpe, ce qu'aucun des
 * deux appareils ne fait.
 */
/**
 * Le cerne minimal qu'on s'autorise, en largeurs de LED. La cellule étant
 * entière, le cerne ne prend que des valeurs discrètes ; quand la consigne
 * tombe entre deux, mieux vaut un cerne trop épais qu'un cerne absent — sans
 * lui la matrice touche sa découpe, ce qu'aucun appareil ne fait.
 */
const CERNE_MIN = 0.5;

function cellFor(d: Device, discPx: number): number {
  // Le cerne vaut `(discPx / cell − size) / 2` : on choisit donc la cellule dont
  // le cerne tombe le plus près de la consigne, et non celle qui approche le
  // mieux la taille idéale. Ce n'est pas la même chose — la relation entre les
  // deux est en 1/cell, et arrondir la cellule fait partir l'écart du mauvais
  // côté une fois sur deux.
  const cerne = (cell: number) => (discPx / cell - d.size) / 2;

  // Plafond : la cellule doit laisser au moins CERNE_MIN, ce qui borne du même
  // coup la grille à ce qui rentre dans le disque.
  const tient = Math.max(1, Math.floor(discPx / (d.size + 2 * CERNE_MIN)));
  const ideal = discPx / (d.size + 2 * d.margin);

  const bas = Math.max(1, Math.min(Math.floor(ideal), tient));
  const haut = Math.max(1, Math.min(Math.ceil(ideal), tient));
  const ecart = (cell: number) => Math.abs(cerne(cell) - d.margin);
  return ecart(haut) < ecart(bas) ? haut : bas;
}

function grid(d: Device, cell: number, dpr: number): Grid {
  const size = d.size * cell;
  const disc = (d.size + 2 * d.margin) * cell;
  return { cell, size, cssSize: size / dpr, disc, discCss: disc / dpr };
}

/**
 * Grille pour un affichage écran, tenant dans un disque de `discCss` px CSS.
 * Sur un Phone (3) rendu à 576 px de large, le disque fait 150 px (26,04 % du
 * cadre) pour 25 LEDs et deux cellules de cerne de chaque côté.
 */
export function screenGrid(
  d: Device,
  discCss: number,
  dpr = window.devicePixelRatio || 1,
): Grid {
  return grid(d, cellFor(d, discCss * dpr), dpr);
}

/**
 * Grille pour un export PNG, calée sur un diamètre visé plutôt que sur un nombre
 * de pixels par LED : les deux appareils sortent des fichiers de même
 * encombrement, et c'est la finesse de la matrice qui fait la différence, pas la
 * taille du PNG.
 */
export function exportGrid(d: Device, target = 600): Grid {
  return grid(d, cellFor(d, target), 1);
}

/**
 * Deux rendus pour la même trame de valeurs.
 *
 * - `sharp` — émulation 1:1 de l'appareil : LED carrée, halo proportionnel à
 *   la luminosité, plancher de 0,25 pour qu'une LED à 1 % se lise quand même
 *   comme allumée. C'est ce qu'on voit sur le dos de l'appareil.
 * - `soft` — affichage tel quel sur un écran : angles légèrement adoucis,
 *   aucun halo, gap plus large, rampe quasi linéaire. Les nuances se lisent
 *   mieux, mais ce n'est plus ce que rend l'appareil.
 */
export type LedStyle = "sharp" | "soft";

export type PaintOpts = {
  style?: LedStyle;
  /** Peint le fond du disque (nécessaire pour un PNG autonome). */
  background?: string | null;
};

const ON = "242,242,239"; // blanc légèrement chaud des LEDs Nothing

/** Fond du disque par style — en soft il est plus clair que les LEDs éteintes. */
export const DISC_BG: Record<LedStyle, string> = { sharp: "#08080a", soft: "#131316" };

const OFF: Record<LedStyle, string> = { sharp: "#1b1b20", soft: "#08080a" };

/**
 * Côté de la LED et marge dans sa cellule.
 *
 * L'écart entre deux LEDs vient du profil (`duty`, la part du pas occupée par
 * la LED) et non d'une constante partagée : le (4a) Pro a des LEDs bien plus
 * jointives que le (3), et les traiter pareil les rendait deux fois trop
 * petites.
 *
 * Le style n'entre pas dans le calcul. L'écart décrit l'appareil, pas la façon
 * de le regarder : le creuser en `soft` revenait à dire que ses LEDs sont plus
 * espacées quand on change de rendu. Ce qui distingue `soft`, ce sont les angles
 * adoucis, l'absence de halo et la rampe alpha — pas la géométrie.
 */
export function ledMetrics(cell: number, duty: number): { led: number; pad: number } {
  const gap = Math.max(1, Math.round(cell * (1 - duty)));
  const led = Math.max(2, cell - gap);
  /* Marge **plancher** et non moitié exacte : c'est ce qui autorise un écart
     impair. Centrer la LED dans sa cellule imposerait une marge à la demie et
     donc un bord flou à chaque cellule, ce qui bornait l'écart aux valeurs
     paires — impossible d'obtenir les 3 px que demande un (4a) Pro à 16 px de
     cellule. Décentrer d'un demi-pixel décale la trame entière d'autant, ce qui
     ne se voit pas ; un bord anticrénelé, si. */
  return { led, pad: Math.floor((cell - led) / 2) };
}

export function paint(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  g: Grid,
  opts: PaintOpts = {},
): void {
  const { style = "sharp", background = null } = opts;
  const { size, inside, duty } = frame.device;
  const { led, pad } = ledMetrics(g.cell, duty);
  const radius = style === "soft" ? led * 0.24 : 0;
  const rounded = radius > 0.5 && typeof ctx.roundRect === "function";

  /* La grille est centrée dans le canvas qu'on lui donne, quel qu'il soit :
     `g.size` à l'écran, où le cerne est peint par le disque en CSS, et `g.disc`
     à l'export, où le PNG doit être autonome. Un seul chemin de rendu pour les
     deux, et rien à recalculer côté appelant. */
  const W = ctx.canvas.width;
  const o = (W - g.size) / 2;

  ctx.clearRect(0, 0, W, ctx.canvas.height);
  if (background) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, ctx.canvas.height / 2, W / 2, 0, Math.PI * 2);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.restore();
  }

  for (const i of inside) {
    const x = i % size;
    const y = (i - x) / size;
    const b = frame.values[i];

    if (b <= 0.02) {
      ctx.fillStyle = OFF[style];
    } else if (style === "soft") {
      // rampe quasi linéaire : sans halo pour porter l'intensité, un plancher
      // haut écraserait tout le bas de la plage sur un même gris
      ctx.fillStyle = `rgba(${ON},${0.08 + 0.92 * b})`;
    } else {
      ctx.fillStyle = `rgba(${ON},${0.25 + 0.75 * b})`;
      ctx.shadowColor = `rgba(${ON},${0.8 * b})`;
      ctx.shadowBlur = g.cell * 0.55 * b;
    }

    const px = o + x * g.cell + pad;
    const py = o + y * g.cell + pad;
    if (rounded) {
      ctx.beginPath();
      ctx.roundRect(px, py, led, led, radius);
      ctx.fill();
    } else {
      ctx.fillRect(px, py, led, led);
    }
    ctx.shadowBlur = 0;
  }
}
