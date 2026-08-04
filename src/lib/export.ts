/**
 * Sorties : PNG, IntArray Kotlin, JSON de session.
 *
 * Le Glyph Matrix SDK consomme un IntArray row-major de valeurs 0-255, long de
 * `size²` — 625 sur un Phone (3), 169 sur un Phone (4a) Pro. Même contrat que
 * les renderers de GlyphLapse / GlyphSlot.
 *
 * Chaque sortie tire sa géométrie de `frame.device` et la nomme : un fichier
 * sorti d'ici dit pour quel appareil il a été calculé, sinon deux IntArrays de
 * longueurs différentes finissent par se croiser dans un projet Android.
 */

import { DEFAULT_DEVICE, deviceById, type Device, type DeviceId } from "./devices";
import { toBytes, DEFAULTS, type Frame, type Params } from "./pipeline";
import { DISC_BG, exportGrid, paint, type LedStyle } from "./render";

export const VERSION = "1.1";

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // révoqué après le tick pour laisser au navigateur le temps de lancer le
  // téléchargement — révoquer immédiatement l'annule sur Firefox
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

/** `glyphcast-phone3-2026-08-04-…` — l'appareil fait partie du nom. */
function fileName(d: Device, suffix: string, ext: string): string {
  return `glyphcast-${d.id}-${suffix}${suffix ? "-" : ""}${stamp()}.${ext}`;
}

/* -------------------------------------------------------------------------- */

/** PNG carré du disque, ~600 px de côté, dans le style affiché. */
export async function exportPng(frame: Frame, style: LedStyle = "sharp"): Promise<void> {
  const g = exportGrid(frame.device);
  const cvs = document.createElement("canvas");
  cvs.width = cvs.height = g.size;
  paint(cvs.getContext("2d")!, frame, g, { style, background: DISC_BG[style] });
  const blob = await new Promise<Blob | null>((r) => cvs.toBlob(r, "image/png"));
  if (blob) download(blob, fileName(frame.device, style, "png"));
}

/* -------------------------------------------------------------------------- */

export function toKotlin(frame: Frame, name = "FRAME"): string {
  const d = frame.device;
  const b = toBytes(frame);
  const rows: string[] = [];
  for (let y = 0; y < d.size; y++) {
    const row: string[] = [];
    for (let x = 0; x < d.size; x++) row.push(String(b[y * d.size + x]).padStart(3, " "));
    rows.push("    " + row.join(", ") + (y < d.size - 1 ? "," : ""));
  }
  return [
    `// GlyphCast ${VERSION} — ${d.name}.`,
    `// Matrice ${d.size}×${d.size} row-major, ${d.ledCount} LEDs dans le disque.`,
    `// Valeurs 0-255, à passer tel quel au GlyphMatrixFrame / GlyphMatrixManager.`,
    `val ${name} = intArrayOf(`,
    ...rows,
    `)`,
  ].join("\n");
}

export function downloadKotlin(frame: Frame): void {
  download(
    new Blob([toKotlin(frame)], { type: "text/plain" }),
    fileName(frame.device, "", "kt"),
  );
}

/* -------------------------------------------------------------------------- */

export type Session = {
  format: "glyphcast";
  version: string;
  device: DeviceId;
  size: number;
  ledCount: number;
  params: Params;
  values: number[];
};

export function toSession(frame: Frame, params: Params): Session {
  const d = frame.device;
  return {
    format: "glyphcast",
    version: VERSION,
    device: d.id,
    size: d.size,
    ledCount: d.ledCount,
    params: { ...params },
    values: Array.from(toBytes(frame)),
  };
}

export function downloadJson(frame: Frame, params: Params): void {
  const json = JSON.stringify(toSession(frame, params), null, 2);
  download(
    new Blob([json], { type: "application/json" }),
    fileName(frame.device, "", "json"),
  );
}

/**
 * Bornes de chaque réglage — la source unique, partagée par les curseurs de
 * l'interface et par la validation d'import. Les faire diverger donnerait un
 * curseur qui ment : le pouce épinglé au maximum sur une valeur plus grande.
 */
export const RANGES = {
  zoom: [0.2, 6],
  offsetX: [-1, 1],
  offsetY: [-1, 1],
  rotation: [-180, 180],
  wR: [-1, 2],
  wG: [-1, 2],
  wB: [-1, 2],
  exposure: [-3, 3],
  black: [0, 1],
  white: [0, 1],
  contrast: [-0.9, 3],
  gamma: [0.2, 3],
  sharpen: [0, 2],
  levels: [2, 64],
  ditherAmount: [0, 1],
  ceiling: [0.05, 1],
} as const satisfies Partial<Record<keyof Params, readonly [number, number]>>;

/**
 * Relit une session : les réglages **et** l'appareil sur lequel elle a été
 * calculée. Seules les clés connues sont reprises et les valeurs sont bornées :
 * un JSON édité à la main ne doit pas pouvoir mettre le pipeline dans un état
 * impossible (levels = 0 -> division par zéro).
 *
 * Une session sans champ `device` vient de la 1.0, où le Phone (3) était le
 * seul appareil — c'est le repli de `deviceById`.
 */
export function parseSession(text: string): { device: Device; params: Params } {
  const raw = JSON.parse(text);
  if (raw?.format !== "glyphcast") throw new Error("format inconnu");
  const p = raw.params ?? {};
  const num = (k: keyof typeof RANGES) => {
    const v = Number(p[k]);
    const [lo, hi] = RANGES[k];
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (DEFAULTS[k] as number);
  };
  return {
    device: raw.device === undefined ? DEFAULT_DEVICE : deviceById(raw.device),
    params: {
      zoom: num("zoom"),
      offsetX: num("offsetX"),
      offsetY: num("offsetY"),
      rotation: Math.round(num("rotation")),
      wR: num("wR"),
      wG: num("wG"),
      wB: num("wB"),
      exposure: num("exposure"),
      black: num("black"),
      white: num("white"),
      contrast: num("contrast"),
      gamma: num("gamma"),
      sharpen: num("sharpen"),
      invert: Boolean(p.invert),
      levels: Math.round(num("levels")),
      dither: ["none", "floyd", "bayer"].includes(p.dither) ? p.dither : DEFAULTS.dither,
      ditherAmount: num("ditherAmount"),
      ceiling: num("ceiling"),
    },
  };
}

/* -------------------------------------------------------------------------- */

/** Copie dans le presse-papiers, avec repli sur textarea + execCommand. */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
