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
  /** Côté du canvas en pixels de backing. */
  size: number;
  /** Côté correspondant en pixels CSS — ratio backing/CSS exactement 1. */
  cssSize: number;
};

/**
 * Grille pour un affichage écran, calibrée sur `cellCss` px CSS par LED.
 * Sur un Phone (3), 6 px CSS × 25 = 150 px, soit le diamètre réel de la matrice
 * quand le téléphone est rendu à 576 px de large (26,04 % du cadre photo).
 */
export function screenGrid(
  d: Device,
  cellCss = 6,
  dpr = window.devicePixelRatio || 1,
): Grid {
  const cell = Math.max(3, Math.round(cellCss * dpr));
  const size = d.size * cell;
  return { cell, size, cssSize: size / dpr };
}

/**
 * Grille pour un export PNG, calée sur un côté visé plutôt que sur un nombre de
 * pixels par LED : les deux appareils sortent des fichiers de même encombrement,
 * et c'est la finesse de la matrice qui fait la différence, pas la taille du
 * PNG. 600 px → 24 px/LED sur le (3), 46 px/LED sur le (4a) Pro.
 */
export function exportGrid(d: Device, target = 600): Grid {
  const cell = Math.max(1, Math.round(target / d.size));
  const size = d.size * cell;
  return { cell, size, cssSize: size };
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
 * Côté de la LED et marge, par style. Le gap est forcé pair pour que la marge
 * reste entière : une demi-marge rendrait un bord flou à chaque cellule.
 */
export function ledMetrics(cell: number, style: LedStyle): { led: number; pad: number } {
  const gapHalf = Math.max(1, Math.round(cell * (style === "soft" ? 0.14 : 0.167)));
  const led = Math.max(2, cell - 2 * gapHalf);
  return { led, pad: (cell - led) / 2 };
}

export function paint(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  g: Grid,
  opts: PaintOpts = {},
): void {
  const { style = "sharp", background = null } = opts;
  const { size, inside } = frame.device;
  const { led, pad } = ledMetrics(g.cell, style);
  const radius = style === "soft" ? led * 0.24 : 0;
  const rounded = radius > 0.5 && typeof ctx.roundRect === "function";

  ctx.clearRect(0, 0, g.size, g.size);
  if (background) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.size / 2, g.size / 2, g.size / 2, 0, Math.PI * 2);
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

    const px = x * g.cell + pad;
    const py = y * g.cell + pad;
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
