import { normalizeLayer, uid } from "./templates.js";

export const S = {
  doc: null,
  pageIdx: 0,
  selId: null,
  time: null, // null = static layout, otherwise preview time in seconds
  playing: false,
  view: { zoom: 1, panX: 0, panY: 0 },
};

export const page = () => S.doc.pages[S.pageIdx];
export const selected = () => page().layers.find((l) => l.id === S.selId) || null;

const listeners = {};
export const on = (evt, fn) => (listeners[evt] ||= []).push(fn);
const emit = (evt) => (listeners[evt] || []).forEach((fn) => fn());

export const requestDraw = () => emit("draw");
// Rebuild side panels (layers, pages, properties) and redraw.
export const refresh = () => { emit("refresh"); emit("draw"); };

// ---------- history ----------
// Assets live outside the snapshots: they are only ever added, so undo never
// needs to bring an image back.

let past = [];
let future = [];
let last = null;

const snapshot = () => JSON.stringify({ name: S.doc.name, theme: S.doc.theme, fonts: S.doc.fonts, pages: S.doc.pages, pageIdx: S.pageIdx });

export function resetHistory() {
  past = [];
  future = [];
  last = snapshot();
}

export function commit() {
  const snap = snapshot();
  if (snap === last) return;
  past.push(last);
  if (past.length > 200) past.shift();
  future = [];
  last = snap;
  emit("commit");
}

function restore(snap) {
  const data = JSON.parse(snap);
  Object.assign(S.doc, { name: data.name, theme: data.theme, fonts: data.fonts, pages: data.pages });
  S.pageIdx = Math.min(data.pageIdx, S.doc.pages.length - 1);
  if (!selected()) S.selId = null;
  last = snap;
  refresh();
  emit("commit");
}

export function undo() {
  if (past.length) {
    future.push(last);
    restore(past.pop());
  }
}

export function redo() {
  if (future.length) {
    past.push(last);
    restore(future.pop());
  }
}

// ---------- helpers ----------

export function loadDoc(doc) {
  for (const p of doc.pages) p.layers = p.layers.map(normalizeLayer);
  doc.fonts ||= [];
  doc.assets ||= {};
  S.doc = doc;
  S.pageIdx = 0;
  S.selId = null;
  S.time = null;
  for (const f of doc.fonts) loadFont(f);
  resetHistory();
  emit("loaded");
  refresh();
}

export function loadFont(font) {
  const src = S.doc.assets[font.asset];
  if (!src) return;
  new FontFace(font.family, `url(${src})`).load().then((face) => {
    document.fonts.add(face);
    requestDraw();
  }).catch(() => toast(`Não foi possível carregar a fonte ${font.family}`, true));
}

export function addAsset(dataUrl) {
  const id = uid();
  S.doc.assets[id] = dataUrl;
  return id;
}

export const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

export const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "pack";

// Project data with only the assets that are still referenced.
export function serializeDoc() {
  const used = new Set(S.doc.fonts.map((f) => f.asset));
  for (const p of S.doc.pages) for (const l of p.layers) if (l.asset) used.add(l.asset);
  const assets = Object.fromEntries(Object.entries(S.doc.assets).filter(([id]) => used.has(id)));
  return JSON.stringify({ ...S.doc, assets });
}

let toastTimer;
export function toast(msg, error = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = error ? "toast error" : "toast";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), error ? 7000 : 2500);
}

export function pickFile(accept) {
  const input = document.getElementById("file-input");
  input.accept = accept;
  input.value = "";
  return new Promise((resolve) => {
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}
