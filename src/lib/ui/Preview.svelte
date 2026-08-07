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
  /* Point de rupture des deux colonnes — **deux seuils, pas un**, et le second
     regarde la forme de la fenêtre.

     - FLOOR : la largeur en dessous de laquelle la grille ne rentre plus, point.
       550 px de colonne de préview, 25,6 de gouttière, les 300 px minimum du
       rack et 76,8 de marges font 952,4. En dessous, la grille déborde au lieu
       de passer en colonne. Arrondi à 960.
     - COMFY / LANDSCAPE : entre FLOOR et COMFY la grille rentre mais le rack
       descend sous ~430 px et ses libellés de curseur se cassent en deux
       lignes. On n'y bascule en colonne unique que si la fenêtre est **carrée
       ou plus haute que large** (ratio ≤ 5/4) — fenêtre étroite sur un bureau,
       tablette en portrait. Un portable reste en deux colonnes : il est large
       de 1024 ou 1280 px pour 640 à 800 de haut, la colonne unique y épinglait
       une bande de préview et rendait la page défilante alors que les deux
       colonnes tenaient parfaitement.

     Le ratio est le bon critère parce que c'est la hauteur qui décide de
     l'intérêt de la colonne unique, pas la largeur : sur un écran large et
     court, épingler une bande de 40 % ne laisse rien au rack.

     Le CSS des deux fichiers double ces seuils — voir les media queries. */
  const FLOOR = 960;
  const COMFY = 1080;
  const LANDSCAPE = 5 / 4;

  type Props = {
    frame: Frame;
    mode?: PreviewMode;
    style?: LedStyle;
    /** Rendu de comparaison affiché tant que le bouton est maintenu. */
    compare?: Frame | null;
    /** Largeur disponible en px CSS, pour caler la grille du mode « grand ». */
    width?: number;
  };

  let { frame, mode = "phone", style = "sharp", compare = null, width = 550 }: Props = $props();

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
  const narrow = $derived(vw <= FLOOR || (vw <= COMFY && vw / vh <= LANDSCAPE));
  const cap = $derived(Math.floor(vh * SHARE));

  /* Hauteur de bande gardée en colonne unique. Nulle part ailleurs : le CSS ne
     s'en sert que sous le point de rupture.

     **Elle ne dépend pas du mode.** Basculer d'échelle change la façon de
     regarder la matrice, pas la place que la préview occupe dans la page :
     quand la bande suivait le mode, le rack qui passe dessous sautait de
     70 px à chaque aller-retour, et la page entière se réorganisait sous le
     doigt pour un réglage qui ne concerne que la préview.

     C'est le **mode téléphone** qui donne la référence, parce que c'est le seul
     des deux qui ait une géométrie à respecter : la bande se dérive du bas du
     disque sur la photo du dos (`previewBand`), avec ce qu'il faut de marge pour
     que le fondu de rognage tombe sous les LEDs et non dessus. Le mode grand n'a
     rien d'équivalent à faire valoir — il prendrait toute la place qu'on lui
     laisse — donc c'est lui qui s'aligne. */
  const band = $derived(Math.min(Math.round(size * previewBand(dev)), cap));

  /* Le disque seul **doit tenir en entier**, quitte à réduire : le rogner ferait
     perdre des LEDs, et une matrice amputée ne dit plus ce qu'elle contient.
     C'est l'inverse du téléphone, dont on ne perd que le bas du dos.

     `stageH` est la hauteur que le cadre a réellement obtenue, déjà comprimée
     par la mise en page quand la place manque. S'en servir comme plafond
     converge en une passe : le disque redescend à cette hauteur, le cadre n'a
     alors plus besoin de comprimer, et les deux se stabilisent.

     En colonne unique le plafond est la **bande**, pas la part d'écran brute :
     c'est ce qui aligne le mode grand sur le mode téléphone.

     La perte de netteté que ça coûte est acceptée ici — les cellules du mode
     grand sont trois à six fois plus grosses que sur le téléphone, un pixel
     d'arrondi s'y voit beaucoup moins. */
  const discSize = $derived(
    Math.min(width, narrow ? band : Infinity, stageH > 0 ? stageH : Infinity),
  );

  /* Les deux modes ne diffèrent que par le diamètre offert au disque : celui
     relevé sur la photo, ou toute la place de la colonne. La grille et le cerne
     s'en déduisent — la cellule suit le diamètre réellement affiché et jamais une
     valeur figée, sinon la trame devient irrégulière sur colonne étroite.

     Le mode grand demande en plus un disque qui **ne dépasse pas** le diamètre
     offert : là, contrairement au téléphone, il est réellement dessiné et vit
     dans une colonne de largeur finie. Le mode téléphone, lui, a besoin de
     l'arrondi vers le haut — c'est ce qui lui donne sa cellule. */
  const grid = $derived<Grid>(
    mode === "phone"
      ? screenGrid(dev, size * dev.disc.pct, dpr)
      : screenGrid(dev, discSize, dpr, true),
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

  /* Position à l'écran de **l'ancre** — la boîte qui porte le cadre, et qui ne
     porte jamais la correction sous-pixel. Relue à chaque changement de taille
     ou de mode. */
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
   * Décalage sous-pixel qui repose une coordonnée sur la grille de pixels
   * **physiques** de l'écran.
   *
   * La page est centrée en `margin: 0 auto` et le cadre l'est en flex dans sa
   * colonne : dès que la fenêtre a la mauvaise parité, le cadre se pose sur un
   * demi-pixel. Le canvas, lui, doit tomber sur des pixels entiers — un canvas
   * rééchantillonné devient flou d'un coup alors que son contenu est net.
   *
   * Le code corrigeait ça **côté canvas**, en arrondissant sa position écran et
   * en repassant en coordonnées locales. Net, mais au prix d'un décalage de
   * jusqu'à un demi-pixel entre le canvas et la photo, **variable avec la
   * largeur de la fenêtre** : en redimensionnant d'un pixel, le dos bougeait
   * sans le canvas, puis l'inverse, et les deux se recollaient tous les 3-4 px.
   * Régler le calage à l'œil dans ces conditions revient à viser une cible
   * mouvante — c'est comme ça que `disc` a fini 1,7 px trop à droite.
   *
   * On corrige donc **côté cadre** : l'ancre est mesurée, le cadre reçoit le
   * décalage qui le repose sur la grille, et le canvas se positionne alors en
   * coordonnées purement locales (`gridSnap`). Le canvas est net, il ne bouge
   * plus jamais par rapport à la photo, et le calage devient une constante du
   * profil au lieu d'une fonction de la fenêtre.
   *
   * **La correction porte sur un autre élément que celui qu'on mesure.** Une
   * transformation entre dans `getBoundingClientRect`, donc l'appliquer à
   * l'ancre ferait mesurer la position déjà corrigée, la correction retomberait
   * à zéro et la valeur oscillerait d'une image à l'autre. D'où l'ancre nue et
   * le cadre transformé à l'intérieur.
   */
  const sousPixel = (v: number) => (Math.round(v * dpr) - v * dpr) / dpr;
  const subX = $derived(sousPixel(phoneX));
  const subY = $derived(sousPixel(phoneY));

  /**
   * Arrondit une coordonnée **locale** au pixel physique. Le cadre étant sur la
   * grille, une position locale sur la grille l'est aussi à l'écran.
   *
   * Le `dpr` compte : arrondir au pixel CSS jette la précision d'un écran dense.
   * Sur un appareil à dpr 3, un pixel CSS vaut trois pixels physiques, et la
   * matrice pouvait atterrir à un pixel et demi du centre du hublot — invisible
   * tant que le cerne faisait 7 px, franc une fois tombé à 3,7, et introuvable
   * en émulation où le dpr vaut 1 et où les deux grilles se confondent.
   */
  const gridSnap = (local: number) => Math.round(local * dpr) / dpr;

  const frameH = $derived(size / dev.aspect);
  /* En mode téléphone le canvas se cale sur le hublot de la photo ; en mode
     grand il se centre dans le disque dessiné. Dans les deux cas la position
     est **purement locale** : le cadre étant reposé sur la grille physique par
     `subX`/`subY`, une coordonnée locale sur la grille l'est aussi à l'écran.
     Ni `phoneX` ni la largeur de la fenêtre n'entrent plus dans le calcul — le
     canvas ne peut donc plus se décaler de la photo. */
  const matrixX = $derived(
    gridSnap(
      mode === "phone"
        ? dev.disc.left * size - grid.cssSize / 2
        : (grid.discCss - grid.cssSize) / 2,
    ),
  );
  const matrixY = $derived(
    gridSnap(
      mode === "phone"
        ? dev.disc.top * frameH - grid.cssSize / 2
        : (grid.discCss - grid.cssSize) / 2,
    ),
  );

  $effect(() => {
    if (!cvs) return;
    const g = grid;
    if (cvs.width !== g.size) cvs.width = cvs.height = g.size;
    const ctx = cvs.getContext("2d");
    // LEDs agrandies en mode grand seulement : le mode téléphone garde les
    // proportions relevées sur la photo
    if (ctx)
      paint(ctx, held && compare ? compare : frame, g, { style, grand: mode === "large" });
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
      <!-- Ancre nue : c'est elle qu'on mesure, elle ne porte jamais la
           correction sous-pixel. Le cadre transformé est à l'intérieur — voir
           `sousPixel`, mesurer l'élément transformé annulerait la correction. -->
      <div
        bind:this={phoneEl}
        class="anchor"
        style="width:{size}px;aspect-ratio:{dev.aspect}"
      >
      <div class="phone" style="transform:translate({subX}px,{subY}px)">
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
      </div>
    {:else}
      <!-- le disque, cerne compris : le canvas ne porte que les LEDs, et il y
           est posé en pixels entiers comme sur le dos. Même ancre qu'au mode
           téléphone, pour la même raison. -->
      <div
        bind:this={phoneEl}
        class="anchor big"
        style="width:{grid.discCss}px;height:{grid.discCss}px"
      >
        <div
          class="disc big"
          style="transform:translate({subX}px,{subY}px);background:{DISC_BG[style]}"
        >
          <canvas
            bind:this={cvs}
            class="matrix"
            style="left:{matrixX}px;top:{matrixY}px;width:{grid.cssSize}px;height:{grid.cssSize}px"
          ></canvas>
        </div>
      </div>
    {/if}
  </div>

  <!-- L'A/B en barre : uniquement pour un appareil qui n'a pas de Glyph Button
       sur lequel poser la fonction, et uniquement en mode téléphone.

       Pas en mode grand. Ce mode ne prétend pas émuler l'appareil, il sert à
       lire LED par LED ce que fait un réglage — la comparaison avec le rendu
       brut se fait sur le téléphone, où elle veut dire quelque chose. La barre
       n'y ajoutait qu'une ligne de chrome sous un disque déjà contraint en
       hauteur. -->
  {#if mode === "phone" && !dev.button}
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

  /* Ancre : largeur et proportions posées en ligne, la taille de cellule s'en
     déduit. Elle occupe la place et sert de repère de mesure ; c'est son enfant
     qui reçoit le décalage sous-pixel. Une transformation ne change pas la mise
     en page, donc l'ancre reste là où le flex l'a posée. */
  .anchor {
    position: relative;
    flex: none;
  }

  .anchor.big {
    max-width: 100%;
  }

  .phone {
    position: absolute;
    inset: 0;
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

  /* remplit son ancre : c'est elle qui porte les dimensions */
  .disc.big {
    position: absolute;
    inset: 0;
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
     disque.

     Condition identique à FLOOR / COMFY / LANDSCAPE côté script — les deux
     doivent basculer sur la même fenêtre, sinon la bande se plafonne sans que
     la mise en page ait changé. */
  @media (max-width: 960px), (max-width: 1080px) and (max-aspect-ratio: 5 / 4) {
    /* `height` et non `max-height` : la bande doit faire cette hauteur, pas
       « au plus » cette hauteur. Le disque du mode grand est un multiple entier
       de sa cellule, donc presque toujours un peu plus court que la bande — sur
       un `max-height` le cadre se serait recollé à lui et la colonne aurait
       encore sauté d'une quinzaine de pixels à la bascule, ce qu'on cherche
       précisément à supprimer. Le mou tombe sous le disque, où il ne se voit
       pas : le fond est transparent et le cadre aligné en haut. */
    .stage {
      --fade: 28px;
      height: var(--band);
    }

    /* Les lectures sautent. Elles décrivent la trame, elles ne servent pas à la
       régler — et en colonne unique elles sont posées entre la matrice et le
       rack, c'est-à-dire pile là où se joue le va-et-vient de l'œil pendant
       qu'on manipule un curseur. Les 30 px qu'elles occupaient (ligne + gouttière)
       reviennent à la bande de préview, qui est plafonnée à 40 % de la hauteur
       d'écran et n'a rien de trop.

       Le compte de LED reste lisible au pied de page, et l'échelle en px/LED ne
       veut de toute façon pas dire grand-chose sur un écran de téléphone. */
    figcaption {
      display: none;
    }
  }
</style>


