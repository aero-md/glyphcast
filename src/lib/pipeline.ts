/**
 * Conversion image -> Glyph Matrix.
 *
 * La matrice est monochrome : une LED n'a qu'une luminosité. Les réglages R/G/B
 * ne colorent donc rien, ils pondèrent la contribution de chaque canal à la
 * luminance — exactement un filtre coloré en photo noir et blanc (un poids
 * rouge élevé éclaircit les peaux et noircit un ciel bleu).
 *
 * Chaîne :
 *   cadrage -> supersample -> linéarisation -> luma pondérée -> moyenne de zone
 *   -> ré-encodage perceptuel -> netteté -> tonalité -> quantification (+dither)
 *   -> masque disque
 *
 * Le downsample se fait en lumière **linéaire** : moyenner des valeurs sRGB
 * assombrit les zones contrastées (le classique gris à 50 % d'un damier
 * noir/blanc, qui devrait être ~73 % en sRGB).
 *
 * Chaque étape lit sa taille de grille dans le profil d'appareil. Les réglages,
 * eux, n'en dépendent pas : ce sont des grandeurs photographiques, pas des
 * mesures en LEDs. C'est ce qui permet de basculer d'un appareil à l'autre sans
 * rien perdre — seule la grille change sous l'image.
 */

import type { Device } from "./devices";

export type DitherMode = "none" | "floyd" | "bayer";

export type Params = {
  /* --- cadrage --- */
  zoom: number; // 1 = cover
  offsetX: number; // -1..1, fraction d'un demi-cadre
  offsetY: number;
  rotation: number; // degrés

  /* --- mixeur de canaux --- */
  wR: number;
  wG: number;
  wB: number;

  /* --- tonalité --- */
  exposure: number; // stops, -3..3
  black: number; // gate bas, 0..1
  white: number; // gate haut, 0..1
  contrast: number; // -1..3
  gamma: number; // 0.2..3
  sharpen: number; // 0..2
  invert: boolean;

  /* --- sortie --- */
  levels: number; // 2..256 paliers de luminosité
  dither: DitherMode;
  ditherAmount: number; // 0..1
  ceiling: number; // luminosité max envoyée à la LED, 0..1
};

export const DEFAULTS: Params = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  wR: 0.2126,
  wG: 0.7152,
  wB: 0.0722,
  exposure: 0,
  black: 0,
  white: 1,
  contrast: 0,
  gamma: 1,
  sharpen: 0.35,
  invert: false,
  levels: 16,
  dither: "none",
  ditherAmount: 1,
  ceiling: 1,
};

/** Presets du mixeur — les poids sont normalisés à la volée, pas besoin de somme 1. */
export const CHANNEL_PRESETS: Record<string, [number, number, number]> = {
  LUMA: [0.2126, 0.7152, 0.0722], // Rec. 709, la référence perceptuelle
  ÉGAL: [1, 1, 1],
  ROUGE: [1, 0.15, 0],
  VERT: [0.1, 1, 0.1],
  BLEU: [0, 0.2, 1],
  "CIEL NOIR": [1.4, 0.4, -0.4], // filtre rouge photo : ciel dense, nuages détachés
};

/* -------------------------------------------------------------------------- */
/* sRGB <-> linéaire                                                          */
/* -------------------------------------------------------------------------- */

const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function encodeSrgb(l: number): number {
  if (l <= 0) return 0;
  if (l >= 1) return 1;
  return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

/* -------------------------------------------------------------------------- */
/* 1. Cadrage + échantillonnage                                                */
/* -------------------------------------------------------------------------- */

/**
 * Dessine la source dans un canvas `sample × sample`, cadrée en cover, sur fond
 * noir : une image à canal alpha voit ses zones transparentes s'éteindre, ce
 * qui est le comportement attendu d'un rendu LED.
 */
export function sampleSource(
  d: Device,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  p: Params,
  target?: HTMLCanvasElement,
): HTMLCanvasElement {
  const S = d.sample;
  const cvs = target ?? document.createElement("canvas");
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext("2d", { willReadFrequently: true })!;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);

  // cover : la plus grande des deux échelles, pour que l'image couvre le cadre
  const cover = Math.max(S / srcW, S / srcH);
  const s = cover * Math.max(0.05, p.zoom);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(S / 2 + (p.offsetX * S) / 2, S / 2 + (p.offsetY * S) / 2);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.drawImage(src, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  return cvs;
}

/* -------------------------------------------------------------------------- */
/* 2. Moyenne de zone -> grille perceptuelle                                   */
/* -------------------------------------------------------------------------- */

function downsample(d: Device, data: Uint8ClampedArray, p: Params): Float32Array {
  // les poids sont normalisés : monter R sans toucher G/B ne doit pas
  // surexposer l'image entière, ça doit rééquilibrer les teintes
  const sum = p.wR + p.wG + p.wB;
  const n = Math.abs(sum) < 1e-4 ? 1 : sum;
  const wR = p.wR / n;
  const wG = p.wG / n;
  const wB = p.wB / n;

  const { size, ss, sample } = d;
  const out = new Float32Array(d.cells);
  const inv = 1 / (ss * ss);

  for (let cy = 0; cy < size; cy++) {
    for (let cx = 0; cx < size; cx++) {
      let acc = 0;
      const y0 = cy * ss;
      const x0 = cx * ss;
      for (let y = 0; y < ss; y++) {
        let o = ((y0 + y) * sample + x0) * 4;
        for (let x = 0; x < ss; x++, o += 4) {
          acc +=
            wR * TO_LINEAR[data[o]] +
            wG * TO_LINEAR[data[o + 1]] +
            wB * TO_LINEAR[data[o + 2]];
        }
      }
      // ré-encodage perceptuel : la valeur d'une LED est une consigne PWM, mais
      // l'œil la lit en gamma. Sans ce retour en sRGB tout le rendu est trop sombre.
      out[cy * size + cx] = encodeSrgb(Math.max(0, acc * inv));
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 3. Netteté (unsharp mask sur la grille de LEDs)                             */
/* -------------------------------------------------------------------------- */

/**
 * Le noyau reste 3 × 3 **en LEDs** sur les deux appareils. C'est l'invariant
 * qui compte : la netteté agit sur le voisinage d'une LED, pas sur une distance
 * en pixels d'image. Un curseur réglé sur le (3) fait donc la même chose sur le
 * (4a) Pro — à cette réserve près qu'il y porte trois fois plus loin en surface.
 */
function unsharp(d: Device, v: Float32Array, amount: number): Float32Array {
  if (amount <= 0.001) return v;
  const { size, cells } = d;
  const blur = new Float32Array(cells);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      let w = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
          const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          acc += v[yy * size + xx] * k;
          w += k;
        }
      }
      blur[y * size + x] = acc / w;
    }
  }
  const out = new Float32Array(cells);
  for (let i = 0; i < cells; i++) out[i] = v[i] + amount * (v[i] - blur[i]);
  return out;
}

/* -------------------------------------------------------------------------- */
/* 4. Tonalité                                                                 */
/* -------------------------------------------------------------------------- */

function tone(d: Device, v: Float32Array, p: Params): Float32Array {
  const gain = Math.pow(2, p.exposure);
  // garde-fou : black >= white produirait une division par ~0 et un rendu binaire
  const lo = Math.min(p.black, p.white - 0.01);
  const span = Math.max(0.01, p.white - lo);
  const k = 1 + Math.max(-0.99, p.contrast);
  const g = Math.max(0.05, p.gamma);

  const out = new Float32Array(d.cells);
  for (let i = 0; i < d.cells; i++) {
    let x = v[i] * gain;
    x = (x - lo) / span; // gates : point noir / point blanc
    x = (x - 0.5) * k + 0.5; // contraste autour du gris moyen
    x = x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(x, g);
    out[i] = p.invert ? 1 - x : x;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 5. Quantification + dithering                                               */
/* -------------------------------------------------------------------------- */

// prettier-ignore
const BAYER4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
];

function quantize(d: Device, v: Float32Array, p: Params): Float32Array {
  const { size, cells, isInside } = d;
  const levels = Math.max(2, Math.round(p.levels));
  const step = 1 / (levels - 1);
  const out = new Float32Array(cells);

  if (p.dither === "floyd") {
    // Diffusion d'erreur en serpentin. L'erreur n'est propagée qu'aux cellules
    // du disque : la pousser hors du masque la ferait disparaître et
    // assombrirait tout le bord de la matrice.
    const buf = Float32Array.from(v);
    const push = (x: number, y: number, e: number) => {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      const i = y * size + x;
      if (isInside[i]) buf[i] += e;
    };
    for (let y = 0; y < size; y++) {
      const ltr = y % 2 === 0;
      for (let n = 0; n < size; n++) {
        const x = ltr ? n : size - 1 - n;
        const i = y * size + x;
        if (!isInside[i]) continue;
        const old = buf[i];
        const q = Math.min(1, Math.max(0, Math.round(old / step) * step));
        out[i] = q;
        const e = (old - q) * p.ditherAmount;
        const dx = ltr ? 1 : -1;
        push(x + dx, y, (e * 7) / 16);
        push(x - dx, y + 1, (e * 3) / 16);
        push(x, y + 1, (e * 5) / 16);
        push(x + dx, y + 1, (e * 1) / 16);
      }
    }
    return out;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!isInside[i]) continue;
      let val = v[i];
      if (p.dither === "bayer") {
        const t = BAYER4[(y % 4) * 4 + (x % 4)] / 16 - 0.5;
        val += t * step * p.ditherAmount;
      }
      out[i] = Math.min(1, Math.max(0, Math.round(val / step) * step));
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Pipeline complet                                                            */
/* -------------------------------------------------------------------------- */

export type Frame = {
  /**
   * L'appareil qui a produit la trame. Porté par la trame et non passé à part :
   * un rendu, un export ou un compteur ne peut alors pas se tromper de
   * géométrie, même en pleine bascule d'appareil.
   */
  device: Device;
  /** `device.cells` valeurs 0..1, row-major, 0 hors disque. */
  values: Float32Array;
  /** Nombre de LEDs allumées (> 0) parmi les `device.ledCount` du disque. */
  lit: number;
  /** Luminosité moyenne sur le disque, 0..1. */
  mean: number;
};

export function emptyFrame(d: Device): Frame {
  return { device: d, values: new Float32Array(d.cells), lit: 0, mean: 0 };
}

export function convert(
  d: Device,
  src: CanvasImageSource | null,
  srcW: number,
  srcH: number,
  p: Params,
  scratch?: HTMLCanvasElement,
): Frame {
  if (!src || !srcW || !srcH) return emptyFrame(d);

  const cvs = sampleSource(d, src, srcW, srcH, p, scratch);
  const ctx = cvs.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, d.sample, d.sample);

  let v = downsample(d, data, p);
  v = unsharp(d, v, p.sharpen);
  v = tone(d, v, p);
  v = quantize(d, v, p);

  const ceiling = Math.min(1, Math.max(0, p.ceiling));
  let lit = 0;
  let sum = 0;
  for (let i = 0; i < d.cells; i++) {
    if (!d.isInside[i]) {
      v[i] = 0;
      continue;
    }
    v[i] *= ceiling;
    if (v[i] > 0) lit++;
    sum += v[i];
  }

  return { device: d, values: v, lit, mean: sum / (lit || 1) };
}

/** Conversion en consignes 0-255, le format attendu par le Glyph Matrix SDK. */
export function toBytes(f: Frame): Uint8Array {
  const out = new Uint8Array(f.device.cells);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(f.values[i] * 255);
  return out;
}
