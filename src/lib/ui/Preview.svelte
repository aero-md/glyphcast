<script module lang="ts">
  export type PreviewMode = "phone" | "large";
</script>

<script lang="ts">
  /* Deux échelles pour la même matrice.
     - « téléphone » : rendue à sa position et à son échelle réelles sur le dos
       de l'appareil. Positions en pourcentage du cadre, jamais en px — c'est ce
       qui garde le calage quand la préview est redimensionnée. Tout vient du
       profil : le (3) est un relevé sur photo, le (4a) Pro un schéma coté.
     - « grand » : le disque seul sur toute la largeur de la colonne, pour lire
       LED par LED ce que fait un réglage.

     La géométrie n'est jamais passée en propriété : elle est lue dans
     `frame.device`. Une trame et son cadre ne peuvent donc pas se désaccorder
     pendant une bascule d'appareil. */
  import { onMount } from "svelte";
  import { previewBand, type Disc } from "../devices";
  import type { Frame } from "../pipeline";
  import { DISC_BG, paint, screenGrid, type Grid, type LedStyle } from "../render";

  /* Largeur de référence du cadre. Le téléphone n'est jamais réduit pour tenir
     dans la fenêtre : à 576 px de large, la matrice d'un Phone (3) fait 150 px,
     soit 6 px CSS par LED — son échelle réelle. La rétrécir viderait le mode
     « téléphone » de son sens. Seule une colonne plus étroite le contraint. */
  const FULL = 576;

  /* Colonne unique : la préview est épinglée en haut de l'écran et le rack
     défile dessous, pour qu'on voie l'effet d'un curseur pendant qu'on le
     manipule. On n'en garde donc qu'une bande, dont la hauteur se déduit du bas
     du disque (voir `previewBand`).
     - SHARE plafonne la bande en hauteur d'écran, sinon un appareil large sur
       un écran court ne laisserait rien au rack.
     - NARROW double le point de rupture du CSS. */
  const SHARE = 0.4;
  const NARROW = 980;

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
  let held = $state(false);
  let dpr = $state(1);
  let vw = $state(1440);
  let vh = $state(900);

  onMount(() => {
    const sync = () => {
      dpr = window.devicePixelRatio || 1;
      vw = window.innerWidth;
      vh = window.innerHeight;
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  });

  const dev = $derived(frame.device);

  /** Un disque du dos : centré sur ses coordonnées, carré, en % du cadre. */
  const at = (c: Disc) =>
    `left:${c.left * 100}%;top:${c.top * 100}%;width:${c.pct * 100}%`;

  const size = $derived(Math.min(FULL, width));
  const narrow = $derived(vw <= NARROW);
  const cap = $derived(Math.floor(vh * SHARE));

  /* Le disque seul, lui, se réduit : il n'a pas d'échelle réelle à préserver, et
     le rogner ferait perdre des LEDs — l'inverse du téléphone, dont on ne perd
     que le bas du dos et le Glyph Button. */
  const discSize = $derived(narrow ? Math.min(size, cap) : size);

  /* Hauteur gardée en colonne unique. Nulle ailleurs : le CSS ne s'en sert que
     sous le point de rupture. */
  const band = $derived(
    mode === "phone" ? Math.min(Math.round(size * previewBand(dev)), cap) : discSize,
  );

  /* Mode téléphone : la cellule suit le diamètre réellement affiché, pas une
     valeur figée — sur colonne étroite la trame deviendrait irrégulière, et le
     rapport change d'un appareil à l'autre. Mode grand : la plus grande cellule
     entière qui tient dans le cadre, un pas fractionnaire élargirait une colonne
     sur n. */
  const grid = $derived<Grid>(
    mode === "phone"
      ? screenGrid(dev, (size * dev.disc.pct) / dev.size, dpr)
      : screenGrid(dev, Math.max(6, Math.floor(discSize / dev.size)), dpr),
  );

  /* Si la préview ne rentre pas en hauteur, le cadre la rogne **par le bas**
     plutôt que de la réduire ou de rendre la page défilante. Le disque est dans
     le haut de l'appareil : ce qu'on perd, c'est le Glyph Button et le bas du
     dos, décoratifs. D'où l'alignement en haut du cadre — un centrage rognerait
     des deux côtés et mangerait la matrice. */
  let stageH = $state(0);
  const naturalH = $derived(mode === "phone" ? size / dev.aspect : grid.cssSize);
  /* deux pixels de mou : les deux hauteurs s'égalisent pile quand ça rentre, et
     l'arrondi à l'entier ferait apparaître le fondu sur un cheveu */
  const clipped = $derived(stageH > 0 && naturalH - stageH > 2);

  /* La légende du Glyph Button se range du côté où il reste de la place : le
     bouton est à droite sur un (3), à gauche sur un (4a) Pro. Ancrée du mauvais
     côté, elle sortirait du cadre. */
  const hintRight = $derived(dev.button.left < 0.5);
  const hintX = $derived(
    hintRight
      ? dev.button.left + dev.button.pct / 2 + 0.02
      : dev.button.left - dev.button.pct / 2 - 0.02,
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
      <div class="phone" style="width:{size}px;aspect-ratio:{dev.aspect}">
        {#if dev.backdrop.kind === "photo"}
          <img src={dev.backdrop.src} alt={dev.backdrop.alt} draggable="false" />
        {:else}
          {@const b = dev.backdrop}
          <!-- Schéma, pas photo : filets d'1 px sur corps plein. Il dit où sont
               les choses sans prétendre montrer l'objet. -->
          <div class="plate" role="img" aria-label="Schéma du dos d'un {dev.name}">
            <span
              class="plateau"
              style="left:{b.plateau.left * 100}%;top:{b.plateau.top * 100}%;width:{b
                .plateau.width * 100}%;height:{b.plateau.height * 100}%"
            ></span>
            {#each b.lenses as lens, i (i)}
              <span class="lens" style={at(lens)}></span>
            {/each}
          </div>
        {/if}

        <div class="disc" style="{at(dev.disc)};background:{DISC_BG[style]}">
          <canvas bind:this={cvs}></canvas>
        </div>

        <button
          class="glyphbtn"
          class:is-held={held}
          disabled={!compare}
          style={at(dev.button)}
          aria-label="Glyph Button — maintenir pour comparer avec le rendu sans réglages"
          {...holdHandlers}
        ></button>

        <!-- pas de légende quand il n'y a rien à comparer : elle promettrait une
             action que le bouton désactivé ne rend pas -->
        {#if compare}
          <span
            class="hint"
            class:on={held}
            class:right={hintRight}
            style="left:{hintX * 100}%;top:{dev.button.top * 100}%"
          >
            {held ? "Rendu brut" : "Maintenir"}
          </span>
        {/if}
      </div>
    {:else}
      <div
        class="disc big"
        style="width:{grid.cssSize}px;height:{grid.cssSize}px;background:{DISC_BG[style]}"
      >
        <canvas bind:this={cvs}></canvas>
      </div>
    {/if}
  </div>

  {#if mode === "large"}
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

  .phone img,
  .plate {
    position: absolute;
    inset: 0;
  }

  /* La photo n'a pas de bord franc : elle se termine en fondu, sinon la bande
     basse se ferait couper net. Un aplat superposé masquerait la trame de fond
     de page, d'où le masque. Le schéma, lui, a une arête — c'est un plan, il
     s'arrête. */
  .phone img {
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

  /* Corps de l'appareil quand on n'a pas de photo. Angles vifs, filets d'1 px,
     aucune ombre : c'est un plan, il ne mime pas une prise de vue.

     Trois valeurs de gris qui se suffisent : le plateau est plus clair que le
     corps, le disque plus sombre que les deux — dans les deux styles de LED.
     C'est ce qui fait lire la matrice comme une fenêtre ronde sans simuler de
     profondeur. À corps et plateau de même valeur, le disque disparaissait. */
  .plate {
    background: #0b0b0d;
    border: 1px solid rgba(255, 255, 255, 0.16);
    pointer-events: none;
  }

  .plateau {
    position: absolute;
    background: #17171c;
    border: 1px solid rgba(255, 255, 255, 0.22);
  }

  .lens {
    position: absolute;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.22);
  }

  /* la couleur de fond vient du style de LED, posée en inline */
  .disc {
    border-radius: 50%;
    overflow: hidden;
  }

  /* position et diamètre posés en ligne depuis le profil */
  .phone .disc {
    position: absolute;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
  }

  .disc.big {
    max-width: 100%;
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .disc canvas {
    display: block;
    width: 100%;
    height: 100%;
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

  /* bouton à gauche du dos : la légende passe de l'autre côté */
  .hint.right {
    transform: translate(0, -50%);
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
  @media (max-width: 980px) {
    .stage {
      --fade: 28px;
      max-height: var(--band);
    }
  }
</style>
