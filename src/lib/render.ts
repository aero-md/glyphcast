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
 * Cerne minimal d'un appareil, en largeurs de LED. Ce n'est pas un choix
 * esthétique mais une **borne géométrique** : c'est ce qu'il faut pour qu'aucun
 * coin de LED ne dépasse du hublot.
 *
 * Le masque teste le **centre** des cellules, donc la plus excentrée est à
 * `maxDist` du centre, un peu en deçà du rayon nominal — mais son coin, lui, est
 * plus loin d'une demi-diagonale. Comme la LED ne dépasse jamais la cellule, ce
 * surplus vaut au plus `√2 / 2`.
 *
 * Posé à 0,5 « pour qu'il reste un cerne », il laissait les coins des rangées
 * extrêmes sortir du hublot à certaines largeurs d'écran — le symptôme
 * n'apparaissait que sur les résolutions où la quantification fait tomber le
 * cerne sur son plancher.
 */
const cerneMin = (d: Device) => d.maxDist - d.size / 2 + Math.SQRT1_2;

/**
 * Cerne du disque **dessiné**, en largeurs de LED : mode grand et export PNG.
 *
 * Découplé de `device.margin`, qui ne dit pas la même chose. Sur la photo du dos,
 * le cerne est le hublot noirci : une contrainte, la matrice doit s'y inscrire, et
 * `margin` y est volontairement plus fin que l'appareil pour que la matrice ne
 * paraisse pas perdue dans son verre (voir devices.ts). Ici il n'y a pas de photo
 * — le disque est peint, son bord n'existe que parce qu'on le dessine — donc le
 * cerne est purement esthétique et n'a aucune raison de suivre la cote du hublot.
 *
 * Les avoir confondus a fait rétrécir le cerne du mode grand et des PNG le jour
 * où celui du mode téléphone a été divisé par deux. Cette valeur est celle
 * d'avant, restaurée.
 */
const CERNE_DESSINE = 1.5;

/** Le cerne à viser : celui du profil sur la photo, le décoratif sinon. */
const cerneVise = (d: Device, grand: boolean) => (grand ? CERNE_DESSINE : d.margin);

function cellFor(d: Device, discPx: number, grand = false): number {
  const margin = cerneVise(d, grand);
  // Le cerne vaut `(discPx / cell − size) / 2` : on choisit donc la cellule dont
  // le cerne tombe le plus près de la consigne, et non celle qui approche le
  // mieux la taille idéale. Ce n'est pas la même chose — la relation entre les
  // deux est en 1/cell, et arrondir la cellule fait partir l'écart du mauvais
  // côté une fois sur deux.
  const cerne = (cell: number) => (discPx / cell - d.size) / 2;

  // Plafond : la cellule doit laisser au moins le cerne minimal, ce qui borne du
  // même coup la grille à ce qui rentre dans le hublot.
  const tient = Math.max(1, Math.floor(discPx / (d.size + 2 * cerneMin(d))));
  const ideal = discPx / (d.size + 2 * margin);

  const bas = Math.max(1, Math.min(Math.floor(ideal), tient));
  /* En mode grand, pas d'arrondi vers le haut. Le disque vaut
     `(size + 2 × margin) × cell` : arrondir au-dessus de l'idéal le fait
     **dépasser** le diamètre demandé, d'au plus une cellule entière.

     Sans conséquence en mode téléphone, où le hublot est peint par la photo et
     où rien n'est dessiné à ce diamètre — c'est même là que se gagne la
     cellule de 5 px du (3), son idéal tombant à 4,995. Mais en mode grand le
     disque est une vraie boîte dans une colonne de largeur finie : à 550 px de
     colonne, le (3) réclamait 560 px de disque, que le `max-width` du CSS
     écrasait en ellipse — le canvas, lui, restait positionné sur les 560 et
     sortait du cadre d'un demi-cerne. */
  const haut = grand ? bas : Math.max(1, Math.min(Math.ceil(ideal), tient));
  const ecart = (cell: number) => Math.abs(cerne(cell) - margin);
  return ecart(haut) < ecart(bas) ? haut : bas;
}

function grid(d: Device, cell: number, dpr: number, grand: boolean): Grid {
  const size = d.size * cell;
  const disc = (d.size + 2 * cerneVise(d, grand)) * cell;
  return { cell, size, cssSize: size / dpr, disc, discCss: disc / dpr };
}

/**
 * Grille pour un affichage écran, tenant dans un disque de `discCss` px CSS.
 * Sur un Phone (3) rendu à 500 px de large, le hublot fait 132,45 px (26,49 % du
 * cadre) pour un champ de 125 — 25 cellules de 5 px — et 3,73 px de cerne.
 *
 * `grand` change deux choses à la fois, parce que les deux découlent du même
 * fait — le disque y est **dessiné** et non peint par la photo :
 * - le cerne visé devient le décoratif (`CERNE_DESSINE`) et non la cote du
 *   hublot ;
 * - le disque obtenu ne dépasse jamais `discCss`, puisqu'il vit dans une boîte
 *   de largeur finie. Le mode téléphone, lui, a besoin de l'arrondi vers le
 *   haut (voir `cellFor`).
 */
export function screenGrid(
  d: Device,
  discCss: number,
  dpr = window.devicePixelRatio || 1,
  grand = false,
): Grid {
  return grid(d, cellFor(d, discCss * dpr, grand), dpr, grand);
}

/**
 * Grille pour un export PNG, calée sur un diamètre visé plutôt que sur un nombre
 * de pixels par LED : les deux appareils sortent des fichiers de même
 * encombrement, et c'est la finesse de la matrice qui fait la différence, pas la
 * taille du PNG.
 *
 * Le PNG dessine son propre disque : il prend donc le cerne décoratif, comme le
 * mode grand, et non la cote du hublot de la photo.
 */
export function exportGrid(d: Device, target = 600): Grid {
  return grid(d, cellFor(d, target, true), 1, true);
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
  /**
   * Rendu du disque en grand : la LED y reprend une part de l'écart, sans quoi
   * elle se perd au milieu du vide — voir `ledMetrics`.
   */
  grand?: boolean;
};

const ON = "242,242,239"; // blanc légèrement chaud des LEDs Nothing

/** Fond du disque par style — en soft il est plus clair que les LEDs éteintes. */
export const DISC_BG: Record<LedStyle, string> = { sharp: "#08080a", soft: "#131316" };

const OFF: Record<LedStyle, string> = { sharp: "#1b1b20", soft: "#08080a" };

/**
 * Côté de la LED et marge dans sa cellule.
 *
 * La grandeur réglée est la **LED**, pas l'écart : la cellule est imposée par la
 * grille, donc agrandir la LED resserre l'écart d'autant. `duty` — la part du
 * pas qu'occupe la LED — vient du profil et non d'une constante partagée : le
 * (4a) Pro a des LEDs bien plus jointives que le (3), et les traiter pareil les
 * rendait deux fois trop petites.
 *
 * Le **style** n'entre pas dans le calcul : la taille de LED décrit l'appareil,
 * pas la façon de le regarder.
 *
 * Le **mode**, si. En mode grand la cellule fait deux à cinq fois sa taille du
 * mode téléphone, et la LED, restée à la même proportion, s'y perd au milieu du
 * vide. Or ce mode ne prétend pas émuler l'appareil — il sert à lire LED par LED
 * ce que fait un réglage — donc la LED y **reprend un quart de l'écart**. Le
 * mode téléphone, lui, garde les proportions relevées sur la photo.
 *
 * Reprendre une part de l'écart plutôt qu'appliquer un facteur à la LED donne à
 * chaque appareil ce qu'il a à gagner : le (3), plus aéré, récupère davantage
 * que le (4a) Pro, déjà presque jointif.
 */
const REPRISE = 0.25;

export function ledMetrics(
  cell: number,
  duty: number,
  grand = false,
): { led: number; pad: number } {
  const nominale = cell * duty;
  // au moins 1 px d'écart : deux LEDs jointives ne se distinguent plus
  const led = Math.min(
    cell - 1,
    Math.max(2, Math.round(nominale + (grand ? (cell - nominale) * REPRISE : 0))),
  );
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
  const { style = "sharp", background = null, grand = false } = opts;
  const { size, inside, duty } = frame.device;
  const { led, pad } = ledMetrics(g.cell, duty, grand);
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
