/**
 * Catalogue des appareils.
 *
 * Un profil = la géométrie de la matrice (`buildGeometry`) plus le calage de la
 * préview sur la photo du dos. Tout le reste de l'application — pipeline, rendu,
 * exports — ne connaît que ce type : ajouter un appareil, c'est ajouter une
 * entrée ici et une photo dans `public/`.
 *
 * Les coordonnées de préview suivent la convention CSS du cadre : **x et
 * diamètres en fraction de la largeur**, **y en fraction de la hauteur**. C'est
 * ce qui garde le calage quand la préview est redimensionnée.
 *
 * Les deux photos sont recadrées sur le même gabarit — 704 × 913, corps occupant
 * 98,3 % de la largeur du cadre. Ce n'est pas de la coquetterie : à 576 px de
 * large, les deux appareils sont alors montrés à la **même échelle de corps**,
 * et c'est la seule condition pour que comparer les deux matrices veuille dire
 * quelque chose.
 */

import { buildGeometry, type Geometry } from "./matrix";

export type DeviceId = "phone3" | "phone4apro";

/** Un disque du dos : centre dans le cadre, diamètre en fraction de largeur. */
export type Disc = { left: number; top: number; pct: number };

export type Device = Geometry & {
  id: DeviceId;
  /** Nom complet, pour l'en-tête. */
  name: string;
  /** Référence courte façon Nothing, pour le sélecteur. */
  ref: string;
  /** largeur / hauteur du cadre de préview. */
  aspect: number;
  photo: { src: string; alt: string };
  disc: Disc;
  /**
   * Glyph Button — c'est lui qui porte l'A/B « maintenir pour comparer ».
   * Absent quand l'appareil n'en a pas : la comparaison bascule alors sur le
   * bouton en barre sous la préview, celui du mode « grand ».
   */
  button?: Disc;
};

/* -------------------------------------------------------------------------- */

const PHONE3: Device = {
  ...buildGeometry(25),
  id: "phone3",
  name: "Nothing Phone (3)",
  ref: "(3)",
  aspect: 704 / 913,
  photo: { src: "/phone3-back.webp", alt: "Dos d'un Nothing Phone (3)" },
  disc: { left: 0.7953, top: 0.1536, pct: 0.2604 },
  button: { left: 0.8453, top: 0.7482, pct: 0.1586 },
};

/**
 * Cotes relevées sur la photo, pas déduites d'un communiqué : disque de 300 px
 * de diamètre centré en (1184,5 ; 390) dans la source 2048², corps large de
 * 842 px — d'où les fractions ci-dessous après recadrage.
 *
 * Le disque fait donc **34 % de plus en diamètre** que celui du (3) à largeur de
 * corps égale (35,62 % contre 26,49 %). La presse de lancement annonçait +57 % ;
 * la photo dit autre chose, et c'est elle qui pilote le rendu.
 *
 * Pas de `button` : le (4a) Pro n'a pas de Glyph Button. La capsule sous la
 * matrice n'en est pas un.
 */
const PHONE4A_PRO: Device = {
  ...buildGeometry(13),
  id: "phone4apro",
  name: "Nothing Phone (4a) Pro",
  ref: "(4a) Pro",
  aspect: 704 / 913,
  photo: { src: "/phone4apro-back.webp", alt: "Dos d'un Nothing Phone (4a) Pro" },
  disc: { left: 0.6867, top: 0.2267, pct: 0.3501 },
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
 * une matrice bien plus large et placée plus bas, une constante partagée
 * l'aurait décapitée. La marge laisse le fondu de rognage tomber sous les LEDs
 * et non dessus.
 */
export function previewBand(d: Device): number {
  return d.disc.top / d.aspect + d.disc.pct / 2 + 0.17;
}
