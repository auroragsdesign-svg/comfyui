// Canvas renderer shared by the editor stage, thumbnails and exports.
// Everything is drawn in page pixels; `scale` is the device pixels per page pixel
// (needed because shadowBlur and shadow offsets ignore the canvas transform).

export const THEME_KEYS = ["primary", "secondary", "accent", "text", "dark", "light"];

const images = new Map();

export function getImage(doc, assetId, onload) {
  const src = doc.assets[assetId];
  if (!src) return null;
  let entry = images.get(assetId);
  if (!entry || entry.src !== src) {
    const img = new Image();
    entry = { src, img };
    img.onload = () => onload && onload();
    img.src = src;
    images.set(assetId, entry);
  }
  return entry.img.complete && entry.img.naturalWidth ? entry.img : null;
}

export async function preloadImages(doc) {
  await Promise.all(Object.keys(doc.assets).map((id) => {
    getImage(doc, id);
    return images.get(id).img.decode().catch(() => {});
  }));
}

export function resolveColor(c, theme) {
  if (typeof c === "string" && c.startsWith("@")) return theme[c.slice(1)] || "#ff00ff";
  return c;
}

function makePaint(ctx, paint, theme, w, h, angleShift) {
  if (!paint) return null;
  if (typeof paint === "string") return resolveColor(paint, theme);
  let g;
  if (paint.type === "radial") {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2);
  } else {
    const a = ((paint.angle || 0) + angleShift) * Math.PI / 180;
    const len = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    g = ctx.createLinearGradient(-Math.cos(a) * len, -Math.sin(a) * len, Math.cos(a) * len, Math.sin(a) * len);
  }
  for (const [pos, color] of paint.stops) g.addColorStop(Math.min(1, Math.max(0, pos)), resolveColor(color, theme));
  return g;
}

// ---------- animation ----------

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
const easeOutBounce = (p) => {
  if (p < 1 / 2.75) return 7.5625 * p * p;
  if (p < 2 / 2.75) return 7.5625 * (p -= 1.5 / 2.75) * p + 0.75;
  if (p < 2.5 / 2.75) return 7.5625 * (p -= 2.25 / 2.75) * p + 0.9375;
  return 7.5625 * (p -= 2.625 / 2.75) * p + 0.984375;
};

export const ENTRANCES = {
  none: "Nenhuma",
  fade: "Aparecer",
  "slide-left": "Deslizar da esquerda",
  "slide-right": "Deslizar da direita",
  "slide-up": "Subir",
  "slide-down": "Descer",
  zoom: "Zoom",
  pop: "Pop",
  drop: "Cair com quique",
  "spin-in": "Girar",
  wipe: "Revelar",
  typewriter: "Máquina de escrever",
};

export const LOOPS = {
  none: "Nenhum",
  pulse: "Pulsar",
  float: "Flutuar",
  swing: "Balançar",
  spin: "Girar",
  shake: "Tremer",
  blink: "Piscar",
  glow: "Brilho",
  hue: "Arco-íris",
  gradient: "Girar gradiente",
};

function applyEntrance(s, type, p, layer, page) {
  if (p >= 1 || type === "none") return;
  const e = easeOut(p);
  switch (type) {
    case "fade": s.alpha *= e; break;
    case "slide-left": s.dx -= (1 - e) * (layer.x + layer.w); s.alpha *= Math.min(1, p * 3); break;
    case "slide-right": s.dx += (1 - e) * (page.width - layer.x); s.alpha *= Math.min(1, p * 3); break;
    case "slide-up": s.dy += (1 - e) * (page.height - layer.y); s.alpha *= Math.min(1, p * 3); break;
    case "slide-down": s.dy -= (1 - e) * (layer.y + layer.h); s.alpha *= Math.min(1, p * 3); break;
    case "zoom": s.scale *= 0.3 + 0.7 * e; s.alpha *= e; break;
    case "pop": s.scale *= Math.max(0, easeOutBack(p)); break;
    case "drop": s.dy -= (1 - easeOutBounce(p)) * (layer.y + layer.h); break;
    case "spin-in": s.rot -= (1 - e) * 360; s.scale *= e; break;
    case "wipe": s.reveal = Math.min(s.reveal, e); s.revealMode = type; break;
    case "typewriter": s.reveal = Math.min(s.reveal, p); s.revealMode = type; break;
  }
}

export function animState(layer, page, t) {
  const s = { dx: 0, dy: 0, scale: 1, rot: 0, alpha: 1, glow: 0, hue: 0, gradShift: 0, reveal: 1, revealMode: null, time: t };
  if (t === null) return s;
  const a = layer.anim;
  if (a.in !== "none") applyEntrance(s, a.in, Math.max(0, (t - a.delay) / Math.max(a.inDur, 0.01)), layer, page);
  if (a.out !== "none") applyEntrance(s, a.out, Math.max(0, (page.duration - t) / Math.max(a.outDur, 0.01)), layer, page);

  // Loops use whole cycles per page duration so exported videos loop seamlessly.
  const turns = a.cycles * t / page.duration;
  const wave = Math.sin(turns * Math.PI * 2);
  switch (a.loop) {
    case "pulse": s.scale *= 1 + 0.06 * a.amount * wave; break;
    case "float": s.dy += 12 * a.amount * wave; break;
    case "swing": s.rot += 8 * a.amount * wave; break;
    case "spin": s.rot += 360 * turns; break;
    case "shake": s.dx += 5 * a.amount * Math.sin(turns * Math.PI * 14); s.dy += 3 * a.amount * Math.cos(turns * Math.PI * 22); break;
    case "blink": s.alpha *= 1 - 0.7 * Math.min(1, a.amount) * (0.5 + 0.5 * wave); break;
    case "glow": s.glow = 25 * a.amount * (0.5 + 0.5 * wave); break;
    case "hue": s.hue = 360 * turns; break;
    case "gradient": s.gradShift = 360 * turns; break;
  }
  return s;
}

// ---------- shapes ----------

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function polygonPath(ctx, layer) {
  const n = Math.max(3, layer.sides);
  const pts = layer.star ? n * 2 : n;
  for (let i = 0; i < pts; i++) {
    const r = layer.star && i % 2 ? layer.innerRatio : 1;
    const a = -Math.PI / 2 + i * Math.PI * 2 / pts;
    const px = Math.cos(a) * r * layer.w / 2;
    const py = Math.sin(a) * r * layer.h / 2;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function fillAndStroke(ctx, layer, env, st) {
  const fill = makePaint(ctx, layer.fill, env.theme, layer.w, layer.h, st.gradShift);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(layer.type === "frame" ? "evenodd" : "nonzero");
  }
  if (layer.strokeWidth > 0) {
    ctx.shadowColor = "transparent";
    ctx.lineWidth = layer.strokeWidth;
    ctx.lineJoin = "round";
    ctx.strokeStyle = resolveColor(layer.stroke, env.theme);
    ctx.stroke();
  }
}

function drawFrame(ctx, layer, env, st) {
  const { w, h, thickness: t, radius: r } = layer;
  const x = -w / 2, y = -h / 2;
  ctx.beginPath();
  if (layer.frameStyle === "corners") {
    const len = Math.min(layer.cornerLength, w / 2, h / 2);
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + sx * len, cy);
      ctx.lineTo(cx + sx * len, cy + sy * t);
      ctx.lineTo(cx + sx * t, cy + sy * t);
      ctx.lineTo(cx + sx * t, cy + sy * len);
      ctx.lineTo(cx, cy + sy * len);
      ctx.closePath();
    }
  } else {
    roundRectPath(ctx, x, y, w, h, r);
    roundRectPath(ctx, x + t, y + t, w - t * 2, h - t * 2, Math.max(0, r - t));
  }
  fillAndStroke(ctx, layer, env, st);
  if (layer.frameStyle === "double") {
    const gap = t + layer.innerGap;
    ctx.beginPath();
    roundRectPath(ctx, x + gap, y + gap, w - gap * 2, h - gap * 2, Math.max(0, r - gap));
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1, t / 3);
    ctx.strokeStyle = resolveColor(layer.accent, env.theme);
    ctx.stroke();
  }
}

function drawImageLayer(ctx, layer, env) {
  const { w, h } = layer;
  const img = getImage(env.doc, layer.asset, env.onImageLoad);
  ctx.beginPath();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, layer.radius);
  if (!img) {
    ctx.fillStyle = "rgba(127,127,127,0.35)";
    ctx.fill();
    return;
  }
  let dw = w, dh = h;
  const ir = img.naturalWidth / img.naturalHeight;
  if (layer.fit === "cover") (w / h > ir) ? (dh = w / ir) : (dw = h * ir);
  else if (layer.fit === "contain") (w / h > ir) ? (dw = h * ir) : (dh = w / ir);
  if (layer.radius > 0 || layer.fit === "cover") {
    if (ctx.shadowBlur > 0) {
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.shadowColor = "transparent";
    }
    ctx.save();
    ctx.clip();
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  }
  if (layer.strokeWidth > 0) {
    ctx.shadowColor = "transparent";
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = resolveColor(layer.stroke, env.theme);
    ctx.stroke();
  }
}

export function fontString(layer, theme) {
  const family = layer.fontFamily === "@font" ? theme.font : layer.fontFamily;
  return `${layer.italic ? "italic " : ""}${layer.fontWeight} ${layer.fontSize}px "${family}", sans-serif`;
}

function wrapLines(ctx, text, maxWidth, wrap) {
  const out = [];
  for (const para of text.split("\n")) {
    if (!wrap) { out.push(para); continue; }
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx, layer, env, st) {
  const { w, h } = layer;
  ctx.font = fontString(layer, env.theme);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${layer.letterSpacing}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align;
  let text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  if (st.revealMode === "typewriter") text = text.slice(0, Math.floor(text.length * st.reveal));
  const lines = wrapLines(ctx, text, w, layer.wrap);
  const lh = layer.fontSize * layer.lineHeight;
  const x = layer.align === "left" ? -w / 2 : layer.align === "right" ? w / 2 : 0;
  const y0 = -((lines.length - 1) * lh) / 2;
  const fill = makePaint(ctx, layer.fill, env.theme, w, h, st.gradShift);
  if (layer.strokeWidth > 0) {
    ctx.lineJoin = "round";
    ctx.lineWidth = layer.strokeWidth * 2;
    ctx.strokeStyle = resolveColor(layer.stroke, env.theme);
    lines.forEach((l, i) => ctx.strokeText(l, x, y0 + i * lh));
    ctx.shadowColor = "transparent";
  }
  ctx.fillStyle = fill;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * lh));
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function drawParticles(ctx, layer, env, st, page) {
  const { w, h } = layer;
  const rnd = rand(layer.seed);
  const travel = st.time === null ? 0 : layer.speed * st.time / page.duration;
  const color = makePaint(ctx, layer.fill, env.theme, w, h, st.gradShift);
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < layer.count; i++) {
    const px = rnd(), py = rnd(), sz = layer.size * (0.4 + rnd() * 0.6), phase = rnd();
    let y = layer.direction === "down" ? (py + travel) % 1 : (py - travel % 1 + 1) % 1;
    const x = (px + 0.02 * Math.sin((y + phase) * Math.PI * 4)) * w - w / 2;
    y = y * h - h / 2;
    const twinkle = 0.55 + 0.45 * Math.sin((phase + travel * 3) * Math.PI * 2);
    ctx.globalAlpha = baseAlpha * twinkle;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (layer.shape === "sparkle") {
      const r = sz, k = sz * 0.25;
      ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + k, y - k, x + r, y); ctx.quadraticCurveTo(x + k, y + k, x, y + r);
      ctx.quadraticCurveTo(x - k, y + k, x - r, y); ctx.quadraticCurveTo(x - k, y - k, x, y - r);
      ctx.fill();
    } else if (layer.shape === "ring") {
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1, sz / 4);
      ctx.strokeStyle = color;
      ctx.stroke();
    } else if (layer.shape === "square") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((phase + travel) * Math.PI * 2);
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    } else {
      ctx.arc(x, y, sz / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---------- page ----------

export function drawLayer(ctx, layer, page, env, t) {
  if (!layer.visible) return;
  const st = animState(layer, page, t);
  if (st.alpha <= 0 || st.scale <= 0) return;
  ctx.save();
  ctx.globalAlpha *= layer.opacity * st.alpha;
  ctx.globalCompositeOperation = layer.blend;
  ctx.translate(layer.x + layer.w / 2 + st.dx, layer.y + layer.h / 2 + st.dy);
  ctx.rotate((layer.rotation + st.rot) * Math.PI / 180);
  ctx.scale(st.scale * (layer.flipX ? -1 : 1), st.scale * (layer.flipY ? -1 : 1));
  if (st.hue) ctx.filter = `hue-rotate(${st.hue}deg)`;
  const sh = layer.shadow;
  if (sh.blur > 0 || sh.x || sh.y || st.glow > 0) {
    ctx.shadowColor = resolveColor(sh.color, env.theme);
    ctx.shadowBlur = (sh.blur + st.glow) * env.scale * st.scale;
    ctx.shadowOffsetX = sh.x * env.scale;
    ctx.shadowOffsetY = sh.y * env.scale;
  }
  if (st.revealMode === "wipe") {
    ctx.beginPath();
    ctx.rect(-layer.w / 2 - 50, -layer.h / 2 - 50, (layer.w + 100) * st.reveal, layer.h + 100);
    ctx.clip();
  }
  ctx.beginPath();
  switch (layer.type) {
    case "rect": roundRectPath(ctx, -layer.w / 2, -layer.h / 2, layer.w, layer.h, layer.radius); fillAndStroke(ctx, layer, env, st); break;
    case "ellipse": ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2); fillAndStroke(ctx, layer, env, st); break;
    case "polygon": polygonPath(ctx, layer); fillAndStroke(ctx, layer, env, st); break;
    case "frame": drawFrame(ctx, layer, env, st); break;
    case "image": drawImageLayer(ctx, layer, env); break;
    case "text": drawText(ctx, layer, env, st); break;
    case "particles": drawParticles(ctx, layer, env, st, page); break;
  }
  ctx.restore();
}

// t === null renders the static layout (all entrances finished, no loops).
export function renderPage(ctx, page, doc, t, scale, onImageLoad) {
  const env = { doc, theme: doc.theme, scale, onImageLoad };
  if (page.background) {
    ctx.save();
    ctx.translate(page.width / 2, page.height / 2);
    ctx.fillStyle = makePaint(ctx, page.background, doc.theme, page.width, page.height, 0);
    ctx.fillRect(-page.width / 2, -page.height / 2, page.width, page.height);
    ctx.restore();
  }
  for (const layer of page.layers) drawLayer(ctx, layer, page, env, t);
}

export function renderToCanvas(page, doc, t, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  renderPage(ctx, page, doc, t, scale);
  return canvas;
}
