<script module lang="ts">
  export type PreviewMode = "phone" | "large";
</script>

<script lang="ts">
  /* Deux échelles pour la même matrice.
     - « téléphone » : la matrice calée sur le hublot de la photo du dos. Le dos
       est rendu à la largeur que porte le profil — elle est choisie par appareil
       pour que sa cellule tombe sur un entier confortable, et n'a donc rien à
       voir d'un appareil à l'autre.
     - « grand » : le disque seul, réduit s'il le faut pour tenir en entier.

     La géométrie n'est jamais passée en propriété : elle est lue dans
     `frame.device`. Une trame et son cadre ne peuvent donc pas se désaccorder
     pendant une bascule d'appareil. */
  import { onMount } from "svelte";
  import { DEVICES, previewBand, type Disc } from "../devices";
  import type { Frame } from "../pipeline";
  import { DISC_BG, paint, screenGrid, type Grid, type LedStyle } from "../render";

  /* Colonne unique : la préview est épinglée en haut de l'écran et le rack
     défile dessous, pour qu'on voie l'effet d'un curseur pendant qu'on le
     manipule. On n'en garde donc qu'une bande, dont la hauteur se déduit du bas
     du disque (voir `previewBand`).
     - SHARE plafonne la bande en hauteur d'écran, sinon un appareil large sur
       un écran court ne laisserait rien au rack.
     - NARROW double le point de rupture du CSS. */
  const SHARE = 0.4;
  /* Point de rupture des deux colonnes. Il n'est pas rond : c'est la largeur en
     dessous de laquelle le plus large des deux dos (792 px), 25,6 px de
     gouttière et les 300 px minimum du rack ne tiennent plus dans la page,
     marges comprises. Le laisser sous cette valeur fait déborder la grille au
     lieu de passer en colonne. */
  const NARROW = 1200;

  type Props = {
    frame: Frame;
    mode?: PreviewMode;
    style?: LedStyle;
    /** Rendu de comparaison affiché tant que le bouton est maintenu. */
    compare?: Frame | null;
    /** Largeur disponible en px CSS, pour caler la grille du mode « grand ». */
    width?: number;
  };

  let { frame, mode = "phone", style = "sharp", compare = null, width = 576 }: Props = $props();

  let cvs = $state<HTMLCanvasElement>();
  let phoneEl = $state<HTMLElement>();
  let held = $state(false);
  let dpr = $state(1);
  let vw = $state(1440);
  let vh = $state(900);
  /* Hauteur réellement obtenue par le cadre de rognage : elle sert de plafond au
     mode grand et de détecteur de rognage au mode téléphone. */
  let stageH = $state(0);
  /* Position du cadre à l'écran, pour recaler le canvas sur la grille de pixels
     (voir `snap`). Mesurée, jamais déduite : le centrage en flex peut poser le
     téléphone sur un demi-pixel. */
  let phoneX = $state(0);
  let phoneY = $state(0);

  onMount(() => {
    const sync = () => {
      dpr = window.devicePixelRatio || 1;
      vw = window.innerWidth;
      vh = window.innerHeight;
    };
    sync();
    window.addEventListener("resize", sync);

    /* Les dos des autres appareils sont préchargés une fois la page montée :
       sans ça, la première bascule laisse un trou le temps du téléchargement, et
       une bascule qui clignote n'a pas l'air instantanée. Après le montage et
       pas avant — le premier rendu ne doit rien attendre. */
    for (const dev of DEVICES) new Image().src = dev.photo.src;

    return () => window.removeEventListener("resize", sync);
  });

  const dev = $derived(frame.device);

  /** Un disque du dos : centré sur ses coordonnées, carré, en % du cadre. */
  const at = (c: Disc) =>
    `left:${c.left * 100}%;top:${c.top * 100}%;width:${c.pct * 100}%`;

  const size = $derived(Math.min(dev.frameWidth, width));
  const narrow = $derived(vw <= NARROW);
  const cap = $derived(Math.floor(vh * SHARE));

  /* Le disque seul **doit tenir en entier**, quitte à réduire : le rogner ferait
     perdre des LEDs, et une matrice amputée ne dit plus ce qu'elle contient.
     C'est l'inverse du téléphone, dont on ne perd que le bas du dos.

     `stageH` est la hauteur que le cadre a réellement obtenue, déjà comprimée
     par la mise en page quand la place manque. S'en servir comme plafond
     converge en une passe : le disque redescend à cette hauteur, le cadre n'a
     alors plus besoin de comprimer, et les deux se stabilisent.

     La perte de netteté que ça coûte est acceptée ici — les cellules du mode
     grand sont trois à six fois plus grosses que sur le téléphone, un pixel
     d'arrondi s'y voit beaucoup moins. */
  const discSize = $derived(
    Math.min(width, narrow ? cap : Infinity, stageH > 0 ? stageH : Infinity),
  );

  /* Hauteur gardée en colonne unique. Nulle ailleurs : le CSS ne s'en sert que
     sous le point de rupture. */
  const band = $derived(
    mode === "phone" ? Math.min(Math.round(size * previewBand(dev)), cap) : discSize,
  );

  /* Les deux modes ne diffèrent que par le diamètre offert au disque : celui
     relevé sur la photo, ou toute la place de la colonne. La grille et le cerne
     s'en déduisent — la cellule suit le diamètre réellement affiché et jamais une
     valeur figée, sinon la trame devient irrégulière sur colonne étroite. */
  const grid = $derived<Grid>(
    screenGrid(dev, mode === "phone" ? size * dev.disc.pct : discSize, dpr),
  );

  /* Si la préview ne rentre pas en hauteur, le cadre la rogne **par le bas**
     plutôt que de la réduire ou de rendre la page défilante. Le disque est dans
     le haut de l'appareil : ce qu'on perd, c'est le Glyph Button et le bas du
     dos, décoratifs. D'où l'alignement en haut du cadre — un centrage rognerait
     des deux côtés et mangerait la matrice. */
  const naturalH = $derived(mode === "phone" ? size / dev.aspect : grid.discCss);
  /* deux pixels de mou : les deux hauteurs s'égalisent pile quand ça rentre, et
     l'arrondi à l'entier ferait apparaître le fondu sur un cheveu */
  const clipped = $derived(stageH > 0 && naturalH - stageH > 2);

  /* La légende se pose à gauche du Glyph Button : le seul appareil qui en porte
     un l'a à droite du dos. La cote vient du profil et non du CSS ; le jour où
     l'un le porte à gauche, ça se règle ici. */
  const hintX = $derived(dev.button ? dev.button.left - dev.button.pct / 2 - 0.02 : 0);

  /* Position à l'écran de la boîte qui porte le canvas — le dos en mode
     téléphone, le disque en mode grand. Relue à chaque changement de taille ou
     de mode : sans elle, impossible de savoir si le canvas tombe sur un pixel
     entier. */
  $effect(() => {
    void size;
    void mode;
    void vw;
    void vh;
    void grid;
    if (!phoneEl) return;
    const r = phoneEl.getBoundingClientRect();
    phoneX = r.left;
    phoneY = r.top;
  });

  /**
   * Cale une coordonnée du canvas sur la grille de pixels de **l'écran**, pas
   * sur celle de son parent.
   *
   * Un canvas posé à un demi-pixel est rééchantillonné par le navigateur, et
   * tout le rendu devient flou d'un coup — alors que son contenu, lui, est
   * parfaitement net. Le piège est vicieux : la netteté dépendait de la parité
   * de la taille du canvas et du centrage du téléphone, donc elle apparaissait
   * et disparaissait au gré des largeurs, sans rapport visible avec ce qu'on
   * venait de changer.
   *
   * On arrondit donc la position **écran** et on repasse en coordonnées locales.
   */
  const snap = (local: number, origine: number) => Math.round(local + origine) - origine;

  const frameH = $derived(size / dev.aspect);
  /* En mode téléphone le canvas se cale sur le hublot de la photo ; en mode
     grand il se centre dans le disque dessiné. Dans les deux cas la position
     finale est un entier écran — le mode grand pardonne un peu plus, ses
     cellules étant deux à trois fois plus grosses, mais un demi-pixel s'y voit
     quand même. */
  const matrixX = $derived(
    mode === "phone"
      ? snap(dev.disc.left * size - grid.cssSize / 2, phoneX)
      : snap((grid.discCss - grid.cssSize) / 2, phoneX),
  );
  const matrixY = $derived(
    mode === "phone"
      ? snap(dev.disc.top * frameH - grid.cssSize / 2, phoneY)
      : snap((grid.discCss - grid.cssSize) / 2, phoneY),
  );

  $effect(() => {
    if (!cvs) return;
    const g = grid;
    if (cvs.width !== g.size) cvs.width = cvs.height = g.size;
    const ctx = cvs.getContext("2d");
    if (ctx) paint(ctx, held && compare ? compare : frame, g, { style });
  });

  function hold(on: boolean) {
    if (!compare) return;
    held = on;
  }

  const holdHandlers = {
    onpointerdown: () => hold(true),
    onpointerup: () => hold(false),
    onpointerleave: () => hold(false),
    onpointercancel: () => hold(false),
    onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && hold(true),
    onkeyup: () => hold(false),
    onclick: (e: MouseEvent) => e.preventDefault(),
    oncontextmenu: (e: Event) => e.preventDefault(),
  };
</script>

<figure class="device">
  <div class="stage" class:clipped style="--band:{band}px" bind:clientHeight={stageH}>
    {#if mode === "phone"}
      <div
        bind:this={phoneEl}
        class="phone"
        style="width:{size}px;aspect-ratio:{dev.aspect}"
      >
        <img src={dev.photo.src} alt={dev.photo.alt} draggable="false" />

        <!-- Le hublot de la photo est noirci : il n'y a rien à masquer, donc
             pas d'aplat. Le canvas est posé seul, centré sur le hublot, et
             c'est le fond de la photo — biseau du verre et reflets compris —
             qui fait le fond. -->
        <canvas
          bind:this={cvs}
          class="matrix"
          style="left:{matrixX}px;top:{matrixY}px;width:{grid.cssSize}px;height:{grid.cssSize}px"
        ></canvas>

        {#if dev.button}
          <button
            class="glyphbtn"
            class:is-held={held}
            disabled={!compare}
            style={at(dev.button)}
            aria-label="Glyph Button — maintenir pour comparer avec le rendu sans réglages"
            {...holdHandlers}
          ></button>

          <!-- pas de légende quand il n'y a rien à comparer : elle promettrait
               une action que le bouton désactivé ne rend pas -->
          {#if compare}
            <span
              class="hint"
              class:on={held}
              style="left:{hintX * 100}%;top:{dev.button.top * 100}%"
            >
              {held ? "Rendu brut" : "Maintenir"}
            </span>
          {/if}
        {/if}
      </div>
    {:else}
      <!-- le disque, cerne compris : le canvas ne porte que les LEDs, et il y
           est posé en pixels entiers comme sur le dos -->
      <div
        bind:this={phoneEl}
        class="disc big"
        style="width:{grid.discCss}px;height:{grid.discCss}px;background:{DISC_BG[style]}"
      >
        <canvas
          bind:this={cvs}
          class="matrix"
          style="left:{matrixX}px;top:{matrixY}px;width:{grid.cssSize}px;height:{grid.cssSize}px"
        ></canvas>
      </div>
    {/if}
  </div>

  <!-- L'A/B en barre : quand il n'y a pas de téléphone à l'écran, et quand
       l'appareil affiché n'a pas de Glyph Button sur lequel le poser. La
       fonction ne dépend donc d'aucun bouton physique. -->
  {#if mode === "large" || !dev.button}
    <button class="ab" class:is-held={held} disabled={!compare} {...holdHandlers}>
      {held ? "Rendu brut" : "Maintenir : avant / après"}
    </button>
  {/if}

  <figcaption>
    <span class="k">LED allumées</span>
    <span class="v">[{String(frame.lit).padStart(3, "0")} / {dev.ledCount}]</span>
    <span class="k">Moyenne</span>
    <span class="v">{Math.round(frame.mean * 100)} %</span>
    <span class="k">Échelle</span>
    <span class="v">{grid.cell} px / LED</span>
  </figcaption>
</figure>

<style>
  .device {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    /* ne grandit pas — il n'y aurait rien à mettre dans la place en trop — mais
       se comprime, et c'est ce qui déclenche le rognage */
    flex: 0 1 auto;
    min-height: 0;
  }

  /* Cadre de rognage. Il colle à la hauteur de son contenu tant que celui-ci
     tient, et se comprime sinon : c'est le seul enfant rétractable de .device,
     la légende et le bouton A/B sont figés pour rester lisibles. */
  .stage {
    --fade: 56px;
    flex: 0 1 auto;
    min-height: 0;
    width: 100%;
    display: flex;
    /* en haut, pas au centre : le rognage doit se faire par le bas */
    align-items: flex-start;
    justify-content: center;
    overflow: hidden;
  }

  /* Fondu au bord du rognage, seulement quand il y a rognage. Sans lui le fond,
     qui se termine déjà par un dégradé, se ferait couper net. */
  .stage.clipped {
    -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--fade)), transparent 100%);
    mask-image: linear-gradient(to bottom, #000 calc(100% - var(--fade)), transparent 100%);
  }

  /* largeur et proportions posées en ligne : la taille de cellule s'en déduit */
  .phone {
    position: relative;
  }

  /* La photo n'a pas de bord franc : elle se termine en fondu, sinon la bande
     basse se ferait couper net. Un aplat superposé masquerait la trame de fond
     de page, d'où le masque plutôt qu'un calque. */
  .phone img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    -webkit-mask-image: linear-gradient(to bottom, #000 86%, transparent 99%);
    mask-image: linear-gradient(to bottom, #000 86%, transparent 99%);
    /* hors du hit-test : sinon l'appui long sur le bouton, qui la recouvre,
       ouvre le menu contextuel « enregistrer l'image » de Chrome Android */
    pointer-events: none;
    -webkit-user-drag: none;
    user-select: none;
  }

  /* Mode téléphone : le canvas seul, calé sur le hublot. Aucun conteneur, donc
     aucun cercle qui pourrait rogner une LED — le masque de la matrice teste le
     centre des cellules, si bien que les LEDs des rangées extrêmes débordent du
     rayon nominal et se faisaient trancher par le découpage circulaire d'avant.

     Position posée en pixels entiers depuis le script (voir `snap`), et non en
     pourcentage avec un `translate(-50%)` : le centre tombait alors sur un
     demi-pixel une fois sur deux, et le canvas entier partait au flou. */
  .matrix {
    position: absolute;
    display: block;
  }

  /* Mode grand : là il n'y a pas de photo, le disque doit donc être dessiné.
     La couleur de fond vient du style de LED, posée en ligne. Le canvas y est
     centré plutôt qu'étiré — sa taille est un multiple entier de la cellule,
     donc rarement le diamètre exact du hublot, et l'étirer redonnerait la trame
     irrégulière que le calcul en pixels entiers évite. */
  .disc {
    position: relative;
    border-radius: 50%;
  }

  .disc.big {
    max-width: 100%;
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  /* dimensions posées en ligne depuis la grille */
  .disc canvas {
    display: block;
    flex: none;
  }

  /* bouton Glyph, calé sur le bouton de l'appareil */
  .glyphbtn {
    position: absolute;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    /* accent en valeur fixe, jamais var(--accent) : le bouton est sur le corps
       noir de l'appareil, le rouge clair est le seul qui tienne en thème clair
       comme en sombre */
    border: 1px solid #ff3b2e;
    padding: 0;
    background: transparent;
    cursor: pointer;
    /* tactile : le navigateur ne doit prendre l'appui ni pour un début de
       scroll ni pour un appui long système */
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.12s;
  }

  .glyphbtn:disabled {
    border-color: rgba(255, 255, 255, 0.28);
    cursor: default;
  }

  .glyphbtn:not(:disabled):hover {
    border-width: 2px;
  }

  .glyphbtn.is-held {
    background: #ff3b2e;
    border-width: 2px;
  }

  .hint {
    position: absolute;
    transform: translate(-100%, -50%);
    white-space: nowrap;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    /* posé sur le corps noir du téléphone, pas sur la page : cette couleur ne
       peut pas suivre le thème, elle doit tenir sur du noir dans les deux */
    color: rgba(255, 255, 255, 0.45);
    pointer-events: none;
  }

  .hint.on {
    color: #ff3b2e;
  }

  /* équivalent du Glyph Button quand il n'y a pas de téléphone à l'écran */
  .ab {
    flex: none;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--dim);
    border-radius: 0;
    padding: 0.34rem 0.7rem;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }

  .ab:not(:disabled):hover {
    color: var(--ink);
    border-color: var(--ink);
  }

  .ab:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .ab.is-held {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  figcaption {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 0.5rem 0.9rem;
    flex-wrap: wrap;
    justify-content: center;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  figcaption .k {
    color: var(--faint);
  }

  figcaption .k::after {
    content: " :";
  }

  figcaption .v {
    color: var(--ink);
  }

  /* Bande calculée dans le script — voir previewBand / SHARE. Le fondu y est
     plus court : sur une colonne de téléphone, 56 px mordraient sur le bas du
     disque. */
  @media (max-width: 1200px) {
    .stage {
      --fade: 28px;
      max-height: var(--band);
    }
  }
</style>


