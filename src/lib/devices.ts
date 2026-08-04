/**
 * Catalogue des appareils.
 *
 * Un profil = la géométrie de la matrice (`buildGeometry`) plus le calage de la
 * préview. Tout le reste de l'application — pipeline, rendu, exports — ne
 * connaît que ce type : ajouter un appareil, c'est ajouter une entrée ici.
 *
 * Les coordonnées de préview suivent la convention CSS du cadre : **x et
 * diamètres en fraction de la largeur**, **y en fraction de la hauteur**. C'est
 * ce qui garde le calage quand la préview est redimensionnée.
 *
 * Sources des chiffres :
 *   Phone (3)       relevé sur photo, repris de SPECS-PREVIEW.md (GlyphLapse).
 *   Phone (4a) Pro  489 → 137 LEDs et « cercle 57 % plus grand » sont publiés ;
 *                   la grille 13 × 13 est confirmée par le SDK. Le reste du dos
 *                   est un **schéma**, pas un relevé — voir BACKDROP ci-dessous.
 */

import { buildGeometry, type Geometry } from "./matrix";

export type DeviceId = "phone3" | "phone4apro";

/** Un disque du dos : centre dans le cadre, diamètre en fraction de largeur. */
export type Disc = { left: number; top: number; pct: number };

/**
 * Fond du mode « téléphone ».
 *
 * `photo` est un relevé sur l'appareil réel. `plate` est un schéma tracé au
 * filet : quand on n'a pas la photo, mieux vaut un plan coté qui s'assume qu'un
 * rendu approximatif qui se ferait passer pour l'objet.
 */
export type Backdrop =
  | { kind: "photo"; src: string; alt: string }
  | {
      kind: "plate";
      /** Îlot caméra, en fractions du cadre. */
      plateau: { left: number; top: number; width: number; height: number };
      lenses: Disc[];
    };

export type Device = Geometry & {
  id: DeviceId;
  /** Nom complet, pour l'en-tête. */
  name: string;
  /** Référence courte façon Nothing, pour le sélecteur. */
  ref: string;
  /** largeur / hauteur du cadre de préview. */
  aspect: number;
  backdrop: Backdrop;
  disc: Disc;
  /** Glyph Button — c'est lui qui porte l'A/B « maintenir pour comparer ». */
  button: Disc;
};

/* -------------------------------------------------------------------------- */

const PHONE3: Device = {
  ...buildGeometry(25),
  id: "phone3",
  name: "Nothing Phone (3)",
  ref: "(3)",
  aspect: 704 / 913,
  backdrop: {
    kind: "photo",
    src: "/phone3-back.webp",
    alt: "Dos d'un Nothing Phone (3)",
  },
  disc: { left: 0.7953, top: 0.1536, pct: 0.2604 },
  button: { left: 0.8453, top: 0.7482, pct: 0.1586 },
};

/**
 * Le dos du (4a) Pro est tracé, pas photographié. Ce qui y est **exact** : les
 * 137 LEDs, la grille 13 × 13, et le diamètre du disque — 57 % de plus que
 * celui du (3) à largeur d'appareil égale, soit 0,2604 × 1,57. C'est la seule
 * mesure publiée, et c'est celle qui compte : elle fixe l'échelle réelle des
 * LEDs, donc ce que le mode « téléphone » a à dire.
 *
 * Ce qui est **schématique** : la découpe du plateau, les trois objectifs et la
 * position du bouton. Le plan respecte ce qui est décrit — matrice en haut à
 * gauche du plateau, optiques à sa droite, bouton en bas à gauche — sans
 * prétendre au relevé au millimètre. Le cadre est volontairement moins haut que
 * celui du (3) : à disque plus large, le rogner autant n'aurait plus de sens.
 */
const PHONE4A_PRO: Device = {
  ...buildGeometry(13),
  id: "phone4apro",
  name: "Nothing Phone (4a) Pro",
  ref: "(4a) Pro",
  aspect: 704 / 620,
  backdrop: {
    kind: "plate",
    plateau: { left: 0.04, top: 0.04, width: 0.74, height: 0.62 },
    lenses: [
      { left: 0.66, top: 0.15, pct: 0.13 },
      { left: 0.66, top: 0.32, pct: 0.13 },
      { left: 0.66, top: 0.49, pct: 0.13 },
    ],
  },
  disc: { left: 0.34, top: 0.3, pct: 0.409 },
  button: { left: 0.12, top: 0.78, pct: 0.13 },
};

export const DEVICES: Device[] = [PHONE3, PHONE4A_PRO];

export const DEFAULT_DEVICE = PHONE3;

/** Profil par identifiant, avec repli — un JSON de session peut mentir. */
export function deviceById(id: unknown): Device {
  return DEVICES.find((d) => d.id === id) ?? DEFAULT_DEVICE;
}

/**
 * Hauteur de bande gardée en colonne unique, en fraction de la largeur du
 * cadre. Dérivée du bas du disque plutôt que posée en dur : le (4a) Pro porte
 * une matrice deux fois plus large, une constante partagée l'aurait décapitée.
 * La marge laisse le fondu de rognage tomber sous les LEDs et non dessus.
 */
export function previewBand(d: Device): number {
  return d.disc.top / d.aspect + d.disc.pct / 2 + 0.17;
}
