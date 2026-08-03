# glyphcast

[Preview at https://glyph.suns.red](https://glyph.suns.red)

Convertit une image en rendu **Glyph Matrix** pour Nothing Phone (3), avec
préview posée sur le dos de l'appareil et un rack de réglages pour fine-tuner
le passage image → LEDs.

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
- **Comparer avant / après** en maintenant le Glyph Button : même cadrage,
  tonalité au repos.
- **Prévisualiser** à deux échelles (sur le dos du téléphone à taille réelle,
  ou disque plein cadre) et dans deux styles de LED (`sharp` / `soft`).
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

## La matrice

| Constante | Valeur |
|---|---:|
| Grille | 25 × 25 = 625 cellules, row-major |
| Masque | disque centré sur (12, 12), rayon 12,5 |
| LEDs pilotables | **489** |
| Couleur | aucune — luminosité seule, 0-255 par LED |

Géométrie et calage de la photo repris de
[`glyphlapse`](https://github.com/aero-md/glyphlapse) — `SPECS.md` et
`SPECS-PREVIEW.md`. Le disque est à 79,53 % / 15,36 % du cadre
photo, diamètre 26,04 % ; le Glyph Button à 84,53 % / 74,82 %. Toutes les
positions sont en pourcentage, jamais en pixels : c'est ce qui garde le calage
quand la préview est redimensionnée.

## Chaîne de conversion

`src/lib/pipeline.ts` — une passe, pas d'état caché.

```
cadrage (zoom / décalage / rotation, cover sur fond noir)
  → supersample 200 × 200            8 × 8 échantillons par LED
  → linéarisation sRGB
  → luma = wR·R + wG·G + wB·B        poids normalisés
  → moyenne de zone → 25 × 25
  → ré-encodage sRGB                 la valeur redevient perceptuelle
  → netteté (unsharp 3 × 3)
  → exposition → gates noir/blanc → contraste → gamma → inversion
  → quantification N paliers (+ Floyd-Steinberg ou Bayer 4 × 4)
  → plafond de luminosité → masque disque
```

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
| PNG | disque rendu à 24 px par LED (600 × 600) |
| IntArray Kotlin | `intArrayOf(...)` de 625 valeurs 0-255, row-major — à passer tel quel au `GlyphMatrixFrame` |
| JSON | les 625 valeurs **et** tous les réglages, rechargeable |

## Préview

Deux échelles, au choix :

- **Téléphone** — la matrice à sa taille réelle sur la photo du dos : 150 px de
  diamètre pour un appareil rendu à 576 px de large, soit 6 px par LED.
  Maintenir le Glyph Button compare avec le même cadrage et la tonalité au
  repos.
- **Grand** — le disque seul sur toute la largeur de la colonne, pour lire LED
  par LED ce que fait un curseur.

Le téléphone n'est jamais réduit pour tenir dans la fenêtre — ce serait perdre
l'échelle réelle, qui est tout l'intérêt du mode. Quand la place manque il est
rogné par le bas : le disque est en haut de l'appareil, ce qu'on perd c'est le
dos et le Glyph Button.

Dans les deux cas une cellule occupe un nombre **entier** de pixels de canvas :
un canvas redimensionné par le navigateur avec un ratio fractionnaire donne
une trame irrégulière, une colonne sur n gagne un pixel de gap. La grille est
donc calculée depuis le `devicePixelRatio`.

### Rendu des LED : sharp / soft

| | `sharp` | `soft` |
|---|---|---|
| Forme | carré vif | angles adoucis, r ≈ 24 % |
| Halo | proportionnel à la luminosité | aucun |
| Gap | 1/6 de cellule | 0,14 de cellule |
| Rampe | plancher à 0,25 | quasi linéaire (0,08) |
| Fond du disque | `#08080a` | `#131316`, plus clair que les LEDs éteintes |

`sharp` émule l'appareil, c'est ce qu'on voit sur le dos d'un Phone (3).
`soft` est fait pour un affichage tel quel sur un écran normal : sans halo
pour porter l'intensité, un plancher haut écraserait tout le bas de la plage
sur un même gris — d'où la rampe quasi linéaire.

**L'export PNG suit le style affiché**, et le nomme dans le fichier
(`glyphcast-soft-…​.png`).

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
trame *valide* : aucun point ne tombe hors du disque, avec la même convention
que `matrix.ts` (centre au milieu, `d < r`, les coins n'existent pas). Une
lettre est donc théoriquement affichable telle quelle sur une Glyph Matrix
7 × 7, comme les 25 × 25 de l'appli le sont sur un Phone (3). C'est ce qui donne
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
src/lib/matrix.ts       géométrie 25 × 25 et masque circulaire
src/lib/pipeline.ts     conversion image → 625 valeurs
src/lib/render.ts       peinture des LEDs sur canvas (écran et export)
src/lib/export.ts       PNG / Kotlin / JSON, import de session
src/lib/ui/             Preview, Slider, Seg, Card, Wordmark, ThemeToggle
src/App.svelte          rack de réglages et mise en page
public/phone3-back.webp photo du dos, partagée avec glyphlapse / glyphslot
```
