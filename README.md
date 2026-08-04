# glyphcast

[Preview at https://glyph.suns.red](https://glyph.suns.red)

Convertit une image en rendu **Glyph Matrix** pour Nothing Phone — **(3)** et
**(4a) Pro** — avec préview posée sur le dos de l'appareil et un rack de
réglages pour fine-tuner le passage image → LEDs. On bascule d'une matrice à
l'autre d'un clic, sans rien reperdre.

Tout se passe dans le navigateur : l'image n'est jamais envoyée nulle part, et
l'appli n'émet aucune requête réseau une fois chargée. Seul le chargement va
chercher Geist Mono chez Google Fonts.

```
bun install
bun run dev      # http://localhost:5173
bun run build    # dist/
bun run check    # svelte-check + tsc
```

Le détail fonctionnel — formules, bornes, invariants, schéma JSON — est dans
[SPECS.md](SPECS.md). Ce README en donne le résumé.

## Fonctions

- **Choisir l'appareil** : `(3)` ou `(4a) Pro`. La bascule ne touche à rien
  d'autre — même image, mêmes réglages, seule la grille change dessous. C'est ce
  qui permet de régler une fois et de lire en un clic ce que chacune des deux
  matrices garde de l'image.
- **Importer une image** par glisser-déposer n'importe où sur la page, par
  collage (`Ctrl+V`) ou par sélecteur de fichier. Tant qu'il n'y a pas d'image,
  la carte `[01] Source` est la seule chose cliquable : elle est encadrée
  d'accent, tous les réglages sont éteints.
- **Cadrer** : zoom, décalage X/Y, rotation au degré, rotations rapides ± 90°.
- **Doser les canaux** R/G/B — la matrice étant monochrome, ces poids agissent
  comme un filtre coloré de photo noir et blanc. Six presets, dont un filtre
  rouge à poids bleu négatif.
- **Régler la tonalité** : exposition en IL, gates point noir / point blanc,
  contraste, gamma, netteté, inversion, plus un **auto-gates** qui étale
  l'histogramme sur les extrêmes réellement présents dans l'image.
- **Choisir la sortie LED** : de 2 à 64 paliers de luminosité, plafond de
  luminosité, dithering Floyd-Steinberg ou Bayer 4 × 4 avec dosage.
- **Comparer avant / après** en maintenant le Glyph Button — ou le bouton en
  barre sous la préview quand l'appareil n'en a pas, comme le (4a) Pro : même
  cadrage, tonalité au repos.
- **Prévisualiser** à deux échelles (sur le dos du téléphone, ou disque plein
  cadre) et dans deux styles de LED (`sharp` / `soft`).
- **Exporter** en PNG, en `IntArray` Kotlin prêt à coller dans un Glyph Toy,
  ou en JSON rechargeable.

La matrice reste visible en permanence, quelle que soit la largeur d'écran :
régler un curseur sans voir son effet n'aurait pas d'intérêt. Sur deux colonnes
la page ne défile pas du tout — en-tête, préview et pied restent en place, seul
le rack de réglages défile. Sur une colonne c'est la préview qui s'épingle en
haut de l'écran, réduite à la bande qui porte le disque, et le rack passe
dessous.

Ce qu'il ne fait pas : pas d'animation ni de séquence, pas d'envoi direct à
l'appareil (aucune API navigateur ne le permet — la passerelle est l'export
Kotlin), pas de retouche locale.

## Les matrices

Même construction dans les deux cas : une grille carrée en row-major, masquée
par un disque centré de rayon `size / 2`. Les deux comptes publiés de LEDs
tombent juste avec cette seule formule — c'est ce qui permet de n'avoir qu'un
seul pipeline.

| | Phone (3) | Phone (4a) Pro |
|---|---:|---:|
| Grille | 25 × 25 = 625 cellules | 13 × 13 = 169 cellules |
| Masque | disque (12, 12), r = 12,5 | disque (6, 6), r = 6,5 |
| LEDs pilotables | **489** | **137** |
| Cerne au bord du hublot | 1,5 LED | 1,5 LED |
| Part de LED dans le pas | 0,72 | 0,81 |
| Diamètre du disque | 26,49 % de la largeur du corps | 35,62 % — 34 % de plus |
| Glyph Button | oui | **non** |
| Couleur | aucune — luminosité seule, 0-255 par LED | idem |

Rien n'est écrit en dur : `buildGeometry(size)` recalcule tout, et un appareil
n'est qu'une entrée de `src/lib/devices.ts` plus une photo dans `public/`.

Géométrie et calage de la photo du (3) repris de
[`glyphlapse`](https://github.com/aero-md/glyphlapse) — `SPECS.md` et
`SPECS-PREVIEW.md`. Les cotes du (4a) Pro sont relevées sur sa photo, pas
déduites d'un communiqué : disque de 300 px centré en (1184,5 ; 390) dans une
source de 2048², corps large de 842 px. La presse de lancement annonçait un
cercle « 57 % plus grand » ; la photo donne +34 %, et c'est elle qui pilote le
rendu.

Toutes les positions sont en pourcentage du cadre, jamais en pixels : c'est ce
qui garde le calage quand la préview est redimensionnée.

### Le même gabarit pour les deux dos

Les deux photos sont recadrées au **même format et à la même échelle de corps** —
704 × 913, corps à 98,3 % de la largeur du cadre. Ça garde les cotes
comparables d'un profil à l'autre et le recadrage déductible. En revanche les
deux dos ne sont pas **affichés** à la même taille : chacun a sa largeur de
rendu, choisie pour sa propre taille de LED.

Le recadrage du (4a) Pro se déduit donc de la photo du (3), et retombe sur le
même 704 × 913 au millième d'aspect près.

## Chaîne de conversion

`src/lib/pipeline.ts` — une passe, pas d'état caché.

```
cadrage (zoom / décalage / rotation, cover sur fond noir)
  → supersample ~200 × 200           8 × 8 par LED sur un (3), 15 × 15 sur un (4a) Pro
  → linéarisation sRGB
  → luma = wR·R + wG·G + wB·B        poids normalisés
  → moyenne de zone → size × size
  → ré-encodage sRGB                 la valeur redevient perceptuelle
  → netteté (unsharp 3 × 3)
  → exposition → gates noir/blanc → contraste → gamma → inversion
  → quantification N paliers (+ Floyd-Steinberg ou Bayer 4 × 4)
  → plafond de luminosité → masque disque
```

Le facteur de supersampling **suit** la grille au lieu d'être figé : à facteur
constant, la matrice la plus grossière n'échantillonnerait qu'un quart de la
surface d'image, et l'aliasing reviendrait sur l'appareil qui en a le plus
besoin. Aucun réglage, en revanche, n'est exprimé en LEDs — ce sont des
grandeurs photographiques, et c'est pour ça que la bascule ne perd rien.

Deux choix qui ne sont pas cosmétiques :

- **Le downsample se fait en lumière linéaire.** Moyenner des valeurs sRGB
  assombrit les zones contrastées — le damier noir/blanc qui devrait donner
  ~73 % rend un gris à 50 %.
- **On ré-encode en sRGB après la moyenne.** La consigne envoyée à une LED est
  une valeur PWM, mais l'œil la lit en gamma. Sans ce retour, tout le rendu
  sort trop sombre.

### Les curseurs R / G / B

La matrice est monochrome : ces trois réglages ne colorent rien. Ils décident
de la **part de chaque canal dans la luminance** — un filtre coloré de photo
noir et blanc. Monter le rouge éclaircit les peaux et noircit un ciel bleu ;
le preset `CIEL NOIR` pousse le poids bleu en négatif pour détacher les nuages.

### Dithering

À 2 paliers le rendu est binaire et le dither fait tout le travail. Au-delà de
~16 paliers la matrice restitue de vrais niveaux de gris et le dither ne sert
plus qu'à casser les bandes dans les dégradés.

L'erreur de Floyd-Steinberg n'est **propagée qu'aux cellules du disque** : la
pousser hors du masque la ferait disparaître et assombrirait tout le bord.

## Sorties

| Format | Contenu |
|---|---|
| PNG | disque rendu sur ~600 px de côté — 24 px par LED sur un (3), 46 px sur un (4a) Pro |
| IntArray Kotlin | `intArrayOf(...)` de `size²` valeurs 0-255, row-major — à passer tel quel au `GlyphMatrixFrame` |
| JSON | les valeurs, tous les réglages **et** l'appareil, rechargeable |

**L'appareil est dans le nom de chaque fichier** (`glyphcast-phone4apro-…`) et
en tête du Kotlin. Deux IntArrays de longueurs différentes finissent sinon par
se croiser dans un projet Android, et le SDK ne dira rien avant l'exécution.

Une session relue restaure aussi sa matrice cible : les mêmes réglages sur
l'autre grille ne donneraient pas les mêmes valeurs. Un `.json` de la version
1.0, où le (3) était seul, n'a pas de champ `device` et retombe sur le (3) —
c'est exactement ce qu'il décrivait.

## Préview

Deux échelles, au choix :

- **Téléphone** — la matrice calée sur le hublot de la photo du dos, cerne
  compris. Maintenir le Glyph Button compare avec le même cadrage et la tonalité
  au repos.
- **Grand** — le hublot seul, **entier**, réduit s'il le faut pour tenir en
  hauteur. Une matrice amputée ne dit plus ce qu'elle contient.

**Chaque appareil a sa propre largeur de rendu** : 792 px pour le (3), 739 pour
le (4a) Pro. Ce n'est pas un encombrement, c'est une taille de LED — à ces
largeurs les hublots font 224 et 256 px, soit exactement 28 cellules de 8 px et
16 cellules de 16 px. Une largeur commune ne peut pas convenir aux deux : la
cellule est entière, et régler le cerne de l'un déplaçait celle de l'autre.

Le prix est assumé : les deux dos ne sont plus affichés à la même taille, on ne
peut donc plus comparer les deux matrices à l'échelle. C'est la lisibilité de
chacune qui a été retenue.

Le dos n'est jamais réduit pour tenir dans la fenêtre. Quand la place manque il
est rogné par le bas : le hublot est en haut de l'appareil, ce qu'on perd c'est
le bas du dos. La hauteur gardée se déduit du bas du hublot, elle n'est pas posée
en dur — une constante partagée aurait décapité la matrice du (4a) Pro, plus
large et plus basse.

Dans les deux cas une cellule occupe un nombre **entier** de pixels de canvas :
un canvas redimensionné par le navigateur avec un ratio fractionnaire donne
une trame irrégulière, une colonne sur n gagne un pixel de gap. La grille est
donc calculée depuis le `devicePixelRatio`, et le canvas n'est jamais étiré.

### Le piège du demi-pixel

Un canvas posé à un demi-pixel est rééchantillonné par le navigateur : tout le
rendu devient flou d'un coup, alors que son contenu est parfaitement net. C'est
le piège le plus coûteux du composant, parce que ses symptômes n'ont aucun
rapport avec sa cause — la netteté dépendait de la **parité** de la taille du
canvas et du centrage du dos, donc elle apparaissait et disparaissait au gré des
largeurs. Changer la marge d'un appareil pouvait rendre l'autre flou.

La position du canvas est donc calculée en pixels entiers **de l'écran** : on
mesure l'origine de la boîte porteuse, on arrondit la position absolue, on
repasse en coordonnées locales.

### Le cerne

Aucune des deux matrices ne va jusqu'au bord de son hublot : il reste une bande
sombre entre la découpe et la première LED, relevée sur les photos à 1,5 largeur
de LED sur les deux. C'est l'unité qui compte — en pixels
d'écran, le cerne mentirait dès que la préview change de taille.

La cellule étant entière, le cerne ne prend que des valeurs discrètes : on
retient celle dont le cerne tombe le plus près de la consigne, avec un plancher
d'une demi-LED.

### L'écart entre LEDs

Il vient du profil et pas d'une constante partagée : les LEDs d'un (4a) Pro sont
bien plus jointives que celles d'un (3), et les traiter pareil les rendait deux
fois trop petites — un rendu qui *paraissait* flou alors qu'il était net au
pixel. Aux tailles de référence : **2 px** d'écart pour le (3) (cellule 8, LED
de 6), **3 px** pour le (4a) Pro (cellule 16, LED de 13).

L'écart ne dépend pas du style de rendu. Il décrit l'appareil, pas la façon de
le regarder ; `sharp` et `soft` se distinguent par les angles, le halo et la
rampe, pas par la géométrie.

Il n'est pas non plus forcé pair. Centrer la LED dans sa cellule imposait une
marge à la demie dès que l'écart était impair, donc un bord flou — la marge est
prise au plancher, et l'asymétrie d'un demi-pixel décale la trame entière
d'autant, ce qui ne se voit pas.

### Le hublot des photos

Les deux photos ont leur **hublot noirci** : c'est une exigence sur l'asset. Il
n'y a alors rien à masquer, aucun aplat à poser, et c'est le fond de la photo —
biseau du verre et reflets compris — qui sert de fond. Le canvas est le seul
élément dessiné, posé sans conteneur : rien ne peut donc rogner une LED, et
c'est structurel. Un découpage en disque avait été essayé, il coupait les
rangées extrêmes — le masque teste le centre des cellules, donc une LED retenue
déborde du rayon nominal de presque une demi-diagonale.

### Rendu des LED : sharp / soft

| | `sharp` | `soft` |
|---|---|---|
| Forme | carré vif | angles adoucis, r ≈ 24 % |
| Halo | proportionnel à la luminosité | aucun |
| Gap | 1/6 de cellule | 0,14 de cellule |
| Rampe | plancher à 0,25 | quasi linéaire (0,08) |
| Fond du disque | `#08080a` | `#131316`, plus clair que les LEDs éteintes |

`sharp` émule l'appareil, c'est ce qu'on voit sur le dos d'un Nothing Phone.
`soft` est fait pour un affichage tel quel sur un écran normal : sans halo
pour porter l'intensité, un plancher haut écraserait tout le bas de la plage
sur un même gris — d'où la rampe quasi linéaire.

**L'export PNG suit le style affiché**, et le nomme dans le fichier
(`glyphcast-phone3-soft-…​.png`).

## Direction artistique

Langage Nothing : angles vifs partout, le cercle est réservé aux points et aux
LEDs, filets de 1 px, un seul accent rouge en ponctuation, grille de points en
fond, repères d'imprimerie aux quatre angles, sections numérotées entre
crochets. Geist Mono partout — le wordmark est la seule exception, et il
n'appelle aucune fonte.

L'accent rouge sert une seconde fois : **la carte `[01] Source` est encadrée**
tant qu'aucune image n'est chargée, et redevient un filet neutre dès qu'il y en
a une. Un jaune Nothing avait été essayé là — il tombait à trois centimètres de
la référence `[01]`, elle-même rouge, deux couleurs pour dire la même chose. Une
DA à un seul accent n'en a pas besoin d'un second.

Le cadre fait 2 px, obtenus par un filet de bordure plus une ombre interne :
passer la bordure à 2 px décalerait la carte d'un pixel au chargement de
l'image, et toute la colonne avec.

Ce cadre ne porte pas le message tout seul — c'est le verrouillage du reste du
rack qui le porte. Il le confirme.

Chaque capitale du wordmark est une **trame 7 × 7 dessinée à la main** — et une
trame *valide* : aucun point ne tombe hors du disque. Le masque n'est pas
« la même convention que » celui des appareils, c'est le même `buildGeometry`,
appelé avec 7 au lieu de 25 ou 13. Une lettre est donc théoriquement affichable
telle quelle sur une Glyph Matrix 7 × 7, comme les grilles de l'appli le sont
sur un Nothing Phone. C'est ce qui donne
au wordmark le droit d'être là : ce n'est pas une évocation de matrice, c'en est
une. L'invariant ne se voit pas à l'œil — un point hors disque rend exactement
comme un point dedans — donc il est vérifié au chargement en dev.

Ce que le disque ouvre, rangée par rangée :

| Rangées | Colonnes |
|---|---|
| 0 et 6 | 2-4 (3) |
| 1 et 5 | 1-5 (5) |
| 2 à 4 | 0-6 (7) |

Soit 37 cellules sur 49. Les rangées 0 et 6 ne donnent que 3 colonnes : rien à y
mettre. Les lettres tiennent donc dans le **carré 5 × 5** des rangées 1-5 ×
colonnes 1-5, le plus grand rectangle inscrit.

**Et c'est là que le serif s'arrête.** Un empattement, c'est un point qui
dépasse du fût sur la rangée extrême. Or les rangées 1 et 5 n'ouvrent que les
colonnes 1 à 5 — exactement l'écartement des deux fûts d'un H. Il ne reste
aucune colonne où dépasser. Ce n'est pas un choix de dessin, c'est le disque qui
refuse : à 7 × 7 la trame est linéale, point.

Les lettres restent dessinées et non tramées depuis une fonte : à cette taille
un empattement — ou n'importe quel détail — n'encre qu'une fraction de sa
cellule, il passe ou saute selon le sous-pixel où il est tombé, et deux lettres
voisines ne reçoivent pas le même traitement.

L'approche est **optique, relevée rangée par rangée**. Une chasse fixe cale les
boîtes d'encre et ignore ce qu'il y a dedans : le L n'occupe sa dernière colonne
qu'à la rangée du bas, le Y n'occupe la sienne qu'à celle du haut, et un « LY »
calé sur les boîtes creuse un trou en diagonale. On cherche donc, sur chaque
rangée où les deux lettres ont de l'encre, à quelle distance elles se frôlent,
et on cale l'avance sur la rangée la plus serrée — une colonne de jeu. Le Y se
glisse alors sous le bras du L, et les huit autres paires de `GLYPHCAST` ne
bougent pas d'un pixel.

Une seule exception, `LY`, à qui on rend une colonne. Le calcul suppose que la
rangée de contact est représentative de la paire ; quand ce contact tient à
*une* rangée — ici le pied du L contre le fût du Y — il ne l'est pas, l'œil ne
lit pas la colonne de contact mais le vide au-dessus.

Le canvas est ensuite cadré sur les points allumés, sinon les rangées laissées
vides par le disque deviendraient une marge morte et le wordmark ne s'alignerait
plus sur le texte posé dessous.

Les points sont **ronds**, là où la LED `soft` de la préview est un carré aux
angles adoucis : dans cette DA le cercle est réservé aux points et aux LEDs, et
à 4 px un carré arrondi se lit comme un carré — la trame durcit et le titre
attrape le même poids que les blocs de réglages posés dessous, alors qu'il doit
rester la seule chose douce de la page.

Reste le pas de trame, qui a un plancher : sous ~2 px de diamètre les points se
rejoignent, on ne voit plus que des traits et l'idée de matrice tombe. D'où une
cellule à 5,7 px — c'est la ligne éditoriale retirée de l'en-tête qui paie la
hauteur.

Thème clair par défaut, bascule en pied de page. Le thème est posé par un
script inline dans `<head>` : un `onMount` s'exécute après le premier paint et
un visiteur en sombre prendrait un flash clair à chaque chargement.

Le Glyph Button et son rappel sont les seuls éléments dont les couleurs sont
en dur : ils sont posés sur le corps noir de l'appareil, pas sur la page, et
ne peuvent donc pas suivre le thème.

## Structure

```
src/lib/matrix.ts       buildGeometry : grille carrée et masque circulaire
src/lib/devices.ts      catalogue des appareils — géométrie + calage du dos
src/lib/pipeline.ts     conversion image → size² valeurs
src/lib/render.ts       peinture des LEDs sur canvas (écran et export)
src/lib/export.ts       PNG / Kotlin / JSON, import de session
src/lib/ui/             Preview, Slider, Seg, Card, Wordmark, ThemeToggle
src/App.svelte          rack de réglages et mise en page
public/phone3-back.webp photo du dos, partagée avec glyphlapse / glyphslot
```


