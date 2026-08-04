# glyphcast — Spécifications fonctionnelles

Ce document décrit **ce que fait l'application**, dans l'ordre où elle le fait,
avec les formules et les bornes exactes. Il ne traite pas de la direction
artistique.

Référence d'implémentation : `src/lib/matrix.ts`, `src/lib/devices.ts`,
`src/lib/pipeline.ts`, `src/lib/render.ts`, `src/lib/export.ts`.

---

## 1. Objet

Transformer une image arbitraire en une trame de luminosités pilotable par la
**Glyph Matrix** d'un Nothing Phone, avec une préview fidèle et de quoi régler
finement le passage image → LEDs. Deux appareils sont pris en charge — Phone (3)
et Phone (4a) Pro — et la bascule de l'un à l'autre ne perd rien : ni l'image,
ni un seul réglage.

Tout le traitement est exécuté dans le navigateur. Aucune image, aucun réglage,
aucune trame ne quitte la machine : il n'y a pas une seule requête réseau après
le chargement de la page.

Une réserve, à l'honnêteté : le **chargement**, lui, va chercher Geist Mono
chez `fonts.googleapis.com` et `fonts.gstatic.com`. Ça n'expose rien de ce que
l'utilisateur fait dans l'appli, mais ça envoie son IP et son *User-Agent* à
Google à chaque visite. La seule façon de tenir la promesse au sens strict est
d'héberger la fonte avec le reste.

### Hors périmètre

| Non traité | Raison |
|---|---|
| Animations, séquences multi-frames | une seule image fixe par session |
| Envoi direct à l'appareil | pas d'API navigateur pour piloter la Glyph Matrix ; la passerelle est l'export Kotlin |
| Couleur | la matrice est monochrome, la question ne se pose pas |
| Édition d'image (masques, calques, retouche locale) | l'entrée est une image déjà finie |
| Glyph Interface à bandes — Phone (1), (2), (2a), (3a) | ce ne sont pas des matrices ; rien de ce document ne s'y applique |

---

## 2. Cible matérielle

Les deux matrices suivent la **même construction** : une grille carrée de N × N
cellules en row-major, masquée par un disque centré de rayon N/2. Les deux
comptes publiés de LEDs tombent juste avec cette seule formule, ce qui autorise
un pipeline unique.

| Constante | Phone (3) | Phone (4a) Pro | Source |
|---|---:|---:|---|
| `size` | 25 | 13 | côté de la grille |
| `cells` | 625 | 169 | `size²`, row-major |
| Centre | (12, 12) | (6, 6) | `((size − 1)/2)` sur les deux axes |
| `radius` | 12,5 | 6,5 | masque circulaire, `dist < radius` |
| `ledCount` | **489** | **137** | calculé, jamais écrit en dur |
| `maxDist` | 12,369 | 6,403 | LED la plus excentrée, en cellules |
| `ss` | 8 | 15 | échantillons par LED et par axe |
| `sample` | 200 | 195 | côté du canvas d'échantillonnage |
| Profondeur | 0-255 par LED | idem | consigne du Glyph Matrix SDK |
| Canaux | 1 (luminosité) | idem | pas de couleur |

Les cellules hors disque — 136 sur un (3), 32 sur un (4a) Pro — existent dans le
tableau, le SDK attend `size²` entrées, mais valent **toujours 0** et sont
exclues de tous les calculs d'agrégat (comptage, moyenne, auto-gates, diffusion
d'erreur).

`buildGeometry(size)` produit tout ça. Ajouter un appareil, c'est ajouter une
entrée à `DEVICES` dans `src/lib/devices.ts` : rien d'autre dans l'application
ne connaît de taille de grille.

### 2.1 Calage de la préview

Un profil porte aussi la photo du dos et les cotes qui s'y rapportent.
Convention : **x et diamètres en fraction de la largeur du cadre, y en fraction
de sa hauteur**.

| Repère | Phone (3) | Phone (4a) Pro |
|---|---:|---:|
| Photo | `phone3-back.webp` | `phone4apro-back.webp` |
| Cadre | 704 × 913 | 704 × 913 |
| Corps dans le cadre | 98,3 % | 98,3 % |
| Hublot — diamètre | 28,27 % | 34,66 % |
| Hublot — centre | 79,69 % / 15,33 % | 68,82 % / 22,67 % |
| Cerne (`margin`) | 2 LEDs | 1,5 LED |
| Part de LED dans le pas (`duty`) | 0,72 | 13/16 |
| Glyph Button — centre | 84,53 % / 74,82 % | — (il n'y en a pas) |

**Les deux photos ont leur hublot noirci.** C'est une exigence sur l'asset, pas
une option : la matrice de l'appareil doit avoir été remplie de noir dans
l'image. Il n'y a alors rien à masquer, aucun aplat à poser, et c'est le fond de
la photo — biseau du verre et reflets compris — qui sert de fond. Une photo qui
montrerait encore ses LEDs les laisserait transparaître entre les nôtres.

Noircir un hublot change le diamètre qu'on en mesure : sur le (3), il est passé
de 183,3 px (la seule zone de LEDs, visible sur la photo d'origine) à 199 px (le
verre entier). Les cotes ci-dessus sont relevées sur les photos **après**
noircissement.

Le **cerne** est la bande sombre entre la découpe du hublot et la LED la plus
proche. Aucune des deux matrices ne va jusqu'au bord, et l'ignorer donnait une
grille qui touche sa découpe — ce qu'aucun appareil ne fait. Il est exprimé en
**largeurs de LED** : en pixels d'écran il mentirait dès que la préview change
de taille, alors qu'en largeurs de LED il reste juste partout et le hublot vaut
simplement `size + 2 × margin` cellules.

Sur le (3), le hublot mesuré est le **verre entier** (199 px, biseau compris) et
non la seule zone de LEDs (~170 px) : d'où 2 LEDs de cerne. Sur le (4a) Pro, le
relevé de la photo d'origine donne un pas de 18,67 px dans un hublot de 300
(source 2048²), donc un champ de 13 × 18,67 = 242,7 px et un cerne de
(300 − 242,7)/2 = 28,6 px, soit **1,53 pas** — la consigne n'est pas estimée.

#### La part de LED dans le pas

`duty` dit quelle fraction du pas la LED occupe, le reste étant l'écart entre
deux. Les deux appareils n'ont rien à voir : sur un (4a) Pro les LEDs sont
nettement plus jointives, et les traiter comme celles du (3) les rendait deux
fois trop petites — un rendu qui paraissait flou alors qu'il était net au pixel.

La même mesure de photo donnait 17 px de LED sur 18,67 de pas, soit 0,911. C'est
surestimé : une LED allumée déborde sur une photo, et le seuil de détection
ramasse son halo autant qu'elle. La valeur retenue, 13/16, est celle qui rend
**3 px d'écart** à la cellule de référence de 16 px.

#### Le même gabarit pour les deux

Les deux photos sont recadrées au **même format et à la même échelle de corps**.
Ce n'est pas de la symétrie décorative : les deux appareils sont alors montrés à
la même taille, et c'est la seule condition pour que comparer les deux matrices
veuille dire quelque chose. Un dos rendu 10 % plus gros gonflerait sa matrice
d'autant, et la comparaison mentirait d'autant.

Le recadrage du (4a) Pro se déduit donc de la photo du (3) : corps à 98,3 % de
la largeur du cadre, hauteur du cadre à 913/692 de la largeur du corps. Sur une
source de 2048² où le corps mesure 842 px de large, ça donne une fenêtre de
857 × 1111 réduite à 704 × 913 — le format du (3), au millième d'aspect près.

#### Ce que valent les cotes

Toutes relevées **sur la photo**, aucune déduite d'un communiqué. Sur le (4a)
Pro : disque de 300 px de diamètre centré en (1184,5 ; 390) dans la source,
corps large de 842 px.

Le disque fait donc **34 % de plus en diamètre** que celui du (3) à largeur de
corps égale — 35,62 % contre 26,49 %. La presse de lancement annonçait +57 % ;
la photo dit autre chose, et c'est elle qui pilote le rendu.

Le (4a) Pro **n'a pas de Glyph Button**. Son profil n'a donc pas de champ
`button`, et la comparaison avant/après y bascule sur le bouton en barre du mode
« grand » (§ 5.4). La capsule visible sous la matrice n'en est pas un.

La hauteur de bande gardée en colonne unique se **dérive** du bas du disque
(`previewBand`) au lieu d'être posée en dur : le (4a) Pro porte une matrice plus
large et placée plus bas, une constante partagée l'aurait décapitée.

---

## 3. Modèle de données

### `Params` — l'état de réglage complet

Sérialisable, comparable, sans référence à l'image **ni à l'appareil**. Deux
`Params` identiques sur la même image et le même appareil donnent la même trame,
toujours.

Aucun réglage n'est exprimé en LEDs : ce sont des grandeurs photographiques
(stops, gates, gamma, paliers). C'est ce qui rend la bascule d'appareil non
destructive — il n'y a rien à convertir, seule la grille change sous l'image.
Seule la netteté a une portée qui dépend de la grille : son noyau reste 3 × 3
**en LEDs**, donc trois fois plus large en surface sur un (4a) Pro.

### `Frame` — le résultat

| Champ | Type | Contenu |
|---|---|---|
| `device` | `Device` | le profil qui a produit la trame |
| `values` | `Float32Array(device.cells)` | luminosités 0..1, row-major, 0 hors disque |
| `lit` | `number` | nombre de LEDs > 0 parmi les `device.ledCount` |
| `mean` | `number` | luminosité moyenne **des LEDs allumées** (0 si aucune) |

La trame **porte** son appareil au lieu qu'il soit passé à part au rendu et aux
exports : une trame et sa géométrie ne peuvent donc pas se désaccorder, même en
pleine bascule.

`toBytes(frame)` convertit en `Uint8Array(device.cells)` de consignes 0-255 par
`Math.round(v × 255)`.

---

## 4. Chaîne de conversion

Une passe pure, sans état caché. `convert(device, image, w, h, params) → Frame`.

```
1  cadrage        zoom / décalage / rotation, cover sur fond noir
2  échantillon    canvas sample², soit ss × ss échantillons par LED
3  luma           poids R/G/B normalisés, en lumière linéaire
4  downsample     moyenne de zone → size × size, puis ré-encodage sRGB
5  netteté        unsharp 3 × 3
6  tonalité       exposition → gates → contraste → gamma → inversion
7  quantification N paliers, avec ou sans dithering
8  finition       plafond de luminosité, masque disque, agrégats
```

Le supersampling **suit** la grille (`ss ≈ 200 / size`) au lieu d'être figé à 8 :
à facteur constant, la matrice la plus grossière n'échantillonnerait qu'un quart
de la surface d'image et l'aliasing reviendrait sur l'appareil qui en a le plus
besoin.

### 4.1 Cadrage

La source est dessinée dans un canvas `sample × sample` (200 × 200 sur un (3),
195 × 195 sur un (4a) Pro) **rempli de noir au préalable** : les zones
transparentes d'une image à canal alpha s'éteignent, ce qui est le comportement
attendu d'un rendu LED.

```
cover = max(sample / srcW, sample / srcH)
s     = cover × max(0,05, zoom)
tx    = sample/2 + offsetX × sample/2
ty    = sample/2 + offsetY × sample/2
```

Ordre des transformations : translation, puis rotation, puis échelle, l'image
étant dessinée centrée. La rotation ne réajuste pas l'échelle : une image
tournée de 45° laisse apparaître les coins noirs, c'est à l'utilisateur de
compenser au zoom.

Le cadrage est le seul étage qui dépend de la résolution de la source. Les
huit suivants travaillent sur une grille fixe.

### 4.2 Échantillonnage et luminance

Chaque LED intègre `ss²` échantillons — **64** (8 × 8) sur un Phone (3), **225**
(15 × 15) sur un Phone (4a) Pro, dont les LEDs couvrent bien plus de surface.
Pour chacun :

```
lin(c)  = c ≤ 0,04045 ? c/12,92 : ((c + 0,055)/1,055)^2,4     (table de 256)
luma    = wR'·lin(R) + wG'·lin(G) + wB'·lin(B)
```

Les poids sont **normalisés** par leur somme (`n = wR + wG + wB`, ramené à 1
si `|n| < 1e-4`). Monter le rouge seul rééquilibre les teintes au lieu de
surexposer toute l'image.

> **Les curseurs R/G/B ne colorent rien.** La matrice est monochrome ; ces
> poids décident de la part de chaque canal dans la luminance, exactement
> comme un filtre coloré en photo noir et blanc. Un poids négatif est autorisé
> et légitime : c'est ce que fait le preset `CIEL NOIR`.

### 4.3 Downsample

Moyenne arithmétique des `ss²` échantillons, **en lumière linéaire**, puis
ré-encodage sRGB :

```
v = encodeSrgb( moyenne des luma linéaires )
```

Deux décisions qui ne sont pas cosmétiques :

- **Moyenner en linéaire.** Moyenner des valeurs sRGB assombrit les zones
  contrastées — un damier noir/blanc rend un gris à 50 % alors qu'il devrait
  donner ~73 %.
- **Ré-encoder après la moyenne.** La consigne envoyée à une LED est une
  valeur PWM, mais l'œil la lit en gamma. Sans ce retour, tout le rendu sort
  trop sombre.

### 4.4 Netteté

Masque flou sur la grille de LEDs, noyau 3 × 3 pondéré (centre 4, orthogonaux
2, diagonales 1, normalisé), bords tronqués :

```
v' = v + netteté × (v − flou(v))
```

Court-circuité si `netteté ≤ 0,001`. Appliqué **avant** la tonalité : sinon un
gate agressif écrêterait les halos de l'unsharp au lieu du signal.

### 4.5 Tonalité

Ordre fixe, chaque étage sur le résultat du précédent :

```
gain = 2^exposition
lo   = min(pointNoir, pointBlanc − 0,01)
span = max(0,01, pointBlanc − lo)
k    = 1 + max(−0,99, contraste)
g    = max(0,05, gamma)

x = v × gain
x = (x − lo) / span                       gates
x = (x − 0,5) × k + 0,5                   contraste autour du gris moyen
x = clamp(x, 0, 1) puis x^g               gamma
x = inversion ? 1 − x : x
```

Les garde-fous sur `lo`, `span`, `k` et `g` ne sont pas décoratifs :
`pointNoir ≥ pointBlanc` donnerait une division par ~0 et un rendu binaire,
`contraste = −1` aplatirait tout sur un gris unique.

L'exposition est en **IL** (stops), pas en pourcentage : +1 double la
luminance linéaire.

### 4.6 Quantification et dithering

`pas = 1 / (paliers − 1)`, `paliers ∈ [2, 64]`.

| Mode | Comportement |
|---|---|
| `none` | `round(v / pas) × pas` |
| `bayer` | `v += (B₄[y%4][x%4]/16 − 0,5) × pas × force`, puis arrondi |
| `floyd` | diffusion d'erreur 7/3/5/1 sur 16, **en serpentin** (une ligne sur deux à l'envers), erreur multipliée par la force |

**L'erreur de Floyd-Steinberg n'est propagée qu'aux cellules du disque.** La
pousser hors du masque la ferait disparaître et assombrirait tout le bord de
la matrice. Les cellules hors disque sont ignorées à la lecture comme à
l'écriture.

Repère de réglage : à 2 paliers le rendu est binaire et le dithering fait tout
le travail ; au-delà de ~16 paliers la matrice restitue de vrais niveaux de
gris et le dither ne sert plus qu'à casser les bandes dans les dégradés.

### 4.7 Finition

```
pour chaque cellule i :
  hors disque  → values[i] = 0
  dans disque  → values[i] × = plafond
lit  = nombre de values[i] > 0
mean = Σ values[i] / lit          (0 si lit = 0)
```

Le **plafond de luminosité** (5 % à 100 %) borne la consigne maximale envoyée
à une LED. Il s'applique après quantification : il ne réduit pas le nombre de
paliers, il les tasse.

---

## 5. Fonctions de l'interface

### 5.1 Choix de l'appareil

Un sélecteur exclusif, `(3)` / `(4a) Pro`, posé **avant** les deux sélecteurs de
préview : c'est le seul des trois qui change ce qui sort de l'outil, les autres
ne changent que ce qu'on en voit.

La bascule est non destructive et immédiate. Ce qui **ne bouge pas** : l'image
chargée, le cadrage, le mixeur, la tonalité, la sortie LED, l'échelle de préview,
le style de LED, le thème. Ce qui **suit** : la grille et le masque, le compteur
de LEDs, la photo du dos et le calage dessus, l'échelle en px/LED, la présence
d'un Glyph Button, l'en-tête, le pied de page, la longueur de l'IntArray et le
nom des fichiers exportés.

C'est ce qui permet de régler une image une fois et de lire, en un clic, ce que
chacune des deux matrices en garde. Un réglage réencodé à la bascule aurait fait
de la comparaison une approximation.

L'appareil retenu est confirmé par la ligne de notice, avec sa grille et son
nombre de LEDs — un compteur qui change de plafond sans le dire se lirait mal.

### 5.2 Chargement d'une image

Trois voies, toutes équivalentes :

| Voie | Détail |
|---|---|
| Glisser-déposer | sur **n'importe quel point de la page**, pas seulement la zone de dépôt |
| Collage | `Ctrl+V`, premier élément du presse-papiers de type `image/*` |
| Sélecteur de fichier | `accept="image/*"` |

Un fichier dont le type MIME n'est pas `image/*` est refusé avec un message ;
un fichier image que le navigateur ne sait pas décoder l'est aussi. Le
`objectURL` précédent est révoqué au chargement du suivant, jamais avant que
le nouveau soit décodé.

Sans image, la matrice est éteinte, un message explique les trois voies de
chargement, et **il n'y a qu'un seul geste possible dans toute la page** :

| Élément | État sans image |
|---|---|
| Carte `[01] Source` | encadrée d'accent, seule carte en couleur |
| Cartes `[02]` à `[05]` | contenu `inert` et grisé à 32 % |
| Exports `[06]` | boutons `disabled` |
| Glyph Button | `disabled`, sans légende |
| Importer un `.json` | **actif** — il ne restaure que des curseurs |
| Échelle et style de préview | **actifs** — ils règlent le regard, pas l'image |

L'import de session est dans `[01] Source` et non dans `[06] Export` : un
`.json` est une **entrée**, il n'apporte que des réglages. Le mettre parmi les
boutons qui produisent des fichiers mélangeait les deux sens de la carte, et le
laissait par ailleurs actif au milieu de quatre boutons désactivés.

Le verrouillage passe par `inert` sur le corps de carte, pas par un `disabled`
sur chaque contrôle : ça sort aussi la carte de l'ordre de tabulation, et il n'y
a pas quinze occasions d'en oublier un. Les en-têtes `[nn]` restent nets — la
structure numérotée doit rester lisible même éteinte, c'est elle qui annonce ce
qui attend l'image.

Aucun contenu de démonstration n'est affiché : la page ne montre jamais un
résultat que l'utilisateur n'a pas produit.

### 5.3 Réglages

| Réglage | Plage | Défaut | Effet |
|---|---|---:|---|
| Zoom | 0,2 – 6 | 1 | échelle relative au cadrage cover |
| Décalage X / Y | −1 – 1 | 0 | en fraction d'un demi-cadre |
| Rotation | −180 – 180° | 0 | pas de 1°, boutons ± 90° |
| Rouge / Vert / Bleu | −1 – 2 | 0,2126 / 0,7152 / 0,0722 | poids de luminance, normalisés |
| Exposition | −3 – 3 IL | 0 | `× 2^v` |
| Gate — point noir | 0 – 100 % | 0 | plancher de la plage |
| Gate — point blanc | 0 – 100 % | 100 % | plafond de la plage |
| Contraste | −0,9 – 3 | 0 | autour du gris moyen |
| Gamma | 0,2 – 3 | 1 | `x^v` |
| Netteté | 0 – 2 | 0,35 | force de l'unsharp |
| Inversion | booléen | non | `1 − x` |
| Paliers de luminosité | 2 – 64 | 16 | niveaux distincts |
| Plafond de luminosité | 5 – 100 % | 100 % | consigne maximale |
| Dithering | aucun / Floyd / Bayer | aucun | |
| Force du dither | 0 – 100 % | 100 % | visible seulement si dithering actif |

`RANGES` dans `src/lib/export.ts` est la **source unique** de ces bornes :
elles alimentent à la fois les curseurs et la validation d'import. Les faire
diverger donnerait un curseur qui ment, le pouce épinglé au maximum sur une
valeur plus grande.

Chaque curseur affiche une pastille rouge quand sa valeur s'écarte de son
repos, et un clic sur son libellé l'y ramène. **Recadrer** remet les seuls
réglages de cadrage.

Il n'y a **pas** de remise à zéro globale. Elle a existé, posée dans la carte
`[06] Export` entre les boutons de téléchargement : un bouton qui efface vingt
minutes de cadrage à un pixel des boutons qui exportent le résultat. Aucun des
deux voisinages n'était sauvable — ni le libellé, ni la place. Le retour au
repos se fait donc curseur par curseur, ce qui est de toute façon le geste
qu'on veut neuf fois sur dix : on annule *un* réglage, pas tout le travail.

#### Presets du mixeur de canaux

| Preset | Poids R / V / B | Usage |
|---|---|---|
| `LUMA` | 0,2126 / 0,7152 / 0,0722 | Rec. 709, la référence perceptuelle |
| `ÉGAL` | 1 / 1 / 1 | moyenne brute |
| `ROUGE` | 1 / 0,15 / 0 | |
| `VERT` | 0,1 / 1 / 0,1 | |
| `BLEU` | 0 / 0,2 / 1 | |
| `CIEL NOIR` | 1,4 / 0,4 / −0,4 | filtre rouge photo : ciel dense, nuages détachés |

#### Auto-gates

Étale l'histogramme sur toute la plage. Une passe de sonde est calculée avec
`black = 0`, `white = 1`, `contrast = 0`, `gamma = 1`, `levels = 256`,
`dither = none` — le reste des réglages inchangé — puis :

```
lo, hi = min et max sur les cellules du disque uniquement (489 ou 137)
si hi − lo < 0,02 → abandon, la plage est trop plate
pointNoir  = max(0, lo − 0,01)
pointBlanc = min(1, hi + 0,01)
```

Le balayage doit ignorer les cellules hors disque : elles valent toujours 0 et
cloueraient le point noir à 0 quelle que soit l'image.

### 5.4 Comparaison avant / après

Maintenir le **Glyph Button** ou le bouton **Maintenir** en barre affiche le
rendu de référence : mêmes réglages de **cadrage**, tout le reste aux valeurs
par défaut. C'est ce que donnerait l'image sans aucun réglage tonal — pas
l'image d'origine, qui n'aurait pas le même cadrage et ne serait donc pas
comparable.

Lequel des deux s'affiche dépend de ce qu'il y a à l'écran : le Glyph Button
quand le profil en déclare un et qu'on est en mode téléphone, le bouton en barre
sinon — mode grand, ou appareil sans Glyph Button comme le (4a) Pro. La fonction
ne dépend donc d'aucun bouton physique ; seule sa mise en scène change.

Le relâchement, la sortie du pointeur et l'annulation du geste par le
navigateur reviennent tous au rendu courant. Au clavier, `Entrée` / `Espace`
maintiennent tant que la touche est enfoncée.

Sans image, il n'y a rien à comparer : le bouton est désactivé et le rappel
« maintenir » n'est pas affiché — une légende qui promet une action que le
bouton ne rend pas se lit comme un bug.

À noter que tant qu'**aucun réglage tonal n'a été touché**, la référence est
identique au rendu courant au dither près, et maintenir ne montre donc presque
rien. C'est correct, pas une panne : la comparaison n'a de contenu qu'une fois
qu'il y a quelque chose à comparer.

### 5.5 Préview

Deux axes indépendants.

**Échelle** :

| Mode | Rendu |
|---|---|
| Téléphone | matrice calée sur le hublot de la photo, cerne compris |
| Grand | hublot seul, sur toute la largeur de la colonne |

Les deux sont larges de `min(728, largeur de colonne)`.

**728 px n'est pas un encombrement, c'est une taille de LED.** À cette largeur
le hublot du (3) fait 206 px, ce qui laisse **7 px CSS par LED** en gardant ses
deux largeurs de cerne, et celui du (4a) Pro 252 px, soit **16 px**. À 576 px
les mêmes contraintes tombaient sur 6 et 13, et à 6 px une LED ne fait plus que
4 px de côté — elle se lit comme du bruit. Les deux dos étant recadrés à la même
échelle de corps (§ 2.1), le rapport entre les deux matrices reste juste.

C'est un arbitrage assumé : la préview ne prétend plus rendre l'appareil à sa
taille physique, elle le rend à la taille où sa matrice se lit.

**Le téléphone n'est jamais réduit pour tenir en hauteur** — le rétrécir
viderait le mode de son sens. Quand la place manque il est **rogné par le
bas** : le disque est dans le haut de l'appareil, ce qu'on perd est le bas du
dos, décoratif. D'où l'alignement en haut du cadre, un centrage rognerait des
deux côtés et mangerait la matrice.

Le disque seul, lui, **se réduit** plutôt que d'être rogné : il n'a pas
d'échelle réelle à préserver et le couper ferait perdre des LEDs.

Seule une colonne plus étroite que 728 px contraint la largeur, et la cellule
suit alors le diamètre réellement affiché : une valeur figée donnerait une
trame irrégulière. La bascule en colonne unique se fait à **1140 px** et non à
980 : en dessous, 728 px de téléphone, 25,6 de gouttière et les 300 px minimum
du rack ne tiennent plus côte à côte, marges comprises.

Un fondu de 56 px (28 px en colonne unique) marque le bord du rognage, et
seulement quand il y a rognage. Les photos se terminent en outre par leur propre
dégradé (86 % → 99 %) : elles n'ont pas de bord franc, les couper net
trancherait dedans.

**Style de LED** :

| | `sharp` | `soft` |
|---|---|---|
| Forme | carré vif | angles adoucis, r = 24 % du côté |
| Halo | `shadowBlur = cellule × 0,55 × b` | aucun |
| Écart | `round(cellule × (1 − duty))` | identique |
| Rampe alpha | `0,25 + 0,75 b` | `0,08 + 0,92 b` |
| LED éteinte | `#1b1b20` | `#08080a` |
| Fond du disque | `#08080a` | `#131316` |

**L'écart ne dépend pas du style.** Il décrit l'appareil, pas la façon de le
regarder : le creuser en `soft` revenait à prétendre que ses LEDs s'écartent
quand on change de rendu. Ce qui distingue `soft`, ce sont les angles, le halo
et la rampe.

**L'écart n'est plus forcé pair.** Il l'était tant que la LED était centrée dans
sa cellule — la marge tombait alors à la demie pour un écart impair, et un bord
à la demie est un bord flou. La marge est donc prise au **plancher** et
l'asymétrie d'un demi-pixel décale la trame entière d'autant, ce qui ne se voit
pas. Sans ça, un (4a) Pro à 16 px de cellule ne pouvait pas avoir ses 3 px
d'écart : seulement 2 ou 4.

Écarts obtenus aux tailles de référence : **2 px** pour le (3) (cellule 7, LED
de 5), **3 px** pour le (4a) Pro (cellule 16, LED de 13).

`sharp` émule l'appareil. `soft` est fait pour un affichage tel quel sur un
écran : sans halo pour porter l'intensité, un plancher à 0,25 écraserait tout
le bas de la plage sur un même gris — d'où la rampe quasi linéaire. Le fond du
disque y est **plus clair** que les LEDs éteintes, l'inverse de `sharp`, sinon
la trame disparaît.

Une LED est considérée éteinte à `b ≤ 0,02`. La couleur allumée est
`rgb(242, 242, 239)`, le blanc légèrement chaud des LEDs Nothing. Elle est
commune aux deux appareils : le (4a) Pro annonce deux fois la luminance, mais
une luminance n'est pas une teinte et rien ne dit que le blanc ait bougé.

#### Grille en pixels entiers

Une cellule occupe un nombre **entier** de pixels de canvas, et la LED comme sa
marge tombent sur des entiers :

```
cerne(cellule) = (diamètre du hublot / cellule − size) / 2      en largeurs de LED
ecart          = max(1, round(cellule × (1 − duty) × facteur de style))
led            = max(2, cellule − ecart)
marge          = ⌊(cellule − led) / 2⌋
```

Un canvas de taille fixe redimensionné par le navigateur avec un ratio
fractionnaire produit une trame irrégulière : une colonne sur n gagne un pixel
de gap. La taille CSS du canvas est donc dérivée du backing (`size / dpr`),
ratio exactement 1, et **le canvas n'est jamais étiré**.

**Le choix de la cellule se fait sur le cerne, pas sur la taille.** La cellule
étant entière, le cerne ne prend que des valeurs discrètes ; on retient donc,
des deux entiers qui encadrent l'idéal, celui dont le cerne tombe le plus près
de la consigne du profil. Arrondir la cellule ne revient pas au même — la
relation entre les deux est en `1/cellule`, et l'écart part du mauvais côté une
fois sur deux.

Un plancher de **0,5 largeur de LED** borne le tout : quand la consigne tombe
entre deux valeurs possibles, mieux vaut un cerne trop épais qu'un cerne absent.
Il garantit du même coup que la grille rentre toujours dans le hublot, donc
qu'aucune LED ne s'y fait rogner.

**Ce que la quantification coûte.** Elle est d'autant plus rude que la cellule
est petite, et c'est ce qui a fixé la largeur de cadre à 728 px : à 576, le
hublot du (3) faisait 162 px pour 25 LEDs, la cellule ne pouvait valoir que 5 ou
6, et le cerne que 3,7 ou 1 LED. Aucune combinaison ne donnait à la fois la
consigne et une LED lisible.

**Aucune LED ne doit jamais être rognée.** En mode téléphone, le canvas est posé
seul sur la photo, sans conteneur circulaire : il n'y a donc rien qui puisse le
découper. C'est structurel et non un réglage. Un découpage en disque avait été
essayé et coupait les LEDs des rangées extrêmes — le masque teste le **centre**
des cellules, si bien qu'une LED retenue déborde du cercle nominal de presque
une demi-diagonale (sur une grille de 13, la plus lointaine est à 6,403 cellules
et non 6,5).

#### Calage sur le dos

Positions en **pourcentage du cadre**, jamais en pixels — c'est ce qui garde le
calage au redimensionnement. Les cotes sont dans le profil d'appareil (§ 2.1),
pas dans le CSS : le composant de préview ne connaît aucun chiffre.

Le relevé du (3) vient de `SPECS-PREVIEW.md` du repo GlyphLapse, asset
`phone3-back.webp` partagé. Celui du (4a) Pro est mesuré sur sa photo (§ 2.1).
Cadre en `aspect-ratio: 704/913` dans les deux cas, rendu au plus à 576 px de
large.

Le rappel « maintenir » se pose à gauche du Glyph Button, à une cote dérivée de
la sienne. Le seul appareil qui en porte un l'a à droite du dos.

### 5.6 Lectures

Sous la préview, en permanence : **LED allumées** `[nnn / ledCount]`, **moyenne**
en pourcentage, **échelle** en pixels par LED. Ce sont des mesures de la trame
courante, pas des estimations.

### 5.7 Mise en page et défilement

Invariant commun aux deux largeurs : **la matrice est visible en permanence**,
sans avoir à faire défiler quoi que ce soit. Régler un curseur sans voir son
effet n'aurait aucun intérêt. Ce qui cède quand la place manque, c'est le bas
de la préview — jamais son échelle, jamais sa présence à l'écran.

**Deux colonnes** (au-dessus de 980 px). La page occupe exactement la fenêtre
et **ne défile pas**. L'en-tête, la préview, les lectures et le pied restent en
place ; le rack de réglages est le seul élément qui défile. Si la préview ne
rentre pas dans la hauteur laissée par l'en-tête et le pied, son cadre la rogne
par le bas.

**Colonne unique** (980 px et moins). Défilement de page classique, un seul
ascenseur. L'en-tête défile — collant il volerait 135 px à la préview — et
c'est la **colonne de préview qui s'épingle en haut de l'écran**, réduite à la
bande qui porte le disque, le rack passant dessous.

Hauteur de la bande :

| Mode | Bande |
|---|---|
| Téléphone | `min(0,5 × largeur du téléphone, 0,4 × hauteur d'écran)` |
| Grand | taille du disque, elle-même réduite à `min(largeur, 0,4 × hauteur d'écran)` |

Le facteur 0,5 vient de la géométrie : le bas du disque tombe à 0,329 de la
largeur de l'appareil (centre à 15,36 % de la hauteur, rayon à 13,02 % de la
largeur, cadre en 704/913). Il reste donc de la marge sous le disque, et le
fondu ne mord pas sur les LEDs. Le plafond en hauteur d'écran évite qu'un
appareil large sur un écran court ne laisse rien au rack.

#### Défilement du rack

Le rack n'a de défilement propre qu'en deux colonnes ; en colonne unique il
suit le défilement de la page, sans fondu ni gouttière réservée.

Le rack porte un fondu haut et bas, en masque et non en aplat superposé, pour
que le fond de page reste visible dans la bande. Sa profondeur est
proportionnelle à la distance déjà parcourue, plafonnée à 32 px :

```
fondu haut = min(32, scrollTop)
fondu bas  = min(32, scrollHeight − clientHeight − scrollTop)
```

Il est donc nul quand la liste tient dans la hauteur, et apparaît
progressivement plutôt que d'un bloc. La gouttière d'ascenseur est réservée en
permanence : sans ça l'apparition du curseur de dither décalerait toute la
colonne.

#### Le piège des inputs de fichier cachés

Les deux `<input type="file">` sont masqués en absolu dans leur `<label>`, et
ces labels **doivent** être `position: relative`. Sans ça leur bloc conteneur
remonte jusqu'à `.page`, et leur position statique y est calculée sans tenir
compte du défilement interne du rack : à mi-course, l'input atterrit un millier
de pixels sous son libellé. Cliquer le label le focalise, le navigateur fait
défiler `.page` pour l'amener à l'écran — et `.page` est en `overflow: hidden`,
donc sans ascenseur pour revenir. Toute la mise en page part vers le haut et n'y
revient jamais.

C'est le prix de la règle « la page ne défile pas » : un conteneur qui n'a pas
d'ascenseur reste programmatiquement défilable, et le défilement de mise au
point du navigateur s'en sert. Tout élément focusable posé en absolu dans cette
page doit donc avoir son bloc conteneur explicitement déclaré.

---

## 6. Sorties

| Format | Contenu | Nom de fichier |
|---|---|---|
| PNG | disque d'environ 600 px de côté, fond compris, **dans le style de LED affiché** | `glyphcast-<appareil>-<style>-<horodatage>.png` |
| Kotlin | `val FRAME = intArrayOf(...)`, `size²` valeurs 0-255 sur `size` lignes de `size`, alignées | `glyphcast-<appareil>-<horodatage>.kt` |
| JSON | trame **et** réglages **et** appareil | `glyphcast-<appareil>-<horodatage>.json` |

**L'appareil est dans le nom de chaque fichier**, et en tête du Kotlin. Deux
IntArrays de longueurs différentes finissent sinon par se croiser dans un projet
Android, et le SDK ne dira rien avant l'exécution.

Le PNG est calé sur un **côté visé** (600 px) plutôt que sur un nombre de pixels
par LED : les deux appareils sortent des fichiers de même encombrement, et c'est
la finesse de la matrice qui fait la différence, pas la taille de l'image.
600 px donnent 24 px/LED sur un (3), 46 px/LED sur un (4a) Pro.

Le Kotlin est aussi copiable dans le presse-papiers (`navigator.clipboard`,
repli sur `textarea` + `execCommand`) et affiché en clair dans la carte
Export : ce qu'on lit est exactement ce qu'on exporte.

L'horodatage est un ISO 8601 tronqué à la seconde, `:` et `T` remplacés par
des tirets.

### Schéma JSON

```json
{
  "format": "glyphcast",
  "version": "1.1",
  "device": "phone4apro",
  "size": 13,
  "ledCount": 137,
  "params": { "zoom": 1, "wR": 0.2126, "...": "tous les réglages" },
  "values": [0, 0, 102, "... size² entiers 0-255"]
}
```

`device` vaut `"phone3"` ou `"phone4apro"`. `size` et `ledCount` restent
présents pour la lecture humaine ; ils sont **dérivés** de `device` et ne sont
pas relus.

### Import

`format` doit valoir `"glyphcast"`, sinon rejet. Sont relus les **réglages** et
l'**appareil** : `values` est ignoré et recalculé depuis l'image chargée. Un
`.json` rechargé sans image ne fait donc que restaurer les curseurs et la
matrice cible.

Relire une session sur l'autre grille redonnerait d'autres valeurs sous les
mêmes réglages — d'où le fait que l'appareil voyage avec elle. Un fichier de la
version 1.0, où le Phone (3) était seul, n'a pas de champ `device` : il retombe
sur le (3), ce qui est exactement ce qu'il décrivait.

Chaque valeur est bornée aux plages du § 5.3 et retombe sur le défaut si elle
est absente ou non finie ; `dither` doit être l'une des trois valeurs connues,
`device` l'un des identifiants connus. Un fichier édité à la main ne peut pas
mettre le pipeline dans un état impossible — `levels = 0` donnerait une division
par zéro, un `device` inventé une grille sans géométrie.

---

## 7. Invariants

Vrais après chaque conversion, quels que soient l'image et les réglages :

1. `values.length === device.cells`, indexé en row-major.
2. `values[i] === 0` pour toute cellule hors disque.
3. `0 ≤ values[i] ≤ plafond` pour toutes les cellules.
4. `lit` ≤ `device.ledCount` et compte exactement les cellules `> 0`.
5. Aucune requête réseau n'est émise après le chargement de la page. Le
   chargement lui-même appelle Google Fonts pour Geist Mono — voir § 1.
6. Deux `Params` égaux sur la même image et le même appareil produisent des
   `values` identiques — le dithering est déterministe, la trame de Bayer est
   fixe et le serpentin de Floyd-Steinberg parcourt toujours la grille dans le
   même ordre.
7. Changer d'appareil ne modifie **aucun** `Params`, et n'exige ni de recharger
   l'image ni de refaire un réglage. C'est le seul état qui bouge.

