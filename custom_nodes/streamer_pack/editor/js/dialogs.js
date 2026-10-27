// Modal flows: new pack, open, add page, photo → cartoon and exports.

import { getImage, preloadImages, renderToCanvas } from "./render.js";
import { PACK_PAGES, PAGE_PRESETS, THEMES, makeDoc, makeLayer, makePage } from "./templates.js";
import { S, page, selected, commit, refresh, loadDoc, addAsset, readAsDataUrl, pickFile, slug, serializeDoc, toast } from "./state.js";
import * as comfy from "./comfy.js";

const dialog = document.getElementById("dialog");
const body = document.getElementById("dialog-body");

function open(html) {
  body.innerHTML = html;
  dialog.showModal();
  return (sel) => body.querySelector(sel);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const options = (obj, selectedKey) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === selectedKey ? "selected" : ""}>${esc(v)}</option>`).join("");
const canvasBlob = (canvas) => new Promise((r) => canvas.toBlob(r, "image/png"));

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export const projectPath = () => `streamer_pack/${slug(S.doc.name)}.json`;

// ---------- project ----------

export function newPackDialog() {
  const $ = open(`
    <h2>Novo pack</h2>
    <div class="row"><label>Nome</label><div class="ctl"><input id="np-name" value="Meu Pack"></div></div>
    <div class="row"><label>Tema</label><div class="ctl"><select id="np-theme">${options(Object.fromEntries(Object.keys(THEMES).map((k) => [k, k])))}</select></div></div>
    <div class="hint">Telas incluídas:</div>
    <div class="preset-grid">${Object.entries(PAGE_PRESETS).map(([k, p]) => `<label><input type="checkbox" value="${k}" ${PACK_PAGES.includes(k) ? "checked" : ""}>${esc(p.label)}</label>`).join("")}</div>
    <div class="actions"><button value="cancel">Cancelar</button><button id="np-ok" class="accent" value="ok">Criar</button></div>`);
  $("#np-ok").onclick = () => {
    const pages = [...body.querySelectorAll(".preset-grid input:checked")].map((i) => i.value);
    const doc = makeDoc($("#np-theme").value, pages.length ? pages : ["blank"]);
    doc.name = $("#np-name").value.trim() || "Meu Pack";
    loadDoc(doc);
    document.dispatchEvent(new Event("fit"));
  };
}

export function addPageDialog() {
  const $ = open(`
    <h2>Adicionar tela</h2>
    <select id="ap-preset" size="12">${options(Object.fromEntries(Object.entries(PAGE_PRESETS).map(([k, p]) => [k, p.label])), "starting")}</select>
    <div class="actions"><button value="cancel">Cancelar</button><button id="ap-ok" class="accent" value="ok">Adicionar</button></div>`);
  $("#ap-ok").onclick = () => {
    S.doc.pages.push(makePage($("#ap-preset").value));
    S.pageIdx = S.doc.pages.length - 1;
    S.selId = null;
    commit();
    refresh();
    document.dispatchEvent(new Event("fit"));
  };
}

export async function saveProject() {
  try {
    await comfy.saveUserData(projectPath(), serializeDoc());
    try { localStorage.setItem("streamer_pack:last", projectPath()); } catch {}
    return true;
  } catch (e) {
    toast(`Não foi possível salvar no ComfyUI: ${e.message}`, true);
    return false;
  }
}

export async function openDialog() {
  const files = (await comfy.listUserData("streamer_pack")).filter((f) => f.endsWith(".json"));
  const $ = open(`
    <h2>Abrir pack</h2>
    ${files.length ? `<select id="op-file" size="10">${options(Object.fromEntries(files.map((f) => [f, f.replace(/\.json$/, "")])), files[0])}</select>` : `<div class="hint">Nenhum pack salvo em user/default/streamer_pack ainda.</div>`}
    <div class="actions"><button value="cancel">Cancelar</button>${files.length ? `<button id="op-ok" class="accent" value="ok">Abrir</button>` : ""}</div>`);
  if (!files.length) return;
  $("#op-ok").onclick = async () => {
    const path = `streamer_pack/${$("#op-file").value}`;
    loadDoc(await comfy.loadUserData(path));
    try { localStorage.setItem("streamer_pack:last", path); } catch {}
    document.dispatchEvent(new Event("fit"));
  };
}

export async function importProject() {
  const file = await pickFile(".json,application/json");
  if (!file) return;
  try {
    loadDoc(JSON.parse(await file.text()));
    document.dispatchEvent(new Event("fit"));
  } catch (e) {
    toast(`Arquivo inválido: ${e.message}`, true);
  }
}

export function downloadProject() {
  download(new Blob([serializeDoc()], { type: "application/json" }), `${slug(S.doc.name)}.json`);
}

// ---------- PNG / zip ----------

export async function exportPng() {
  await preloadImages(S.doc);
  const p = page();
  download(await canvasBlob(renderToCanvas(p, S.doc, S.time)), `${slug(S.doc.name)}_${slug(p.name)}.png`);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Minimal store-only zip (PNGs are already compressed).
function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const n = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, n.length, true);
    parts.push(local, n, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, n.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export async function exportZip() {
  await preloadImages(S.doc);
  const files = [];
  const used = new Set();
  for (const p of S.doc.pages) {
    let name = slug(p.name);
    while (used.has(name)) name += "_";
    used.add(name);
    const blob = await canvasBlob(renderToCanvas(p, S.doc, null));
    files.push({ name: `${name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  files.push({ name: `${slug(S.doc.name)}.json`, data: new TextEncoder().encode(serializeDoc()) });
  download(makeZip(files), `${slug(S.doc.name)}.zip`);
  toast(`${S.doc.pages.length} telas exportadas em PNG`);
}

// ---------- video ----------

export function videoDialog() {
  const p = page();
  const $ = open(`
    <h2>Exportar animação</h2>
    <div class="row"><label>Tela</label><div class="ctl"><select id="vd-page">${options(Object.fromEntries(S.doc.pages.map((x, i) => [String(i), x.name])), String(S.pageIdx))}</select></div></div>
    <div class="row"><label>Formato</label><div class="ctl"><select id="vd-format">${options(Object.fromEntries(Object.entries(comfy.VIDEO_FORMATS).map(([k, f]) => [k, f.label])), "webm")}</select></div></div>
    <div class="row"><label>Escala</label><div class="ctl"><select id="vd-scale">${options({ 1: "100%", 0.75: "75%", 0.5: "50%" }, "1")}</select></div></div>
    <div class="row"><label>Fundo (MP4)</label><div class="ctl"><input id="vd-matte" type="color" value="#000000"><span class="hint">usado onde a tela é transparente</span></div></div>
    <div class="hint">Duração e fps vêm da tela (linha do tempo). O vídeo é codificado pelo ComfyUI e salvo em output/streamer_pack.</div>
    <div class="progress"><div id="vd-bar"></div></div>
    <div id="vd-status" class="hint"></div>
    <div id="vd-result"></div>
    <div class="actions"><button value="cancel">Fechar</button><button id="vd-ok" class="accent" type="button">Renderizar</button></div>`);
  $("#vd-page").value = String(S.pageIdx);
  $("#vd-ok").onclick = async () => {
    const target = S.doc.pages[+$("#vd-page").value] || p;
    const format = $("#vd-format").value;
    const scale = +$("#vd-scale").value;
    const bar = $("#vd-bar");
    const status = $("#vd-status");
    $("#vd-ok").disabled = true;
    try {
      await preloadImages(S.doc);
      const frames = Math.max(1, Math.round(target.duration * target.fps));
      const folder = `streamer_pack/frames_${slug(target.name)}_${Date.now().toString(36)}`;
      const matte = comfy.VIDEO_FORMATS[format].alpha ? null : $("#vd-matte").value;
      let sent = 0;
      const uploadFrame = async (i) => {
        const canvas = renderToCanvas(matte ? { ...target, background: target.background || matte } : target, S.doc, i / target.fps, scale);
        // Even dimensions keep yuv420 encoders happy.
        const out = document.createElement("canvas");
        out.width = canvas.width & ~1;
        out.height = canvas.height & ~1;
        out.getContext("2d").drawImage(canvas, 0, 0);
        await comfy.uploadImage(await canvasBlob(out), `frame_${String(i).padStart(5, "0")}.png`, folder);
        sent++;
        bar.style.width = `${sent / frames * 60}%`;
        status.textContent = `Enviando quadros ${sent}/${frames}…`;
      };
      for (let i = 0; i < frames; i += 4) await Promise.all([...Array(Math.min(4, frames - i)).keys()].map((k) => uploadFrame(i + k)));

      status.textContent = "Codificando no ComfyUI…";
      const prefix = `streamer_pack/${slug(S.doc.name)}_${slug(target.name)}`;
      const outputs = await comfy.runPrompt(comfy.videoPrompt(folder, format, target.fps, prefix), (v) => {
        if (v !== null) bar.style.width = `${60 + v * 40}%`;
      });
      const file = comfy.firstFile(outputs, "2");
      bar.style.width = "100%";
      const url = comfy.viewUrl(file);
      const media = /\.(webm|mp4)$/i.test(file.filename) ? `<video class="result-preview" src="${url}" autoplay loop muted controls></video>` : `<img class="result-preview" src="${url}">`;
      $("#vd-result").innerHTML = `${media}<div class="btn-row"><a href="${url}" download="${esc(file.filename)}"><button type="button">⬇ Baixar ${esc(file.filename)}</button></a></div>`;
      status.textContent = `Pronto! Salvo em output/${file.subfolder}/${file.filename}`;
    } catch (e) {
      status.textContent = "";
      toast(e.message, true);
    } finally {
      $("#vd-ok").disabled = false;
    }
  };
}

// ---------- photo → cartoon ----------

export async function cartoonDialog() {
  const layer = selected()?.type === "image" ? selected() : null;
  const [ckpts, bgModels] = await Promise.all([comfy.listModels("checkpoints"), comfy.listModels("background_removal")]);
  const styles = Object.fromEntries(Object.entries(comfy.CARTOON_STYLES).map(([k, s]) => [k, s.label]));
  const $ = open(`
    <h2>✨ Cartoon a partir de foto</h2>
    <div class="hint">${layer ? `Usando a imagem da camada “${esc(layer.name)}”.` : "Nenhuma camada de imagem selecionada: escolha uma foto."}</div>
    ${layer ? "" : `<button id="ct-pick" type="button">Escolher foto…</button>`}
    <div class="row"><label>Modo</label><div class="ctl"><select id="ct-mode">
      <option value="ai" ${ckpts.length ? "selected" : "disabled"}>IA (img2img com checkpoint)${ckpts.length ? "" : " — nenhum checkpoint em models/checkpoints"}</option>
      <option value="filter" ${ckpts.length ? "" : "selected"}>Filtro cartoon (rápido, sem modelo)</option></select></div></div>
    <div id="ct-ai">
      <div class="row"><label>Checkpoint</label><div class="ctl"><select id="ct-ckpt">${options(Object.fromEntries(ckpts.map((c) => [c, c])))}</select></div></div>
      <div class="row"><label>Estilo</label><div class="ctl"><select id="ct-style">${options(styles, "anime")}</select></div></div>
      <textarea id="ct-prompt"></textarea>
      <div class="row"><label>Força</label><div class="ctl"><input id="ct-denoise" type="range" min="0.2" max="0.95" step="0.05" value="0.55"><span class="hint" id="ct-denoise-v">0.55</span></div></div>
      <div class="row"><label>Passos / CFG</label><div class="ctl"><input id="ct-steps" type="number" value="25" min="1" max="100"><input id="ct-cfg" type="number" value="6" step="0.5" min="1" max="20"></div></div>
      <div class="row"><label>Megapixels</label><div class="ctl"><input id="ct-mp" type="number" value="1" step="0.25" min="0.25" max="4"><span class="hint">1 para SDXL, 0.25–0.4 para SD1.5</span></div></div>
      <div class="row"><label>Seed</label><div class="ctl"><input id="ct-seed" type="number" value="${Math.floor(Math.random() * 1e9)}"><button id="ct-dice" type="button">🎲</button></div></div>
    </div>
    <div class="row"><label>Traço</label><div class="ctl"><input id="ct-ink" type="checkbox"><span class="hint">aplicar contorno de tinta e cores chapadas</span></div></div>
    <div class="row"><label>Remover fundo</label><div class="ctl"><select id="ct-bg">${options({ "": bgModels.length ? "Não" : "Não (nenhum modelo em models/background_removal)", ...Object.fromEntries(bgModels.map((m) => [m, m])) }, "")}</select></div></div>
    <div class="progress"><div id="ct-bar"></div></div>
    <div id="ct-status" class="hint"></div>
    <img id="ct-result" class="result-preview hidden">
    <div class="actions"><button value="cancel">Fechar</button>
      <button id="ct-new" type="button" class="hidden">Adicionar como nova camada</button>
      <button id="ct-apply" type="button" class="hidden">Substituir na camada</button>
      <button id="ct-run" class="accent" type="button">Gerar</button></div>`);

  let photo = layer ? S.doc.assets[layer.asset] : null;
  let result = null;
  const syncMode = () => {
    const ai = $("#ct-mode").value === "ai";
    $("#ct-ai").classList.toggle("hidden", !ai);
    if (!ai) $("#ct-ink").checked = true;
  };
  const syncStyle = () => { $("#ct-prompt").value = comfy.CARTOON_STYLES[$("#ct-style").value].prompt; };
  $("#ct-mode").onchange = syncMode;
  $("#ct-style").onchange = syncStyle;
  $("#ct-denoise").oninput = () => { $("#ct-denoise-v").textContent = $("#ct-denoise").value; };
  $("#ct-dice").onclick = () => { $("#ct-seed").value = Math.floor(Math.random() * 1e9); };
  if ($("#ct-pick")) {
    $("#ct-pick").onclick = async () => {
      const file = await pickFile("image/*");
      if (file) {
        photo = await readAsDataUrl(file);
        $("#ct-pick").textContent = `Foto: ${file.name}`;
      }
    };
  }
  syncMode();
  syncStyle();

  $("#ct-run").onclick = async () => {
    if (!photo) return toast("Escolha uma foto primeiro", true);
    const bar = $("#ct-bar");
    const status = $("#ct-status");
    $("#ct-run").disabled = true;
    try {
      status.textContent = "Enviando foto…";
      bar.style.width = "5%";
      const src = await comfy.uploadImage(await (await fetch(photo)).blob(), `streamer_pack_photo_${Date.now().toString(36)}.png`);
      const prompt = comfy.cartoonPrompt({
        image: src.name,
        ai: $("#ct-mode").value === "ai",
        ckpt: $("#ct-ckpt").value,
        prompt: $("#ct-prompt").value,
        negative: comfy.CARTOON_NEGATIVE,
        denoise: +$("#ct-denoise").value,
        steps: +$("#ct-steps").value,
        cfg: +$("#ct-cfg").value,
        megapixels: +$("#ct-mp").value,
        seed: +$("#ct-seed").value,
        ink: $("#ct-ink").checked,
        inkOptions: $("#ct-mode").value === "ai"
          ? { smoothing: 1, color_levels: 12, saturation: 1.1, line_strength: 0.6, line_thickness: 1, line_threshold: 0.015 }
          : { smoothing: 4, color_levels: 6, saturation: 1.2, line_strength: 0.9, line_thickness: 1, line_threshold: 0.01 },
        bgModel: $("#ct-bg").value,
      });
      status.textContent = "Gerando no ComfyUI…";
      const outputs = await comfy.runPrompt(prompt, (v, node) => {
        if (v !== null) bar.style.width = `${10 + v * 85}%`;
        if (node) status.textContent = `Executando ${node}…`;
      });
      const blob = await (await fetch(comfy.viewUrl(comfy.firstFile(outputs, "20")))).blob();
      result = await readAsDataUrl(blob);
      bar.style.width = "100%";
      status.textContent = "Pronto! Gere de novo com outra seed ou aplique no pack.";
      $("#ct-result").src = result;
      $("#ct-result").classList.remove("hidden");
      $("#ct-new").classList.remove("hidden");
      $("#ct-apply").classList.toggle("hidden", !layer);
    } catch (e) {
      status.textContent = "";
      toast(e.message, true);
    } finally {
      $("#ct-run").disabled = false;
    }
  };
  $("#ct-apply").onclick = () => {
    layer.asset = addAsset(result);
    commit();
    refresh();
    toast("Imagem substituída");
  };
  $("#ct-new").onclick = async () => {
    const asset = addAsset(result);
    const img = new Image();
    img.src = result;
    await img.decode();
    const l = addImageLayer(asset, img);
    l.name = "Cartoon";
    commit();
    refresh();
    toast("Cartoon adicionado como nova camada");
  };
}

export function addImageLayer(asset, img) {
  const p = page();
  const fit = Math.min(1, p.width * 0.6 / img.naturalWidth, p.height * 0.6 / img.naturalHeight);
  const w = Math.round(img.naturalWidth * fit);
  const h = Math.round(img.naturalHeight * fit);
  const l = makeLayer("image", { asset, w, h, x: Math.round((p.width - w) / 2), y: Math.round((p.height - h) / 2) });
  p.layers.push(l);
  S.selId = l.id;
  getImage(S.doc, asset);
  return l;
}
