import { renderPage, getImage } from "./render.js";
import { makeDoc, makeLayer, uid } from "./templates.js";
import { S, page, selected, on, requestDraw, refresh, commit, undo, redo, loadDoc, addAsset, readAsDataUrl, pickFile, toast } from "./state.js";
import { renderPages, renderLayers, renderProps, renderTheme, syncGeometry } from "./panels.js";
import * as dialogs from "./dialogs.js";
import * as comfy from "./comfy.js";

const canvas = document.getElementById("stage");
const wrap = document.getElementById("stage-wrap");
const ctx = canvas.getContext("2d");
const HANDLE = 6;

// ---------- drawing ----------

let drawQueued = false;
let guides = [];

on("draw", () => {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawStage(); });
});

let checker;
function checkerPattern() {
  if (!checker) {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d");
    g.fillStyle = "#2a2a35"; g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#1f1f28"; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    checker = ctx.createPattern(c, "repeat");
  }
  return checker;
}

function layerCorners(l) {
  const a = l.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = sx * l.w / 2, y = sy * l.h / 2;
    return toScreen(cx + x * c - y * s, cy + x * s + y * c);
  });
}

const toScreen = (x, y) => [x * S.view.zoom + S.view.panX, y * S.view.zoom + S.view.panY];
const toPage = (x, y) => [(x - S.view.panX) / S.view.zoom, (y - S.view.panY) / S.view.zoom];

function handles(l) {
  const a = l.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  const out = [];
  for (const hx of [-1, 0, 1]) for (const hy of [-1, 0, 1]) {
    if (!hx && !hy) continue;
    const x = hx * l.w / 2, y = hy * l.h / 2;
    out.push({ hx, hy, pos: toScreen(cx + x * c - y * s, cy + x * s + y * c) });
  }
  const ry = -l.h / 2 - 28 / S.view.zoom;
  out.push({ rotate: true, pos: toScreen(cx - ry * s, cy + ry * c) });
  return out;
}

function drawStage() {
  const dpr = devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const p = page();
  const z = S.view.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = checkerPattern();
  ctx.fillRect(S.view.panX, S.view.panY, p.width * z, p.height * z);

  ctx.save();
  ctx.beginPath();
  ctx.rect(S.view.panX, S.view.panY, p.width * z, p.height * z);
  ctx.clip();
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * S.view.panX, dpr * S.view.panY);
  renderPage(ctx, p, S.doc, S.time, dpr * z, requestDraw);
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.strokeRect(S.view.panX - 0.5, S.view.panY - 0.5, p.width * z + 1, p.height * z + 1);

  ctx.strokeStyle = "#22d3ee";
  ctx.setLineDash([4, 4]);
  for (const g of guides) {
    ctx.beginPath();
    if (g.x !== undefined) { const [x] = toScreen(g.x, 0); ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    else { const [, y] = toScreen(0, g.y); ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const l = selected();
  if (l && S.time === null) {
    const pts = layerCorners(l);
    ctx.strokeStyle = l.locked ? "#f43f5e" : "#8b5cf6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    if (!l.locked) {
      for (const hd of handles(l)) {
        ctx.beginPath();
        if (hd.rotate) ctx.arc(hd.pos[0], hd.pos[1], HANDLE, 0, Math.PI * 2);
        else ctx.rect(hd.pos[0] - HANDLE / 1.3, hd.pos[1] - HANDLE / 1.3, HANDLE * 1.5, HANDLE * 1.5);
        ctx.fillStyle = hd.rotate ? "#22d3ee" : "#ffffff";
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  document.getElementById("zoom-label").textContent = `${Math.round(z * 100)}%`;
}

function fit() {
  const p = page();
  const w = wrap.clientWidth, h = wrap.clientHeight;
  S.view.zoom = Math.min((w - 60) / p.width, (h - 60) / p.height);
  S.view.panX = (w - p.width * S.view.zoom) / 2;
  S.view.panY = (h - p.height * S.view.zoom) / 2;
  requestDraw();
}

function zoomAt(factor, sx, sy) {
  const z = Math.min(16, Math.max(0.05, S.view.zoom * factor));
  const [px, py] = toPage(sx, sy);
  S.view.zoom = z;
  S.view.panX = sx - px * z;
  S.view.panY = sy - py * z;
  requestDraw();
}

// ---------- pointer interaction ----------

function hitTest(px, py) {
  const layers = page().layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible || l.locked) continue;
    const a = -l.rotation * Math.PI / 180;
    const dx = px - (l.x + l.w / 2), dy = py - (l.y + l.h / 2);
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2) return l;
  }
  return null;
}

// Snaps the moving box edges/center to the page and the other layers.
function snap(l, x, y) {
  const p = page();
  const tol = 6 / S.view.zoom;
  const xs = [0, p.width / 2, p.width], ys = [0, p.height / 2, p.height];
  for (const o of p.layers) {
    if (o === l || !o.visible || o.rotation) continue;
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  guides = [];
  const best = (pos, size, targets, axis) => {
    let out = pos, bestD = tol;
    for (const off of [0, size / 2, size]) {
      for (const t of targets) {
        const d = Math.abs(pos + off - t);
        if (d < bestD) { bestD = d; out = t - off; guides = guides.filter((g) => g[axis] === undefined).concat({ [axis]: t }); }
      }
    }
    return out;
  };
  return [best(x, l.w, xs, "x"), best(y, l.h, ys, "y")];
}

let drag = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const [px, py] = toPage(sx, sy);
  stopPlayback();
  if (S.time !== null) { S.time = null; updateTime(); }

  if (e.button === 1 || e.altKey || spaceDown) {
    spacePanned = spaceDown;
    drag = { mode: "pan", sx, sy, panX: S.view.panX, panY: S.view.panY };
    return;
  }
  const l = selected();
  if (l && !l.locked) {
    const hd = handles(l).find((hd) => Math.hypot(hd.pos[0] - sx, hd.pos[1] - sy) <= HANDLE + 3);
    if (hd) {
      drag = { mode: hd.rotate ? "rotate" : "resize", hd, start: { ...l }, l };
      return;
    }
  }
  const hit = hitTest(px, py);
  if (hit) {
    if (hit.id !== S.selId) { S.selId = hit.id; refresh(); }
    drag = { mode: "move", px, py, start: { x: hit.x, y: hit.y }, l: hit };
  } else {
    if (S.selId) { S.selId = null; refresh(); }
    drag = { mode: "pan", sx, sy, panX: S.view.panX, panY: S.view.panY };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const [px, py] = toPage(sx, sy);
  const l = drag.l;
  if (drag.mode === "pan") {
    S.view.panX = drag.panX + sx - drag.sx;
    S.view.panY = drag.panY + sy - drag.sy;
  } else if (drag.mode === "move") {
    let x = Math.round(drag.start.x + px - drag.px), y = Math.round(drag.start.y + py - drag.py);
    if (!e.ctrlKey) [x, y] = snap(l, x, y);
    l.x = Math.round(x);
    l.y = Math.round(y);
    drag.moved = true;
  } else if (drag.mode === "rotate") {
    let ang = Math.atan2(py - (l.y + l.h / 2), px - (l.x + l.w / 2)) * 180 / Math.PI + 90;
    if (e.shiftKey) ang = Math.round(ang / 15) * 15;
    l.rotation = Math.round(((ang % 360) + 540) % 360 - 180);
    drag.moved = true;
  } else if (drag.mode === "resize") {
    resize(drag, px, py, e.shiftKey || l.type === "image");
    drag.moved = true;
  }
  syncGeometry();
  requestDraw();
});

function resize(drag, px, py, keepAspect) {
  const { hd, start: s, l } = drag;
  const a = s.rotation * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  // Work in the layer's unrotated frame, anchored at the opposite handle.
  const mx = (px - cx) * c + (py - cy) * sn, my = -(px - cx) * sn + (py - cy) * c;
  const fx = -hd.hx * s.w / 2, fy = -hd.hy * s.h / 2;
  let w = hd.hx ? Math.max(4, (mx - fx) * hd.hx) : s.w;
  let h = hd.hy ? Math.max(4, (my - fy) * hd.hy) : s.h;
  if (keepAspect && hd.hx && hd.hy) {
    const k = Math.max(w / s.w, h / s.h);
    w = s.w * k;
    h = s.h * k;
  }
  const ncx = hd.hx ? fx + hd.hx * w / 2 : 0, ncy = hd.hy ? fy + hd.hy * h / 2 : 0;
  const wx = cx + ncx * c - ncy * sn, wy = cy + ncx * sn + ncy * c;
  l.w = Math.round(w);
  l.h = Math.round(h);
  l.x = Math.round(wx - w / 2);
  l.y = Math.round(wy - h / 2);
  if (l.type === "text" && hd.hx && hd.hy && keepAspect) l.fontSize = Math.max(4, Math.round(s.fontSize * w / s.w));
}

canvas.addEventListener("pointerup", () => {
  if (drag?.moved) { commit(); renderPages(); }
  drag = null;
  guides = [];
  requestDraw();
});

canvas.addEventListener("dblclick", () => {
  const ta = document.getElementById("text-input");
  if (ta) { ta.focus(); ta.select(); }
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

// ---------- timeline ----------

let raf = null;
let playStart = 0;
const scrub = document.getElementById("scrub");

function updateTime() {
  const p = page();
  document.getElementById("time").textContent = S.time === null ? "estático" : `${S.time.toFixed(2)}s`;
  scrub.value = S.time === null ? 0 : Math.round(S.time / p.duration * 1000);
  document.getElementById("play").textContent = S.playing ? "⏸" : "▶";
  requestDraw();
}

function stopPlayback() {
  if (!S.playing) return;
  S.playing = false;
  cancelAnimationFrame(raf);
  updateTime();
}

function togglePlay() {
  if (S.playing) return stopPlayback();
  S.playing = true;
  playStart = performance.now() - (S.time || 0) * 1000;
  const tick = (now) => {
    S.time = ((now - playStart) / 1000) % page().duration;
    updateTime();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

document.getElementById("play").onclick = togglePlay;
scrub.oninput = () => {
  stopPlayback();
  S.time = scrub.value / 1000 * page().duration;
  updateTime();
};
const durationInput = document.getElementById("duration");
const fpsInput = document.getElementById("fps");
durationInput.onchange = () => { page().duration = Math.max(0.5, +durationInput.value || 3); commit(); };
fpsInput.onchange = () => { page().fps = +fpsInput.value; commit(); };

// ---------- editing commands ----------

let clipboard = null;

function addLayer(type) {
  const p = page();
  const sizes = { text: [600, 120], frame: [480, 300], particles: [p.width, p.height] };
  const [w, h] = sizes[type] || [260, 260];
  const l = makeLayer(type, { w, h, x: Math.round((p.width - w) / 2), y: Math.round((p.height - h) / 2) });
  p.layers.push(l);
  S.selId = l.id;
  commit();
  refresh();
}

async function addImageFromBlob(blob) {
  const src = await readAsDataUrl(blob);
  const img = new Image();
  img.src = src;
  await img.decode();
  dialogs.addImageLayer(addAsset(src), img);
  commit();
  refresh();
}

function duplicateSelected() {
  const l = selected();
  if (!l) return;
  const copy = { ...structuredClone(l), id: uid(), name: l.name + " (cópia)", x: l.x + 20, y: l.y + 20 };
  const layers = page().layers;
  layers.splice(layers.indexOf(l) + 1, 0, copy);
  S.selId = copy.id;
  commit();
  refresh();
}

function deleteSelected() {
  const l = selected();
  if (!l) return;
  page().layers.splice(page().layers.indexOf(l), 1);
  S.selId = null;
  commit();
  refresh();
}

document.addEventListener("duplicate", duplicateSelected);
document.addEventListener("delete", deleteSelected);
document.addEventListener("fit", () => requestAnimationFrame(fit));
document.addEventListener("cartoon", () => dialogs.cartoonDialog());

let spaceDown = false;
let spacePanned = false;
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.getElementById("dialog").open;

document.addEventListener("keydown", (e) => {
  if (typing()) return;
  const mod = e.ctrlKey || e.metaKey;
  const l = selected();
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
  else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); }
  else if (mod && e.key.toLowerCase() === "c" && l) { clipboard = structuredClone(l); }
  else if (mod && e.key.toLowerCase() === "v" && clipboard) {
    const copy = { ...structuredClone(clipboard), id: uid() };
    page().layers.push(copy);
    S.selId = copy.id;
    commit();
    refresh();
  } else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  else if ((e.key === "Delete" || e.key === "Backspace") && l) { e.preventDefault(); deleteSelected(); }
  else if (e.key.startsWith("Arrow") && l && !l.locked) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") l.x -= d;
    if (e.key === "ArrowRight") l.x += d;
    if (e.key === "ArrowUp") l.y -= d;
    if (e.key === "ArrowDown") l.y += d;
    syncGeometry();
    requestDraw();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { commit(); renderPages(); }, 400);
  } else if (e.key === " ") { e.preventDefault(); if (!e.repeat) { spaceDown = true; } }
  else if (e.key === "Escape") { S.selId = null; refresh(); }
});
let nudgeTimer;
document.addEventListener("keyup", (e) => {
  if (e.key === " " && !typing()) {
    // A short tap toggles playback, holding it pans.
    if (spaceDown && !spacePanned) togglePlay();
    spaceDown = false;
    spacePanned = false;
  }
});

document.addEventListener("paste", (e) => {
  if (typing()) return;
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
  if (file) addImageFromBlob(file);
});
wrap.addEventListener("dragover", (e) => e.preventDefault());
wrap.addEventListener("drop", (e) => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) if (f.type.startsWith("image/")) addImageFromBlob(f);
});

// ---------- persistence ----------

let saveTimer;
async function save() {
  clearTimeout(saveTimer);
  if (await dialogs.saveProject()) toast(`Salvo em user/…/${dialogs.projectPath()}`);
}
on("commit", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => dialogs.saveProject(), 2000);
});

// ---------- wiring ----------

const packName = document.getElementById("pack-name");
packName.onchange = () => { S.doc.name = packName.value.trim() || "Meu Pack"; commit(); };

on("refresh", () => {
  packName.value = S.doc.name;
  durationInput.value = page().duration;
  fpsInput.value = String(page().fps);
  renderPages();
  renderLayers();
  renderProps();
  renderTheme();
  updateTime();
});

const actions = {
  new: dialogs.newPackDialog,
  open: dialogs.openDialog,
  save,
  import: dialogs.importProject,
  "download-project": dialogs.downloadProject,
  undo,
  redo,
  cartoon: dialogs.cartoonDialog,
  "export-png": dialogs.exportPng,
  "export-zip": dialogs.exportZip,
  "export-video": dialogs.videoDialog,
  "add-page": dialogs.addPageDialog,
  "zoom-in": () => zoomAt(1.25, wrap.clientWidth / 2, wrap.clientHeight / 2),
  "zoom-out": () => zoomAt(0.8, wrap.clientWidth / 2, wrap.clientHeight / 2),
  "zoom-fit": fit,
};
document.querySelectorAll("[data-action]").forEach((b) => { b.onclick = () => actions[b.dataset.action](); });
document.querySelectorAll("[data-add]").forEach((b) => {
  b.onclick = async () => {
    if (b.dataset.add !== "image") return addLayer(b.dataset.add);
    const file = await pickFile("image/*");
    if (file) addImageFromBlob(file);
  };
});
document.querySelectorAll("[data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.getElementById("props").classList.toggle("hidden", b.dataset.tab !== "props");
    document.getElementById("theme").classList.toggle("hidden", b.dataset.tab !== "theme");
  };
});
new ResizeObserver(() => requestDraw()).observe(wrap);

async function start() {
  let doc = null;
  try {
    const last = localStorage.getItem("streamer_pack:last");
    if (last) doc = await comfy.loadUserData(last);
  } catch {}
  loadDoc(doc || makeDoc());
  fit();
  const stats = await comfy.serverStatus();
  const el = document.getElementById("server-status");
  el.textContent = stats ? `ComfyUI ${stats.system?.comfyui_version || ""} conectado` : "ComfyUI offline — cartoon e vídeo indisponíveis";
  el.classList.toggle("ok", !!stats);
  for (const id of Object.keys(S.doc.assets)) getImage(S.doc, id, requestDraw);
}

start();
