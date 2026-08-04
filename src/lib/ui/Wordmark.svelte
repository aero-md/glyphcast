<script lang="ts">
  /* Wordmark : chaque capitale est une trame 7 × 7 dessinée à la main, et
     surtout une trame VALIDE — aucun point ne tombe hors du disque. Une lettre
     est donc théoriquement affichable telle quelle sur une Glyph Matrix 7 × 7,
     comme les grilles de l'appli le sont sur un Nothing Phone. C'est ce qui
     donne au wordmark le droit d'être là : ce n'est pas une évocation de
     matrice, c'en est une. */

  import { buildGeometry } from "../matrix";

  /** Côté de la matrice d'une capitale, et son masque — celui de `matrix.ts`,
      littéralement : même fonction que pour les appareils, à une autre taille.
      Centre au milieu, `d < r`, les coins n'existent pas. 37 cellules sur 49. */
  const M = 7;
  const MASK = buildGeometry(M);

  /* Ce que le disque ouvre réellement, rangée par rangée :

       0 et 6      colonnes 2-4      (3)
       1 et 5      colonnes 1-5      (5)
       2, 3, 4     colonnes 0-6      (7)

     Les rangées 0 et 6 ne donnent que 3 colonnes : rien à y mettre. Les lettres
     tiennent donc dans le carré 5 × 5 des rangées 1-5 × colonnes 1-5, le plus
     grand rectangle inscrit.

     Et c'est ici que le serif s'arrête. Un empattement, c'est un point qui
     dépasse du fût sur la rangée extrême. Or les rangées 1 et 5 n'ouvrent que
     les colonnes 1 à 5 — exactement l'écartement des deux fûts. Il ne reste
     aucune colonne où dépasser. Ce n'est pas un choix de dessin, c'est le
     disque qui refuse : à 7 × 7 la trame est linéale, point. */
  const GLYPHS: Record<string, string[]> = {
    " ": [".......", ".......", ".......", ".......", ".......", ".......", "......."],
    G: [".......", "..###..", ".#...#.", ".#.....", ".#..##.", "..###..", "......."],
    L: [".......", ".#.....", ".#.....", ".#.....", ".#.....", ".####..", "......."],
    Y: [".......", ".#...#.", "..#.#..", "...#...", "...#...", "...#...", "......."],
    P: [".......", ".####..", ".#...#.", ".####..", ".#.....", ".#.....", "......."],
    H: [".......", ".#...#.", ".#...#.", ".#####.", ".#...#.", ".#...#.", "......."],
    C: [".......", "..###..", ".#...#.", ".#.....", ".#...#.", "..###..", "......."],
    A: [".......", "..###..", ".#...#.", ".#####.", ".#...#.", ".#...#.", "......."],
    S: [".......", "..####.", ".#.....", "..###..", ".....#.", ".####..", "......."],
    T: [".......", ".#####.", "...#...", "...#...", "...#...", "...#...", "......."],
  };

  /* L'invariant « ça tient sur une matrice » ne se voit pas à l'œil : un point
     hors disque rend exactement comme un point dedans. On le vérifie donc au
     chargement en dev, sinon la première lettre retouchée le casse en silence. */
  if (import.meta.env.DEV) {
    for (const [ch, g] of Object.entries(GLYPHS)) {
      if (g.length !== M) console.error(`Wordmark « ${ch} » : ${g.length} rangées au lieu de ${M}`);
      g.forEach((row, y) => {
        if (row.length !== M)
          console.error(`Wordmark « ${ch} » rangée ${y} : ${row.length} colonnes au lieu de ${M}`);
        for (let x = 0; x < row.length; x++)
          if (row[x] === "#" && !MASK.isInside[y * M + x])
            console.error(`Wordmark « ${ch} » : la cellule (${x}, ${y}) est hors du disque`);
      });
    }
  }

  /* Approche optique, relevée rangée par rangée, et non une chasse fixe. Une
     chasse fixe cale les boîtes d'encre et ignore ce qu'il y a dedans : le L
     n'occupe sa dernière colonne qu'à la rangée du bas et le Y n'occupe la
     sienne qu'à celle du haut, si bien qu'un « LY » calé sur les boîtes creuse
     un trou en diagonale entre les deux.

     On cherche donc, sur chaque rangée où les deux lettres ont de l'encre, à
     quelle distance elles se frôlent, et on cale l'avance sur la rangée la plus
     serrée. Le Y se glisse alors de deux colonnes sous le bras du L, et les
     huit autres paires ne bougent pas d'un pixel — preuve que le problème était
     bien local et pas un réglage général de chasse. */
  const GAP = 1; // colonnes vides sur la rangée la plus serrée d'une paire
  const SPACE = 3; // chasse d'un blanc, qui n'a pas d'encre à mesurer

  /* Rattrapage, en colonnes. Le calcul ci-dessus cale l'avance sur la rangée où
     les deux lettres se frôlent le plus — ce qui suppose que ce contact est
     représentatif. Quand il tient à UNE seule rangée, il ne l'est pas : l'œil
     ne lit pas la colonne de contact, il lit le vide au-dessus. C'est le cas de
     « LY », dont le seul point de contact est le pied du L contre le fût du Y ;
     une colonne de jeu y colle les deux lettres. */
  const KERN: Record<string, number> = { LY: 1 };

  /** `left` / `right` valent -1 sur une rangée sans encre. Coordonnées ramenées
      à la première colonne encrée de la lettre, comme `cells`. */
  type Glyph = { ch: string; cells: number[][]; w: number; left: number[]; right: number[] };
  const INK: Record<string, Glyph> = {};
  for (const [ch, g] of Object.entries(GLYPHS)) {
    const cells: number[][] = [];
    const left = new Array<number>(M).fill(-1);
    const right = new Array<number>(M).fill(-1);
    let min = Infinity;
    let max = -Infinity;
    g.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "#") continue;
        cells.push([x, y]);
        if (left[y] < 0) left[y] = x;
        right[y] = x;
        if (x < min) min = x;
        if (x > max) max = x;
      }
    });
    INK[ch] = cells.length
      ? {
          ch,
          cells: cells.map(([x, y]) => [x - min, y]),
          w: max - min + 1,
          left: left.map((v) => (v < 0 ? -1 : v - min)),
          right: right.map((v) => (v < 0 ? -1 : v - min)),
        }
      : { ch, cells: [], w: SPACE, left, right };
  }

  /** De combien de colonnes avancer entre le début de `a` et celui de `b`. */
  function advance(a: Glyph, b: Glyph): number {
    const kern = KERN[a.ch + b.ch] ?? 0;
    let tight = -Infinity;
    for (let y = 0; y < M; y++)
      if (a.right[y] >= 0 && b.left[y] >= 0) tight = Math.max(tight, a.right[y] - b.left[y]);
    // deux lettres sans rangée commune n'ont rien à optimiser : chasse de boîte
    if (tight === -Infinity) return a.w + GAP + kern;
    return Math.max(1, tight + 1 + GAP + kern);
  }

  /** `cell` est le côté d'une cellule de trame, en px CSS — le point en fait
      `1 / STEP`. C'est le bon bouton, et il a un plancher : sous ~2 px de
      diamètre les points se rejoignent, on ne voit plus que des traits et
      l'idée de matrice tombe, ce qui est tout le propos. */
  type Props = { text?: string; cell?: number };
  let { text = "GLYPHCAST", cell = 5.7 }: Props = $props();

  /* Le point est rond, là où la LED `soft` de la préview est un carré aux
     angles adoucis. C'est voulu : dans cette DA le cercle est réservé aux
     points et aux LEDs, et à 4 px un carré arrondi se lit comme un carré — la
     trame durcit et le titre attrape le même poids que les blocs de réglages
     posés dessous, alors qu'il doit rester la seule chose douce de la page. */
  const STEP = 1.28; // pas de la trame, en multiples du diamètre du point

  let cvs = $state<HTMLCanvasElement>();

  function draw() {
    if (!cvs) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const word = [...text.toUpperCase()].map((ch) => INK[ch]).filter(Boolean);
    if (!word.length) return;

    /* Les rangées que le disque laisse vides seraient une marge morte : on
       cadre sur les points allumés, sinon le wordmark ne s'alignerait plus sur
       le texte posé dessous. En x le cadrage est acquis, la plume part de 0. */
    const pts: number[][] = [];
    let pen = 0;
    let prev: Glyph | null = null;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const g of word) {
      if (prev) pen += advance(prev, g);
      for (const [x, y] of g.cells) {
        pts.push([pen + x, y]);
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      prev = g;
    }
    if (!pts.length) return;

    const w = (pen + prev!.w) * cell;
    const h = (y1 - y0 + 1) * cell;
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    cvs.style.width = w + "px";
    cvs.style.height = h + "px";

    const dot = cell / STEP;
    const ctx = cvs.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(cvs).color;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, (y - y0) * cell + cell / 2, dot / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  $effect(() => {
    text;
    cell;
    draw();
    // la couleur du wordmark suit le thème : redessiner au changement d'attribut
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    // un changement d'écran change le devicePixelRatio, donc la résolution du canvas
    window.addEventListener("resize", draw);
    return () => {
      mo.disconnect();
      window.removeEventListener("resize", draw);
    };
  });
</script>

<canvas bind:this={cvs} aria-label={text}>{text}</canvas>

<style>
  canvas {
    display: block;
    /* seule source de la couleur des points, lue par le script */
    color: var(--ink);
  }
</style>
