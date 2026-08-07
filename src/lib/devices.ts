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
 * 98,3 % de la largeur du cadre. Ce n'est pas de la coquetterie : à largeur de
 * cadre égale, les deux appareils sont alors montrés à la **même échelle de
 * corps**, et c'est la seule condition pour que comparer les deux matrices
 * veuille dire quelque chose.
 */

import { buildGeometry, type Geometry } from "./matrix";

/* Les dos passent par le pipeline d'assets : Vite leur donne un nom portant
   l'empreinte de leur contenu. Posés dans `public/`, ils gardaient une URL fixe
   et Cloudflare continuait de servir la version périmée longtemps après un
   déploiement — le hublot du (3) est resté non noirci en ligne pendant que le
   Pi servait déjà la bonne image. Ici l'URL change dès que l'image change. */
import phone3Back from "../assets/phone3-back.webp";
import phone4aProBack from "../assets/phone4apro-back.webp";

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
   * Largeur à laquelle le dos est rendu, en px CSS.
   *
   * **Par appareil et non partagée.** La cellule vaut `disc.pct × frameWidth`
   * arrondi à l'entier : une largeur commune faisait qu'ajuster le cerne d'un
   * appareil déplaçait la cellule de l'autre, et donc son écart entre LEDs et sa
   * netteté. Les deux matrices n'ont ni le même nombre de LEDs, ni le même pas,
   * ni le même cerne — elles ne peuvent pas tomber juste à la même largeur.
   *
   * Le prix est assumé : les deux dos ne sont plus affichés à la même taille, on
   * ne peut donc plus comparer les deux matrices à l'échelle. C'est la lisibilité
   * de chacune qui a été retenue. Depuis le passage de la colonne à 550 px les
   * deux valeurs tombent à 1 % l'une de l'autre — c'est une coïncidence de
   * quantification, pas un invariant : ne rien bâtir dessus.
   */
  frameWidth: number;
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
  // 500 px → hublot inscrit de 132,45 pour un champ de 125 (25 cellules de
  // 5 px), soit 3,73 px de cerne de chaque côté. La LED y fait 4 px pour 1
  // d'écart.
  //
  // Valait 792 px, ce qui donnait une cellule de 8 px mais un dos de 1027 px de
  // haut : sur un écran 1080 la mise en page en rognait le tiers bas, et le
  // téléphone paraissait affiché à la loupe. La cellule de 5 px est le prix payé
  // pour que le dos tienne entier dans la hauteur.
  //
  // Puis 528, où le cerne tombait à 7,4 px : la cellule y était déjà bloquée à 5
  // par le plancher géométrique, donc les 8 px de largeur en trop passaient
  // intégralement dans le cerne. Le ramener à 500 rend l'écart au hublot deux
  // fois plus fin **sans toucher à la cellule** — la matrice est identique, c'est
  // le hublot qui se resserre autour d'elle.
  frameWidth: 500,
  photo: { src: phone3Back, alt: "Dos d'un Nothing Phone (3)" },
  /* Meilleur **cercle inscrit** dans le hublot noirci : rayon 93,3 px centré en
     (560,5 ; 140,5) dans un cadre de 704 × 913.

     Inscrit et non englobant. Le hublot n'est pas un cercle parfait — son rayon
     va de 93,3 à 100 px selon l'angle — et le relevé précédent, pris sur la
     boîte englobante, le surestimait donc de 6 %. La matrice était dimensionnée
     d'autant trop grand et ses coins sortaient du hublot dans les directions
     étroites, à certaines largeurs d'écran seulement.

     **Mesuré dans les pixels de la photo.** Le hublot noirci y occupe la boîte
     x 461–660, y 41–239. Selon la définition qu'on prend du centre :

       cercle inscrit    (561   ; 139,5)   rayon 92,5   ← `left` vient d'ici
       boîte englobante  (560,5 ; 140,0)
       centroïde         (561,4 ; 140,3)

     `left` = 561/704. `top` = 140,9/913, soit **un pixel de rendu sous le centre
     du cercle inscrit** — au-delà des trois relevés, mais dans leur sens : le
     biseau du verre éclaircit le haut du hublot, donc le bord perçu tombe plus
     bas que le bord du noir pur. Ce pixel-là est un ajustement visuel assumé,
     pas une mesure, et c'est le seul.

     Ne pas en ajouter d'autres au jugé sans vérifier contre la photo. Ça a été
     fait une fois — deux nudges d'un pixel qui ont fini par poser la matrice
     1,7 px trop à droite **et** trop bas — parce que la cible bougeait : tant
     que le canvas s'arrondissait sur une origine écran fractionnaire, sa
     position oscillait de ±0,5 px selon la largeur de la fenêtre. C'est réglé
     côté Preview (le cadre est reposé sur la grille de pixels physiques), donc
     ce qu'on voit ici est stable — un écart constaté est désormais réel. */
  disc: { left: 0.79688, top: 0.15433, pct: 0.2649 },
  /* Trois quarts de LED. Le relevé du verre entier en suggérait deux, et cette
     consigne est passée par 1,5 avant d'atterrir ici — à l'écran, une cellule et
     demie de cerne fait un bord noir de 7,4 px autour d'une matrice de 125, ce
     qui se lit comme une matrice trop petite pour son hublot plutôt que comme le
     cerne de l'appareil. La moitié suffit à le poser.

     Reste au-dessus du plancher géométrique (0,576 ici, voir `cerneMin`) : aucun
     coin de LED ne sort du hublot. */
  margin: 0.75,
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
  // 522 px → hublot inscrit de 175,71 pour un champ de 143 (13 cellules de
  // 11 px), soit 16,35 px de cerne de chaque côté. La LED y fait 9 px pour 2
  // d'écart.
  //
  // Valait 739 px (cellule de 16), ramené une première fois parce que le dos ne
  // tenait pas en hauteur sur un écran 1080. Puis 513, le temps d'un essai à
  // cerne fin — voir `margin` : cet appareil le porte large, contrairement au
  // (3), et le resserrer lui allait mal.
  frameWidth: 522,
  photo: { src: phone4aProBack, alt: "Dos d'un Nothing Phone (4a) Pro" },
  // meilleur cercle inscrit dans le hublot noirci : rayon 118,5 px centré en
  // (485,5 ; 210). Inscrit et non englobant, pour la même raison que le (3).
  disc: { left: 0.6896, top: 0.23, pct: 0.3366 },
  /* **Mesurée, et gardée telle quelle.** Le relevé sur la photo d'origine, avant
     noircissement, donne un pas de 18,67 px dans un hublot de 300 (source
     2048²) : le champ de LEDs fait 13 × 18,67 = 242,7 px et le cerne
     (300 − 242,7)/2 = 28,6 px, soit 1,53 pas.

     Essayée à 0,7 — la moitié — en même temps que celle du (3), au nom de la
     cohérence entre les deux appareils. Mauvaise idée : c'est la cohérence avec
     **l'appareil** qui compte, et le (4a) Pro porte réellement un cerne large là
     où celui du (3) était surestimé. À l'œil, le fin lui allait mal.

     Les deux appareils ont donc des consignes très différentes, et c'est normal :
     le (3) est à 0,75 parce que son relevé se fait sur le verre entier, biseau
     compris, ce qui surestime ; celui-ci est à 1,5 parce que sa cote vient du
     pas des LEDs lui-même. */
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
