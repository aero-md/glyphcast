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
  /**
   * Photo du dos, **hublot noirci**. C'est une exigence sur l'asset et non une
   * option : la matrice de l'appareil doit avoir été remplie de noir dans
   * l'image. Il n'y a alors rien à masquer, aucun aplat à poser, et c'est le
   * fond de la photo — biseau du verre et reflets compris — qui sert de fond.
   * Une photo qui montrerait encore ses LEDs les laisserait transparaître entre
   * les nôtres.
   */
  photo: { src: string; alt: string };
  disc: Disc;
  /**
   * Cerne entre la découpe de la matrice et la LED la plus proche, **en
   * largeurs de LED**. Aucun des deux appareils ne va jusqu'au bord : il reste
   * une bande noire, et l'ignorer donnait une matrice qui déborde de sa fenêtre.
   *
   * L'unité n'est pas anodine — exprimé en pixels d'écran, le cerne mentirait
   * dès que la préview change de taille. En largeurs de LED il reste juste
   * partout, et le disque vaut simplement `size + 2 × margin` cellules.
   */
  margin: number;
  /**
   * Part du pas occupée par la LED elle-même, le reste étant l'écart entre
   * deux. Les deux appareils n'ont pas du tout la même densité : sur un
   * (4a) Pro l'écart ne vaut qu'un dixième du pas, et le traiter comme celui du
   * (3) donnait des LEDs deux fois trop petites, d'où un rendu qui paraissait
   * flou alors qu'il était net.
   */
  duty: number;
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
  /* Relevé sur la photo au hublot noirci : disque de 199 px centré en
     (561 ; 140) dans un cadre de 704 × 913. C'est le **verre entier**, biseau
     compris, et non la seule zone de LEDs que mesurait le relevé d'origine
     (183,3 px) — d'où un diamètre plus grand et une consigne de cerne plus
     large pour le même rendu. */
  disc: { left: 0.7969, top: 0.1533, pct: 0.2827 },
  // champ de LEDs de ~170 px dans un verre de 199 : 14,5 px de cerne pour une
  // cellule de 6,8, soit deux largeurs de LED
  margin: 2,
  // pas mesurable sur la photo, le hublot n'y montre aucune LED. Estimé un cran
  // plus serré que les deux tiers d'avant, qui creusaient trop les écarts.
  duty: 0.72,
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
  // relevé sur la photo au hublot noirci : disque de 244 px centré en (484,5 ; 207)
  disc: { left: 0.6882, top: 0.2267, pct: 0.3466 },
  /* Relevé sur la photo d'origine, avant noircissement : pas de 18,67 px dans
     un hublot de 300 (source 2048²). Le champ de LEDs fait donc
     13 × 18,67 = 242,7 px, et le cerne (300 − 242,7)/2 = 28,6 px, soit 1,53
     pas — la consigne ci-dessous n'est pas estimée, elle est mesurée. */
  margin: 1.5,
  /* La même mesure donnait une LED de 17 px sur ces 18,67, soit 0,911. C'est
     surestimé : une LED allumée déborde sur la photo, et le seuil de détection
     ramasse son halo autant qu'elle. La valeur retenue est celle qui rend
     3 px d'écart à la cellule de référence de 16 px, ce qui se tient à l'œil. */
  duty: 13 / 16,
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
