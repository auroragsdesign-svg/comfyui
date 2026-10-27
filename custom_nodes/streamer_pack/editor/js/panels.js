// Side panels: page list, layer list, property editor and theme editor.

import { ENTRANCES, LOOPS, THEME_KEYS, getImage, renderToCanvas } from "./render.js";
import { THEMES, uid } from "./templates.js";
import { S, page, selected, requestDraw, refresh, commit, addAsset, readAsDataUrl, loadFont, pickFile, toast } from "./state.js";

const h = (tag, props = {}, ...children) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
};

const THEME_LABELS = { primary: "Primária", secondary: "Secundária", accent: "Destaque", text: "Texto", dark: "Escura", light: "Clara" };
const KIND_ICONS = { text: "T", rect: "▭", ellipse: "◯", polygon: "★", frame: "▢", particles: "✦", image: "🖼" };
export const FONTS = ["Arial", "Arial Black", "Impact", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS", "system-ui"];
const BLENDS = { "source-over": "Normal", multiply: "Multiplicar", screen: "Tela", overlay: "Sobrepor", lighter: "Adicionar", "color-dodge": "Subexpor", difference: "Diferença" };

// ---------- generic controls ----------
// Controls update the model live on "input" and record history on "change".

const changed = (rebuild) => { commit(); rebuild ? refresh() : requestDraw(); };

function row(label, ...controls) {
  return h("div", { className: "row" }, h("label", { textContent: label }), h("div", { className: "ctl" }, ...controls));
}

function num(obj, key, opts = {}) {
  const el = h("input", { type: "number", value: +(+obj[key]).toFixed(2), step: opts.step ?? 1 });
  if (opts.min !== undefined) el.min = opts.min;
  if (opts.max !== undefined) el.max = opts.max;
  el.oninput = () => {
    if (el.value === "") return;
    obj[key] = +el.value;
    opts.onInput?.();
    requestDraw();
  };
  el.onchange = () => changed(opts.rebuild);
  return el;
}

function range(obj, key, min, max, step) {
  const out = h("span", { className: "hint", textContent: (+obj[key]).toFixed(2) });
  const el = h("input", { type: "range", min, max, step, value: obj[key] });
  el.oninput = () => { obj[key] = +el.value; out.textContent = (+el.value).toFixed(2); requestDraw(); };
  el.onchange = () => changed();
  return [el, out];
}

function text(obj, key, rebuild = false) {
  const el = h("input", { value: obj[key] });
  el.oninput = () => { obj[key] = el.value; requestDraw(); };
  el.onchange = () => changed(rebuild);
  return el;
}

function check(obj, key, rebuild = false) {
  const el = h("input", { type: "checkbox", checked: !!obj[key] });
  el.onchange = () => { obj[key] = el.checked; changed(rebuild); };
  return el;
}

function select(obj, key, options, rebuild = false) {
  const el = h("select");
  for (const [value, label] of Object.entries(options)) el.append(h("option", { value, textContent: label, selected: String(obj[key]) === value }));
  el.onchange = () => {
    obj[key] = typeof obj[key] === "number" ? +el.value : el.value;
    changed(rebuild);
  };
  return el;
}

function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.fillStyle = c;
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : "#000000";
}

// A color is either a literal CSS color or a theme token such as "@primary".
function color(obj, key, rebuild = false) {
  const tokens = { custom: "Personalizada", ...Object.fromEntries(THEME_KEYS.map((k) => [`@${k}`, `Tema: ${THEME_LABELS[k]}`])) };
  const isToken = () => typeof obj[key] === "string" && obj[key].startsWith("@");
  const sel = h("select");
  for (const [v, l] of Object.entries(tokens)) sel.append(h("option", { value: v, textContent: l }));
  const picker = h("input", { type: "color" });
  const raw = h("input", { title: "Cor CSS, ex.: #ff0055 ou rgba(0,0,0,0.5)" });
  const sync = () => {
    sel.value = isToken() ? obj[key] : "custom";
    picker.value = toHex(isToken() ? S.doc.theme[obj[key].slice(1)] : obj[key]);
    raw.value = isToken() ? "" : obj[key];
    raw.classList.toggle("hidden", isToken());
  };
  sel.onchange = () => { obj[key] = sel.value === "custom" ? picker.value : sel.value; sync(); changed(rebuild); };
  picker.oninput = () => { obj[key] = picker.value; sync(); requestDraw(); };
  picker.onchange = () => changed(rebuild);
  raw.onchange = () => { obj[key] = raw.value; sync(); changed(rebuild); };
  sync();
  return h("div", { className: "ctl" }, sel, picker, raw);
}

// Paint = color | { type: "linear" | "radial", angle, stops: [[pos, color], ...] }
function paint(obj, key, allowNone) {
  const box = h("div", { className: "stops" });
  const kinds = { solid: "Sólida", linear: "Gradiente linear", radial: "Gradiente radial" };
  const current = () => obj[key] === null ? "none" : typeof obj[key] === "string" ? "solid" : obj[key].type;
  const kind = h("select");
  for (const [v, l] of Object.entries(allowNone ? { none: "Transparente", ...kinds } : kinds)) kind.append(h("option", { value: v, textContent: l, selected: current() === v }));
  kind.onchange = () => {
    const prev = obj[key];
    const base = typeof prev === "string" ? prev : prev?.stops?.[0]?.[1] ?? "@primary";
    if (kind.value === "none") obj[key] = null;
    else if (kind.value === "solid") obj[key] = base;
    else obj[key] = { type: kind.value, angle: prev?.angle ?? 0, stops: prev?.stops ?? [[0, base], [1, "@secondary"]] };
    build();
    changed();
  };
  const build = () => {
    box.replaceChildren();
    const p = obj[key];
    if (p === null) return;
    if (typeof p === "string") {
      box.append(row("Cor", color(obj, key)));
      return;
    }
    if (p.type === "linear") box.append(row("Ângulo", num(p, "angle", { step: 5 })));
    p.stops.forEach((stop, i) => {
      const del = h("button", { type: "button", className: "mini", textContent: "×", title: "Remover parada", disabled: p.stops.length <= 2 });
      del.onclick = () => { p.stops.splice(i, 1); build(); changed(); };
      const pos = num(stop, 0, { min: 0, max: 1, step: 0.05 });
      pos.style.maxWidth = "56px";
      box.append(h("div", { className: "row" }, pos, color(stop, 1), del));
    });
    const add = h("button", { type: "button", textContent: "+ cor" });
    add.onclick = () => { p.stops.push([1, "@accent"]); build(); changed(); };
    box.append(add);
  };
  build();
  return [row("Tipo", kind), box];
}

function fieldset(title, ...children) {
  return h("fieldset", {}, h("legend", { textContent: title }), ...children.flat());
}

function fontSelect(obj, key) {
  const families = { "@font": `Fonte do tema (${S.doc.theme.font})` };
  for (const f of [...S.doc.fonts.map((f) => f.family), ...FONTS]) families[f] = f;
  if (!(obj[key] in families)) families[obj[key]] = obj[key];
  families.__other = "Outra fonte instalada…";
  const el = select(obj, key, families);
  el.onchange = () => {
    if (el.value === "__other") {
      const name = prompt("Nome da fonte instalada no seu computador:");
      if (name) obj[key] = name.trim();
      el.value = obj[key];
    } else {
      obj[key] = el.value;
    }
    changed(true);
  };
  return el;
}

// ---------- pages ----------

export function renderPages() {
  const list = document.getElementById("pages");
  list.replaceChildren();
  S.doc.pages.forEach((p, i) => {
    const thumb = h("canvas");
    const dup = h("button", { className: "mini", textContent: "⧉", title: "Duplicar" });
    const del = h("button", { className: "mini danger", textContent: "×", title: "Excluir" });
    const item = h("div", { className: "page-item" + (i === S.pageIdx ? " active" : "") }, thumb,
      h("div", { className: "meta" }, h("b", { textContent: p.name }), h("small", { textContent: `${p.kind} · ${p.width}×${p.height}` })),
      dup, del);
    item.onclick = () => { S.pageIdx = i; S.selId = null; S.time = null; refresh(); document.dispatchEvent(new Event("fit")); };
    dup.onclick = (e) => {
      e.stopPropagation();
      const copy = structuredClone(p);
      copy.id = uid();
      copy.name += " (cópia)";
      S.doc.pages.splice(i + 1, 0, copy);
      commit();
      refresh();
    };
    del.onclick = (e) => {
      e.stopPropagation();
      if (S.doc.pages.length === 1 || !confirm(`Excluir a tela "${p.name}"?`)) return;
      S.doc.pages.splice(i, 1);
      S.pageIdx = Math.min(S.pageIdx, S.doc.pages.length - 1);
      S.selId = null;
      commit();
      refresh();
    };
    list.append(item);
    drawThumb(thumb, p);
  });
}

function drawThumb(canvas, p) {
  const scale = Math.min(144 / p.width, 84 / p.height);
  const src = renderToCanvas(p, S.doc, null, scale);
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext("2d").drawImage(src, 0, 0);
}

// ---------- layers ----------

let dragId = null;

export function renderLayers() {
  const list = document.getElementById("layers");
  list.replaceChildren();
  const layers = page().layers;
  if (!layers.length) list.append(h("div", { className: "hint", textContent: "Nenhum elemento. Use “Adicionar elemento”." }));
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const eye = h("button", { textContent: l.visible ? "👁" : "◌", title: "Mostrar/ocultar" });
    const lock = h("button", { textContent: l.locked ? "🔒" : "🔓", title: "Travar" });
    const name = h("span", { className: "name" + (l.visible ? "" : " off"), textContent: l.name });
    const item = h("div", { className: "layer-item" + (l.id === S.selId ? " active" : ""), draggable: true },
      h("span", { className: "kind", textContent: KIND_ICONS[l.type] }), name, eye, lock);
    item.onclick = () => { S.selId = l.id; refresh(); };
    name.ondblclick = () => {
      const n = prompt("Nome da camada:", l.name);
      if (n) { l.name = n; commit(); refresh(); }
    };
    eye.onclick = (e) => { e.stopPropagation(); l.visible = !l.visible; commit(); refresh(); };
    lock.onclick = (e) => { e.stopPropagation(); l.locked = !l.locked; commit(); refresh(); };
    item.ondragstart = () => { dragId = l.id; };
    item.ondragover = (e) => { e.preventDefault(); item.classList.add("drop-target"); };
    item.ondragleave = () => item.classList.remove("drop-target");
    item.ondrop = (e) => {
      e.preventDefault();
      const from = layers.findIndex((x) => x.id === dragId);
      if (from < 0 || from === i) return;
      const [moved] = layers.splice(from, 1);
      // Dropping on a row places the layer just above it.
      layers.splice(layers.indexOf(l) + 1, 0, moved);
      commit();
      refresh();
    };
    list.append(item);
  }
}

// ---------- properties ----------

export const geometryInputs = {};

export function syncGeometry() {
  const l = selected();
  if (!l) return;
  for (const [k, el] of Object.entries(geometryInputs)) if (document.activeElement !== el) el.value = +(+l[k]).toFixed(1);
}

function pageProps() {
  const p = page();
  const sizes = {
    "": "Tamanho…", "1920x1080": "Full HD 1920×1080", "1280x720": "HD 1280×720", "2560x1440": "QHD / YouTube 2560×1440",
    "1200x480": "Banner Twitch 1200×480", "320x160": "Painel Twitch 320×160", "800x800": "Quadrado 800×800", "1080x1920": "Vertical 1080×1920",
  };
  const size = h("select");
  for (const [v, l] of Object.entries(sizes)) size.append(h("option", { value: v, textContent: l }));
  size.onchange = () => {
    if (!size.value) return;
    [p.width, p.height] = size.value.split("x").map(Number);
    commit();
    refresh();
    document.dispatchEvent(new Event("fit"));
  };
  return [
    fieldset("Tela", row("Nome", text(p, "name", true)), row("Tipo", text(p, "kind", true)),
      h("div", { className: "pair" }, row("L", num(p, "width", { min: 16, max: 8192, rebuild: true })), row("A", num(p, "height", { min: 16, max: 8192, rebuild: true }))),
      row("Predefinido", size)),
    fieldset("Fundo", paint(p, "background", true), h("div", { className: "hint", textContent: "Transparente exporta PNG/vídeo com canal alfa." })),
    h("div", { className: "hint", textContent: "Clique num elemento do canvas ou da lista de camadas para editá-lo." }),
  ];
}

function layerProps(l) {
  const out = [];
  for (const k of Object.keys(geometryInputs)) delete geometryInputs[k];
  const g = (k, opts) => (geometryInputs[k] = num(l, k, opts));

  out.push(fieldset("Elemento", row("Nome", text(l, "name", true)),
    h("div", { className: "pair" }, row("X", g("x")), row("Y", g("y")), row("L", g("w", { min: 1 })), row("A", g("h", { min: 1 }))),
    row("Rotação", g("rotation", { step: 1 })),
    row("Opacidade", ...range(l, "opacity", 0, 1, 0.01)),
    row("Mesclagem", select(l, "blend", BLENDS)),
    row("Espelhar", check(l, "flipX"), h("span", { className: "hint", textContent: "horizontal" }), check(l, "flipY"), h("span", { className: "hint", textContent: "vertical" })),
  ));

  if (l.type === "text") {
    const ta = h("textarea", { id: "text-input", value: l.text });
    ta.oninput = () => { l.text = ta.value; requestDraw(); };
    ta.onchange = () => changed();
    out.push(fieldset("Texto", ta, row("Fonte", fontSelect(l, "fontFamily")),
      h("div", { className: "pair" }, row("Tam.", num(l, "fontSize", { min: 4 })), row("Peso", select(l, "fontWeight", { 400: "Normal", 600: "Semi", 700: "Negrito", 800: "Extra", 900: "Black" }))),
      row("Alinhar", select(l, "align", { left: "Esquerda", center: "Centro", right: "Direita" })),
      row("Espaçam.", num(l, "letterSpacing", { step: 0.5 })), row("Entrelinha", num(l, "lineHeight", { step: 0.05, min: 0.5 })),
      row("Opções", check(l, "uppercase"), h("span", { className: "hint", textContent: "MAIÚSC." }), check(l, "italic"), h("span", { className: "hint", textContent: "itálico" }), check(l, "wrap"), h("span", { className: "hint", textContent: "quebrar" })),
    ));
  }
  if (l.type === "image") {
    const replace = h("button", { type: "button", textContent: "Trocar imagem" });
    replace.onclick = async () => {
      const file = await pickFile("image/*");
      if (!file) return;
      l.asset = addAsset(await readAsDataUrl(file));
      commit();
      refresh();
    };
    const natural = h("button", { type: "button", textContent: "Proporção original" });
    natural.onclick = () => {
      const img = getImage(S.doc, l.asset);
      if (!img) return;
      l.h = Math.round(l.w * img.naturalHeight / img.naturalWidth);
      commit();
      refresh();
    };
    const cartoon = h("button", { type: "button", className: "accent", textContent: "✨ Cartoonizar" });
    cartoon.onclick = () => document.dispatchEvent(new Event("cartoon"));
    out.push(fieldset("Imagem", h("div", { className: "btn-row" }, replace, natural, cartoon),
      row("Ajuste", select(l, "fit", { contain: "Conter", cover: "Cobrir", stretch: "Esticar" })),
      row("Cantos", num(l, "radius", { min: 0 }))));
  }
  if (l.type === "frame") {
    out.push(fieldset("Moldura", row("Estilo", select(l, "frameStyle", { full: "Completa", double: "Dupla", corners: "Só cantos" }, true)),
      row("Espessura", num(l, "thickness", { min: 1 })), row("Cantos", num(l, "radius", { min: 0 })),
      l.frameStyle === "corners" ? row("Compr. canto", num(l, "cornerLength", { min: 4 })) : null,
      l.frameStyle === "double" ? row("Distância", num(l, "innerGap", { min: 0 })) : null,
      l.frameStyle === "double" ? row("Linha int.", color(l, "accent")) : null,
      h("div", { className: "hint", textContent: "O centro fica transparente: coloque a captura da webcam atrás no OBS." })));
  }
  if (l.type === "rect") out.push(fieldset("Forma", row("Cantos", num(l, "radius", { min: 0 }))));
  if (l.type === "polygon") {
    out.push(fieldset("Forma", row("Lados", num(l, "sides", { min: 3, max: 32 })), row("Estrela", check(l, "star", true)),
      l.star ? row("Raio interno", ...range(l, "innerRatio", 0.1, 1, 0.01)) : null));
  }
  if (l.type === "particles") {
    out.push(fieldset("Partículas", row("Formato", select(l, "shape", { sparkle: "Brilho", dot: "Bolinha", ring: "Anel", square: "Confete" })),
      row("Quantidade", num(l, "count", { min: 1, max: 1000 })), row("Tamanho", num(l, "size", { min: 1 })),
      row("Velocidade", num(l, "speed", { min: 0, max: 20, step: 1 })), row("Direção", select(l, "direction", { up: "Subindo", down: "Caindo" })),
      row("Semente", num(l, "seed")), h("div", { className: "hint", textContent: "Velocidade = voltas por ciclo da animação (inteiro para loop perfeito)." })));
  }

  if (l.type !== "image") out.push(fieldset(l.type === "frame" ? "Cor da moldura" : "Preenchimento", paint(l, "fill", false)));
  if (l.type !== "particles") out.push(fieldset("Contorno", row("Espessura", num(l, "strokeWidth", { min: 0, step: 0.5 })), row("Cor", color(l, "stroke"))));
  out.push(fieldset("Sombra / brilho", row("Cor", color(l.shadow, "color")), row("Desfoque", num(l.shadow, "blur", { min: 0 })),
    h("div", { className: "pair" }, row("X", num(l.shadow, "x")), row("Y", num(l.shadow, "y")))));

  const a = l.anim;
  out.push(fieldset("Animação",
    row("Entrada", select(a, "in", ENTRANCES)), h("div", { className: "pair" }, row("⏱", num(a, "inDur", { min: 0.05, step: 0.1 })), row("⏳", num(a, "delay", { min: 0, step: 0.1 }))),
    row("Saída", select(a, "out", ENTRANCES)), row("Duração", num(a, "outDur", { min: 0.05, step: 0.1 })),
    row("Loop", select(a, "loop", LOOPS)), h("div", { className: "pair" }, row("×", num(a, "cycles", { min: 1, max: 30 })), row("±", num(a, "amount", { min: 0, step: 0.1 }))),
    h("div", { className: "hint", textContent: "⏱ duração, ⏳ atraso (s). × ciclos do loop por animação, ± intensidade." })));

  const btn = (label, fn, cls = "") => {
    const b = h("button", { type: "button", textContent: label, className: cls });
    b.onclick = fn;
    return b;
  };
  const layers = page().layers;
  const move = (to) => () => {
    const i = layers.indexOf(l);
    layers.splice(i, 1);
    layers.splice(Math.max(0, Math.min(layers.length, to(i))), 0, l);
    commit();
    refresh();
  };
  const center = (axis) => () => {
    if (axis === "x") l.x = Math.round((page().width - l.w) / 2);
    else l.y = Math.round((page().height - l.h) / 2);
    commit();
    refresh();
  };
  out.push(fieldset("Organizar", h("div", { className: "btn-row" },
    btn("Frente", move(() => layers.length)), btn("Subir", move((i) => i + 1)), btn("Descer", move((i) => i - 1)), btn("Fundo", move(() => 0)),
    btn("Centro ↔", center("x")), btn("Centro ↕", center("y")),
    btn("Duplicar", () => document.dispatchEvent(new Event("duplicate"))), btn("Excluir", () => document.dispatchEvent(new Event("delete")), "danger"))));
  return out;
}

export function renderProps() {
  const el = document.getElementById("props");
  const l = selected();
  el.replaceChildren(...(l ? layerProps(l) : pageProps()));
}

// ---------- theme ----------

export function renderTheme() {
  const t = S.doc.theme;
  const el = document.getElementById("theme");
  const presets = h("div", { className: "btn-row" });
  for (const [name, preset] of Object.entries(THEMES)) {
    const b = h("button", { type: "button", title: name },
      h("span", { className: "theme-swatches" }, ...["primary", "secondary", "accent"].map((k) => h("span", { style: `background:${preset[k]}` }))), " " + name);
    b.onclick = () => { Object.assign(t, preset); commit(); refresh(); };
    presets.append(b);
  }
  const colors = THEME_KEYS.map((k) => {
    const picker = h("input", { type: "color", value: toHex(t[k]) });
    picker.oninput = () => { t[k] = picker.value; requestDraw(); };
    picker.onchange = () => changed(true);
    return row(THEME_LABELS[k], picker);
  });
  const fonts = {};
  for (const f of [...S.doc.fonts.map((f) => f.family), ...FONTS]) fonts[f] = f;
  if (!(t.font in fonts)) fonts[t.font] = t.font;
  const upload = h("button", { type: "button", textContent: "Enviar fonte (.ttf/.otf/.woff2)" });
  upload.onclick = async () => {
    const file = await pickFile(".ttf,.otf,.woff,.woff2");
    if (!file) return;
    const family = file.name.replace(/\.[^.]+$/, "");
    const font = { family, asset: addAsset(await readAsDataUrl(file)) };
    S.doc.fonts.push(font);
    loadFont(font);
    t.font = family;
    commit();
    refresh();
    toast(`Fonte "${family}" adicionada ao pack`);
  };
  el.replaceChildren(
    fieldset("Temas prontos", presets),
    fieldset("Cores do pack", h("div", { className: "hint", textContent: "Elementos que usam “Tema: …” mudam juntos em todas as telas." }), ...colors),
    fieldset("Fonte do pack", row("Fonte", select(t, "font", fonts, true)), upload),
  );
}
