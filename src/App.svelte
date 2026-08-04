<script lang="ts">
  import {
    DEFAULT_DEVICE,
    DEVICES,
    deviceById,
    type Device,
    type DeviceId,
  } from "./lib/devices";
  import { CHANNEL_PRESETS, DEFAULTS, convert, type DitherMode, type Params } from "./lib/pipeline";
  import {
    RANGES as R,
    VERSION,
    copy,
    downloadJson,
    downloadKotlin,
    exportPng,
    parseSession,
    toKotlin,
  } from "./lib/export";
  import type { LedStyle } from "./lib/render";
  import Card from "./lib/ui/Card.svelte";
  import Preview, { type PreviewMode } from "./lib/ui/Preview.svelte";
  import Seg from "./lib/ui/Seg.svelte";
  import Slider from "./lib/ui/Slider.svelte";
  import ThemeToggle from "./lib/ui/ThemeToggle.svelte";
  import Wordmark from "./lib/ui/Wordmark.svelte";

  /* --- source --- */
  let img = $state<HTMLImageElement | null>(null);
  let srcW = $state(0);
  let srcH = $state(0);
  let fileName = $state("");
  let dragging = $state(false);
  let notice = $state("");
  let objectUrl: string | null = null;

  /* --- réglages --- */
  /* L'appareil ne fait que changer la grille sous l'image : aucun réglage n'est
     exprimé en LEDs, ils sont tous photographiques. Basculer préserve donc la
     source, le cadrage et toute la tonalité — c'est ce qui rend la comparaison
     entre les deux matrices utile plutôt que théorique. */
  let device = $state<Device>(DEFAULT_DEVICE);
  let params = $state<Params>({ ...DEFAULTS });
  let mode = $state<PreviewMode>("phone");
  let ledStyle = $state<LedStyle>("sharp");

  /* Largeur de la colonne, pour que le mode « grand » occupe exactement la
     place du téléphone. */
  let colW = $state(576);

  /* --- défilement du rack ---
     La page ne défile jamais : elle occupe la fenêtre, l'en-tête, la préview et
     le pied restent en place et seul le rack défile. Le fondu haut/bas est
     proportionnel à la distance déjà parcourue, plafonnée à FADE — il apparaît
     donc en douceur sans transition CSS, et reste nul tant que la liste tient
     dans la hauteur. */
  const FADE = 32;
  let rackEl = $state<HTMLElement | null>(null);
  let rackTop = $state(0);
  let rackMax = $state(0);
  const fadeTop = $derived(Math.min(FADE, rackTop));
  const fadeBot = $derived(Math.min(FADE, rackMax - rackTop));

  function syncRack() {
    if (!rackEl) return;
    rackTop = rackEl.scrollTop;
    rackMax = Math.max(0, rackEl.scrollHeight - rackEl.clientHeight);
  }

  $effect(() => {
    const el = rackEl;
    if (!el) return;
    syncRack();
    /* La limite de défilement bouge sans qu'aucun scroll ne soit émis : la
       fenêtre change la hauteur du cadre, le curseur de dither apparaît et
       disparaît. On observe donc le cadre et chaque carte. */
    const ro = new ResizeObserver(syncRack);
    ro.observe(el);
    for (const card of Array.from(el.children)) ro.observe(card);
    return () => ro.disconnect();
  });

  /* Deux canvas de travail distincts : le rendu courant et le rendu de
     comparaison sont recalculés dans la même passe réactive, partager le
     scratch ferait lire l'un les pixels de l'autre. */
  const scratchA = document.createElement("canvas");
  const scratchB = document.createElement("canvas");

  const frame = $derived(convert(device, img, srcW, srcH, params, scratchA));

  /* Rendu « brut » : même cadrage, tonalité au repos, sans dither. Ce que
     donnerait l'image sans aucun réglage — la référence de l'A/B. */
  const rawParams = $derived<Params>({
    ...DEFAULTS,
    zoom: params.zoom,
    offsetX: params.offsetX,
    offsetY: params.offsetY,
    rotation: params.rotation,
  });
  const rawFrame = $derived(convert(device, img, srcW, srcH, rawParams, scratchB));

  const kotlin = $derived(toKotlin(frame));
  const hasImg = $derived(!!img);

  /* --- chargement --- */
  function load(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      flash("Fichier ignoré — image attendue");
      return;
    }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;
      img = im;
      srcW = im.naturalWidth;
      srcH = im.naturalHeight;
      fileName = file.name;
      flash("");
    };
    im.onerror = () => {
      URL.revokeObjectURL(url);
      flash("Décodage impossible");
    };
    im.src = url;
  }

  let flashTimer: ReturnType<typeof setTimeout>;
  function flash(msg: string) {
    notice = msg;
    clearTimeout(flashTimer);
    if (msg) flashTimer = setTimeout(() => (notice = ""), 2600);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    load(e.dataTransfer?.files?.[0]);
  }

  function onPaste(e: ClipboardEvent) {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
    if (item) load(item.getAsFile());
  }

  function pickFile(e: Event) {
    load((e.currentTarget as HTMLInputElement).files?.[0]);
    (e.currentTarget as HTMLInputElement).value = "";
  }

  /* --- actions --- */
  function mix(name: keyof typeof CHANNEL_PRESETS) {
    const [r, g, b] = CHANNEL_PRESETS[name];
    params.wR = r;
    params.wG = g;
    params.wB = b;
  }

  /** Étale l'histogramme sur toute la plage : les gates se posent sur les
      extrêmes réellement présents dans l'image, pas sur 0 et 1 théoriques. */
  function autoLevels() {
    if (!img) return;
    const probe = convert(
      device,
      img,
      srcW,
      srcH,
      { ...params, black: 0, white: 1, contrast: 0, gamma: 1, levels: 256, dither: "none" },
      scratchB,
    );
    // uniquement les cellules du disque : celles hors masque valent toujours 0
    // et clouaient le point noir à 0 quelle que soit l'image
    let lo = 1;
    let hi = 0;
    for (const i of device.inside) {
      const v = probe.values[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 0.02) {
      flash("Plage trop plate pour un étalement");
      return;
    }
    params.black = Math.max(0, lo - 0.01);
    params.white = Math.min(1, hi + 0.01);
    flash(`Gates posées sur ${Math.round(lo * 100)} – ${Math.round(hi * 100)} %`);
  }

  async function copyKotlin() {
    flash((await copy(kotlin)) ? "IntArray copié" : "Copie refusée par le navigateur");
  }

  async function importJson(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      // une session porte l'appareil sur lequel elle a été calculée : la relire
      // sur l'autre grille redonnerait d'autres valeurs sous les mêmes réglages
      const s = parseSession(await file.text());
      device = s.device;
      params = s.params;
      flash(`Session rechargée — ${s.device.name}`);
    } catch {
      flash("JSON illisible");
    }
  }

  function pickDevice(id: DeviceId) {
    device = deviceById(id);
    flash(`${device.name} — ${device.size}×${device.size}, ${device.ledCount} LEDs`);
  }

  /* Millésime lu à l'exécution, pas écrit en dur : un pied de page figé sur
     l'année de la dernière compilation vieillit tout seul. */
  const YEAR = new Date().getFullYear();

  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const signed = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
</script>

<svelte:window
  onpaste={onPaste}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
/>

<div class="dots"></div>
<span class="reg tl"></span>
<span class="reg tr"></span>
<span class="reg bl"></span>
<span class="reg br"></span>

<div class="page" class:dragging>
  <header>
    <Wordmark text="GLYPHCAST" />
    <!-- Registre « plaque d'instrument » : la cible, puis ce que fait l'outil.
         Les constantes de la matrice sont au pied de page, les répéter ici
         faisait doublon. Capitales par `.meta`.

         Séparateur : la puce, pas le point médian. Elle est dans Geist Mono à
         la chasse de la fonte — donc rien à grossir en CSS — et c'est le seul
         séparateur rond, ce qui est la règle de la page : le cercle est réservé
         aux points et aux LEDs. -->
    <div class="h-row">
      <p class="sub meta">
        {device.name} • Stylisez une image en la projetant sur la Glyph Matrix
      </p>
      <ThemeToggle />
    </div>
  </header>

  <main>
    <div class="col-preview" bind:clientWidth={colW}>
      <div class="scale">
        <!-- L'appareil vient en premier : c'est le seul de ces trois réglages
             qui change ce qui sort de l'outil, les deux autres ne changent que
             ce qu'on en voit. -->
        <Seg
          label="Appareil"
          value={device.id}
          options={DEVICES.map((d) => ({ v: d.id, t: d.ref }))}
          onchange={pickDevice}
        />
        <Seg
          label="Échelle de préview"
          bind:value={mode}
          options={[
            { v: "phone" as PreviewMode, t: "Téléphone" },
            { v: "large" as PreviewMode, t: "Grand" },
          ]}
        />
        <Seg
          label="Rendu des LED"
          bind:value={ledStyle}
          options={[
            { v: "sharp" as LedStyle, t: "Sharp" },
            { v: "soft" as LedStyle, t: "Soft" },
          ]}
        />
      </div>
      <Preview
        {frame}
        {mode}
        style={ledStyle}
        width={colW}
        compare={hasImg ? rawFrame : null}
      />
      {#if !hasImg}
        <p class="empty meta">
          Matrice éteinte — déposez une image n'importe où sur la page, collez-en une
          (Ctrl+V) ou passez par <b>[01] Source</b>.
        </p>
      {/if}
    </div>

    <div
      class="rack"
      bind:this={rackEl}
      onscroll={syncRack}
      style="--fade-t:{fadeTop}px;--fade-b:{fadeBot}px"
    >
      <!-- tant qu'il n'y a rien à convertir, c'est la seule carte qui ait
           quelque chose à faire : elle porte le jaune, tout le reste est éteint -->
      <Card
        ref="01"
        title="Source"
        stat={hasImg ? `${srcW}×${srcH}` : "aucune"}
        cta={!hasImg}
      >
        <label class="drop" class:armed={dragging}>
          <input type="file" accept="image/*" onchange={pickFile} />
          <span class="drop-t">{hasImg ? fileName : "Importer une image"}</span>
          <span class="drop-s label">Glisser-déposer · Coller · Parcourir</span>
        </label>
        <div class="btns">
          <!-- une session n'apporte que des réglages : sa place est ici, à
               l'entrée, et pas dans la carte qui produit les fichiers -->
          <label class="filebtn">
            <input type="file" accept="application/json,.json" onchange={importJson} />
            Importer un .json
          </label>
        </div>
        <p class="note">
          L'image est traitée en local, dans le navigateur. Rien n'est envoyé nulle part.
        </p>
      </Card>

      <Card ref="02" title="Cadrage" stat="{Math.round(params.zoom * 100)} %" locked={!hasImg}>
        <Slider label="Zoom" bind:value={params.zoom} range={R.zoom} reset={DEFAULTS.zoom} format={pct} />
        <Slider label="Décalage X" bind:value={params.offsetX} range={R.offsetX} reset={0} format={signed} />
        <Slider label="Décalage Y" bind:value={params.offsetY} range={R.offsetY} reset={0} format={signed} />
        <Slider
          label="Rotation"
          bind:value={params.rotation}
          range={R.rotation}
          step={1}
          reset={0}
          format={(v) => v.toFixed(0)}
          unit="°"
        />
        <div class="btns">
          <button type="button" onclick={() => (params.rotation = ((params.rotation - 90 + 540) % 360) - 180)}>
            ↺ 90°
          </button>
          <button type="button" onclick={() => (params.rotation = ((params.rotation + 90 + 540) % 360) - 180)}>
            ↻ 90°
          </button>
          <button
            type="button"
            onclick={() => {
              params.zoom = 1;
              params.offsetX = 0;
              params.offsetY = 0;
              params.rotation = 0;
            }}
          >
            Recadrer
          </button>
        </div>
      </Card>

      <Card ref="03" title="Mixeur de canaux" stat="monochrome" locked={!hasImg}>
        <p class="note">
          La matrice n'a pas de couleur : ces poids décident de la part de chaque canal dans la
          luminance. C'est un filtre coloré de photo noir et blanc — monter le rouge éclaircit les
          peaux et noircit un ciel bleu.
        </p>
        <Slider label="Rouge" bind:value={params.wR} range={R.wR} reset={DEFAULTS.wR} />
        <Slider label="Vert" bind:value={params.wG} range={R.wG} reset={DEFAULTS.wG} />
        <Slider label="Bleu" bind:value={params.wB} range={R.wB} reset={DEFAULTS.wB} />
        <div class="btns">
          {#each Object.keys(CHANNEL_PRESETS) as name (name)}
            <button type="button" onclick={() => mix(name)}>{name}</button>
          {/each}
        </div>
      </Card>

      <Card ref="04" title="Tonalité" stat={params.invert ? "inversé" : "direct"} locked={!hasImg}>
        <Slider
          label="Exposition"
          bind:value={params.exposure}
          range={R.exposure}
          reset={0}
          format={signed}
          unit=" IL"
        />
        <Slider label="Gate — point noir" bind:value={params.black} range={R.black} reset={0} format={pct} />
        <Slider label="Gate — point blanc" bind:value={params.white} range={R.white} reset={1} format={pct} />
        <Slider label="Contraste" bind:value={params.contrast} range={R.contrast} reset={0} format={signed} />
        <Slider label="Gamma" bind:value={params.gamma} range={R.gamma} reset={1} />
        <Slider label="Netteté" bind:value={params.sharpen} range={R.sharpen} reset={DEFAULTS.sharpen} />
        <div class="btns">
          <button type="button" class:on={params.invert} onclick={() => (params.invert = !params.invert)}>
            Inverser
          </button>
          <button type="button" onclick={autoLevels} disabled={!hasImg}>Auto-gates</button>
        </div>
      </Card>

      <Card ref="05" title="Sortie LED" stat="{params.levels} paliers" locked={!hasImg}>
        <Slider
          label="Paliers de luminosité"
          bind:value={params.levels}
          range={R.levels}
          step={1}
          reset={DEFAULTS.levels}
          format={(v) => v.toFixed(0)}
        />
        <Slider
          label="Plafond de luminosité"
          bind:value={params.ceiling}
          range={R.ceiling}
          reset={1}
          format={pct}
        />
        <Seg
          label="Dithering"
          bind:value={params.dither}
          options={[
            { v: "none" as DitherMode, t: "Aucun" },
            { v: "floyd" as DitherMode, t: "Floyd-Steinberg" },
            { v: "bayer" as DitherMode, t: "Bayer 4×4" },
          ]}
        />
        {#if params.dither !== "none"}
          <Slider
            label="Force du dither"
            bind:value={params.ditherAmount}
            range={R.ditherAmount}
            reset={1}
            format={pct}
          />
        {/if}
        <p class="note">
          À 2 paliers le rendu devient binaire et le dithering fait tout le travail. Au-delà de
          ~16 paliers la matrice restitue de vrais niveaux de gris et le dither ne sert plus qu'à
          casser les bandes dans les dégradés.
        </p>
      </Card>

      <Card ref="06" title="Export" stat="{device.ledCount} / {device.cells}">
        <div class="btns">
          <button type="button" onclick={() => exportPng(frame, ledStyle)} disabled={!hasImg}>
            PNG · {ledStyle}
          </button>
          <button type="button" onclick={copyKotlin} disabled={!hasImg}>Copier IntArray</button>
          <button type="button" onclick={() => downloadKotlin(frame)} disabled={!hasImg}>.kt</button>
          <button type="button" onclick={() => downloadJson(frame, params)} disabled={!hasImg}>.json</button>
        </div>
        <pre class="code" aria-label="IntArray Kotlin">{kotlin}</pre>
      </Card>
    </div>
  </main>

  <footer>
    <div class="f-row">
      <span class="ref">[{VERSION}]</span>
      <span class="meta">
        Row-major {device.size}×{device.size}, valeurs 0-255, masque circulaire r =
        {String(device.radius).replace(".", ",")} → {device.ledCount} LEDs.
      </span>
      <a class="sig" href="https://github.com/aero-md" target="_blank" rel="noopener noreferrer">
        © {YEAR} aero-md
      </a>
    </div>
    {#if notice}<p class="notice accent">{notice}</p>{/if}
  </footer>
</div>

<style>
  /* La page ne défile pas : elle occupe exactement la fenêtre, l'en-tête, la
     préview et le pied restent en place et seul le rack de réglages défile.
     Quand la préview ne rentre pas en hauteur elle est rognée par le bas, pas
     réduite — voir Preview. */
  .page {
    position: relative;
    z-index: 2;
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 2.4rem;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .page.dragging {
    outline: 1px solid var(--accent);
    outline-offset: -12px;
  }

  /* --- en-tête --- */
  header {
    flex: none;
    border-bottom: 1px solid var(--line);
    padding: 1.6rem 0 1rem;
    margin-bottom: 1.6rem;
  }

  /* La bascule de thème est calée sur la ligne du sous-titre, pas sur le
     wordmark : même construction que la ligne du pied, où elle vivait avant.
     La marge est portée par la rangée et non par le `<p>` — sur un élément de
     flex elle décalerait le texte à l'intérieur de la rangée, et la bascule se
     centrerait sur une hauteur qui inclut le vide. */
  .h-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.7rem;
  }

  .sub {
    margin: 0;
    min-width: 0;
  }


  /* --- corps --- */
  /* La rangée est en 1fr et non en auto : elle doit occuper toute la place
     laissée par l'en-tête et le pied, pas se dimensionner sur son contenu.
     Le minmax(0, …) lui permet de descendre sous la taille du contenu, sinon
     le rack pousserait au lieu de défiler. */
  main {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 576px) minmax(300px, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 1.6rem;
  }

  .col-preview {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    min-height: 0;
  }


  .scale {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 1.4rem;
    flex-wrap: wrap;
  }

  .empty {
    flex: none;
    margin: 0;
    border: 1px solid var(--line);
    padding: 0.7rem 0.75rem;
    line-height: 1.7;
    text-transform: none;
    letter-spacing: 0.04em;
  }

  .empty b {
    color: var(--ink);
    font-weight: 500;
  }

  /* Le seul élément qui défile. Le fondu est un masque et non un aplat posé
     par-dessus : la trame de points reste visible dans la bande, comme sur le
     bas de la photo du téléphone. Les bornes viennent du script — à 0 le
     dégradé est plat et n'enlève rien. */
  .rack {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
    overflow-y: auto;
    /* gouttière réservée en permanence : sans ça l'apparition du curseur de
       dither décale toute la colonne d'une largeur d'ascenseur */
    scrollbar-gutter: stable;
    padding-right: 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: var(--line-strong) transparent;
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 var(--fade-t, 0px),
      #000 calc(100% - var(--fade-b, 0px)),
      transparent 100%
    );
    mask-image: linear-gradient(
      to bottom,
      transparent 0,
      #000 var(--fade-t, 0px),
      #000 calc(100% - var(--fade-b, 0px)),
      transparent 100%
    );
  }

  /* --- dépôt de fichier --- */
  /* `relative` obligatoire : l'input caché est en absolu, et sans bloc
     conteneur ici il se cale sur `.page`. Voir la note sur `.filebtn input`. */
  .drop {
    position: relative;
    display: block;
    border: 1px solid var(--line-strong);
    padding: 0.9rem 0.75rem;
    cursor: pointer;
    transition: background 0.12s;
  }

  .drop:hover,
  .drop.armed {
    background: var(--hover);
    border-color: var(--accent);
  }

  .drop input {
    position: absolute;
    inset: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .drop-t {
    display: block;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--ink);
    overflow-wrap: anywhere;
  }

  .drop-s {
    display: block;
    margin-top: 0.35rem;
  }

  .drop:has(input:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }

  /* --- boutons --- */
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .btns button,
  .filebtn {
    position: relative;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--dim);
    border-radius: 0;
    padding: 0.34rem 0.6rem;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }

  .btns button:not(:disabled):hover,
  .filebtn:hover {
    color: var(--ink);
    border-color: var(--ink);
  }

  .btns button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btns button.on {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }

  /* L'input reste focusable — c'est ce qui rend le label utilisable au clavier
     — donc il doit rester DANS le label. Sans `position: relative` sur celui-ci
     il se calait sur `.page`, à sa position statique, c'est-à-dire sans tenir
     compte du défilement interne du rack : à mi-course il atterrissait mille
     pixels sous son libellé. Cliquer le label le focalisait, le navigateur
     faisait défiler `.page` pour l'amener à l'écran — et `.page` est en
     `overflow: hidden`, donc sans ascenseur pour revenir. L'en-tête partait à
     −665 px et la mise en page ne se remettait jamais droite. */
  .filebtn input {
    position: absolute;
    inset: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .filebtn:has(input:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }

  /* --- notes et code --- */
  .note {
    margin: 0;
    font-size: 11px;
    line-height: 1.65;
    color: var(--dim);
  }

  .code {
    margin: 0;
    border: 1px solid var(--line);
    padding: 0.6rem;
    font-size: 10px;
    line-height: 1.5;
    color: var(--dim);
    max-height: 190px;
    overflow: auto;
    white-space: pre;
  }

  /* --- pied --- */
  footer {
    flex: none;
    margin-top: 1.6rem;
    border-top: 1px solid var(--line);
    padding: 1rem 0 1.2rem;
  }

  .f-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .f-row .meta {
    flex: 1 1 320px;
    text-transform: none;
    letter-spacing: 0.04em;
    line-height: 1.6;
  }

  /* Même signature que redsunshome, même lien : c'est la même main. */
  .sig {
    flex: none;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--faint);
    white-space: nowrap;
    transition: color 0.12s;
  }

  .sig:hover,
  .sig:focus-visible {
    color: var(--ink);
  }

  .notice {
    margin: 0.7rem 0 0;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  /* En colonne unique il n'y a plus la place pour deux zones fixes : la page
     redevient défilante et c'est la préview, réduite à la bande qui porte le
     disque, qui s'épingle en haut de l'écran. Régler un curseur sans voir la
     matrice n'aurait aucun intérêt. */
  @media (max-width: 980px) {
    .page {
      height: auto;
      overflow: visible;
      padding: 0 1.2rem 2.5rem;
    }

    /* L'en-tête défile : collant il ferait 160 px volés à la bande de préview,
       qui est la seule chose qui doit rester à l'écran. */
    header {
      padding-top: 1.2rem;
    }

    main {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
    }

    .col-preview {
      position: sticky;
      top: 0;
      z-index: 3;
      /* opaque et refermée par un filet : le rack passe dessous, la trame de
         fond ne doit pas transparaître à travers */
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      /* un peu d'air en haut : épinglée, la bande toucherait sinon le bord de
         l'écran */
      padding: 0.6rem 0 0.8rem;
      gap: 0.7rem;
    }

    .rack {
      overflow: visible;
      padding-right: 0;
      scrollbar-gutter: auto;
      -webkit-mask-image: none;
      mask-image: none;
    }
  }
</style>
