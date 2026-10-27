// Layer factory, color themes and the page presets that make up a streamer pack.

export const uid = () => Math.random().toString(36).slice(2, 10);

const TYPE_DEFAULTS = {
  rect: { name: "Retângulo", fill: "@primary", stroke: "@light", strokeWidth: 0, radius: 0 },
  ellipse: { name: "Elipse", fill: "@secondary", stroke: "@light", strokeWidth: 0 },
  polygon: { name: "Polígono", fill: "@accent", stroke: "@light", strokeWidth: 0, sides: 5, star: true, innerRatio: 0.45 },
  frame: {
    name: "Moldura de webcam", fill: { type: "linear", angle: 0, stops: [[0, "@primary"], [1, "@secondary"]] },
    stroke: "@light", strokeWidth: 0, thickness: 12, radius: 24, frameStyle: "full", cornerLength: 80, innerGap: 8, accent: "@light",
  },
  image: { name: "Imagem", asset: null, fit: "contain", radius: 0, stroke: "@light", strokeWidth: 0, gradientMap: null },
  text: {
    name: "Texto", text: "Texto", fill: "@text", stroke: "@dark", strokeWidth: 0, fontFamily: "@font", fontSize: 64,
    fontWeight: "800", italic: false, uppercase: false, align: "center", letterSpacing: 0, lineHeight: 1.15, wrap: false,
  },
  particles: { name: "Partículas", fill: "@light", count: 60, size: 10, speed: 1, direction: "up", shape: "sparkle", seed: 7 },
};

export function makeLayer(type, props = {}) {
  return {
    id: uid(), type, x: 0, y: 0, w: 200, h: 120, rotation: 0, opacity: 1, visible: true, locked: false,
    flipX: false, flipY: false, blend: "source-over",
    shadow: { color: "rgba(0,0,0,0.6)", blur: 0, x: 0, y: 0 },
    anim: { in: "none", inDur: 0.6, delay: 0, out: "none", outDur: 0.5, loop: "none", cycles: 1, amount: 1 },
    ...structuredClone(TYPE_DEFAULTS[type]),
    ...props,
  };
}

// Fills in fields added after a project was saved.
export function normalizeLayer(layer) {
  const base = makeLayer(layer.type);
  return { ...base, ...layer, shadow: { ...base.shadow, ...layer.shadow }, anim: { ...base.anim, ...layer.anim } };
}

export const THEMES = {
  "Neon Roxo": { primary: "#8b5cf6", secondary: "#22d3ee", accent: "#f472b6", text: "#ffffff", dark: "#0f0a1f", light: "#f5f3ff", font: "Arial Black" },
  "Cyber Azul": { primary: "#2563eb", secondary: "#06b6d4", accent: "#facc15", text: "#e0f2fe", dark: "#020617", light: "#e0f2fe", font: "Impact" },
  "Pôr do Sol": { primary: "#f97316", secondary: "#ec4899", accent: "#fde047", text: "#fff7ed", dark: "#1c0a12", light: "#fff7ed", font: "Trebuchet MS" },
  "Gamer Verde": { primary: "#22c55e", secondary: "#a3e635", accent: "#f43f5e", text: "#f0fdf4", dark: "#04130a", light: "#ecfccb", font: "Verdana" },
  "Pastel Kawaii": { primary: "#f9a8d4", secondary: "#a5b4fc", accent: "#fcd34d", text: "#4c1d95", dark: "#fdf2f8", light: "#ffffff", font: "Comic Sans MS" },
  "Mono Clean": { primary: "#e5e5e5", secondary: "#737373", accent: "#ef4444", text: "#fafafa", dark: "#0a0a0a", light: "#ffffff", font: "Arial" },
};

const grad = (angle, a = "@primary", b = "@secondary") => ({ type: "linear", angle, stops: [[0, a], [1, b]] });
const title = (text, props) => makeLayer("text", { name: text, text, fontFamily: "@font", ...props });
const withAnim = (anim) => ({ ...makeLayer("rect").anim, ...anim });

function screen(headline, sub) {
  return {
    width: 1920, height: 1080, background: grad(135, "@dark", "@primary"), duration: 6,
    layers: [
      makeLayer("particles", { name: "Partículas", x: 0, y: 0, w: 1920, h: 1080, count: 90, size: 14, opacity: 0.6, speed: 1 }),
      makeLayer("ellipse", { name: "Brilho", x: 460, y: 140, w: 1000, h: 800, fill: { type: "radial", angle: 0, stops: [[0, "@secondary"], [1, "rgba(0,0,0,0)"]] }, opacity: 0.35, anim: withAnim({ loop: "pulse", amount: 1.5 }) }),
      title(headline, { x: 260, y: 380, w: 1400, h: 200, fontSize: 150, uppercase: true, fill: grad(0, "@light", "@secondary"), shadow: { color: "@primary", blur: 30, x: 0, y: 0 }, anim: withAnim({ in: "pop", inDur: 0.8, loop: "glow" }) }),
      makeLayer("rect", { name: "Linha", x: 760, y: 600, w: 400, h: 8, radius: 4, fill: grad(0, "@accent", "@secondary"), anim: withAnim({ in: "wipe", delay: 0.4, inDur: 0.8, loop: "gradient" }) }),
      title(sub, { x: 360, y: 640, w: 1200, h: 90, fontSize: 48, fontWeight: "600", letterSpacing: 8, uppercase: true, fill: "@text", anim: withAnim({ in: "fade", delay: 0.8, inDur: 0.8 }) }),
    ],
  };
}

export const PAGE_PRESETS = {
  overlay: {
    label: "Overlay de gameplay", kind: "Overlay",
    build: () => ({
      width: 1920, height: 1080, background: null, duration: 4,
      layers: [
        makeLayer("frame", { name: "Moldura da câmera", x: 1440, y: 700, w: 450, h: 340, thickness: 10, radius: 22, shadow: { color: "@primary", blur: 30, x: 0, y: 0 }, anim: withAnim({ loop: "gradient" }) }),
        makeLayer("rect", { name: "Etiqueta da câmera", x: 1500, y: 1010, w: 330, h: 54, radius: 27, fill: "@dark", stroke: "@primary", strokeWidth: 3 }),
        title("@seunick", { x: 1500, y: 1010, w: 330, h: 54, fontSize: 30, fill: "@text" }),
        makeLayer("rect", { name: "Barra inferior", x: 30, y: 1000, w: 900, h: 56, radius: 28, fill: grad(0, "rgba(15,10,31,0.85)", "rgba(15,10,31,0.4)"), stroke: "@primary", strokeWidth: 2 }),
        title("ÚLTIMO SEGUIDOR: fennec_fan  •  META: 120/200", { x: 60, y: 1000, w: 840, h: 56, fontSize: 26, fontWeight: "700", align: "left", fill: "@text" }),
        makeLayer("polygon", { name: "Estrela", x: 1850, y: 30, w: 44, h: 44, fill: "@accent", anim: withAnim({ loop: "spin" }) }),
        makeLayer("rect", { name: "Selo AO VIVO", x: 30, y: 30, w: 170, h: 52, radius: 10, fill: "@accent" }),
        title("● AO VIVO", { x: 30, y: 30, w: 170, h: 52, fontSize: 26, fill: "@light", anim: withAnim({ loop: "blink", amount: 0.6, cycles: 2 }) }),
      ],
    }),
  },
  webcam: {
    label: "Moldura de webcam", kind: "Webcam",
    build: () => ({
      width: 720, height: 440, background: null, duration: 3,
      layers: [
        makeLayer("frame", { name: "Moldura", x: 20, y: 20, w: 680, h: 400, thickness: 14, radius: 28, frameStyle: "double", shadow: { color: "@primary", blur: 24, x: 0, y: 0 }, anim: withAnim({ loop: "gradient" }) }),
        makeLayer("frame", { name: "Cantos", x: 6, y: 6, w: 708, h: 428, thickness: 6, frameStyle: "corners", cornerLength: 70, fill: "@accent", anim: withAnim({ loop: "pulse", amount: 0.5 }) }),
        makeLayer("rect", { name: "Etiqueta", x: 230, y: 384, w: 260, h: 48, radius: 24, fill: grad(0), stroke: "@dark", strokeWidth: 3 }),
        title("SEU NICK", { x: 230, y: 384, w: 260, h: 48, fontSize: 26, fill: "@light" }),
      ],
    }),
  },
  starting: { label: "Tela: Começando", kind: "Tela", build: () => screen("Começando já", "pegue seu lanche • a live vai começar") },
  brb: { label: "Tela: Já volto", kind: "Tela", build: () => screen("Já volto", "não sai daí!") },
  ending: { label: "Tela: Encerrando", kind: "Tela", build: () => screen("Valeu pela live!", "siga para não perder a próxima") },
  offline: { label: "Tela: Offline", kind: "Tela", build: () => screen("Offline", "lives: seg • qua • sex — 20h") },
  alert: {
    label: "Alerta (novo seguidor)", kind: "Alerta",
    build: () => ({
      width: 900, height: 300, background: null, duration: 5,
      layers: [
        makeLayer("rect", { name: "Fundo do alerta", x: 50, y: 70, w: 800, h: 180, radius: 30, fill: grad(0, "@dark", "@primary"), stroke: "@secondary", strokeWidth: 4, shadow: { color: "@primary", blur: 40, x: 0, y: 0 }, anim: withAnim({ in: "pop", inDur: 0.6, out: "fade", outDur: 0.5 }) }),
        makeLayer("polygon", { name: "Estrela", x: 20, y: 30, w: 140, h: 140, fill: "@accent", stroke: "@dark", strokeWidth: 4, anim: withAnim({ in: "spin-in", inDur: 0.8, delay: 0.2, out: "fade", outDur: 0.5, loop: "swing", amount: 2 }) }),
        title("NOVO SEGUIDOR!", { x: 170, y: 95, w: 640, h: 70, fontSize: 54, fill: "@accent", anim: withAnim({ in: "slide-right", inDur: 0.6, delay: 0.3, out: "fade", outDur: 0.5 }) }),
        title("fennec_fan", { x: 170, y: 165, w: 640, h: 60, fontSize: 42, fontWeight: "700", fill: "@text", anim: withAnim({ in: "typewriter", inDur: 0.8, delay: 0.7, out: "fade", outDur: 0.5 }) }),
        makeLayer("particles", { name: "Brilhos", x: 50, y: 0, w: 800, h: 300, count: 30, size: 12, fill: "@accent", anim: withAnim({ in: "fade", delay: 0.5, out: "fade", outDur: 0.5 }) }),
      ],
    }),
  },
  panel: {
    label: "Painel Twitch (320×160)", kind: "Painel",
    build: () => ({
      width: 320, height: 160, background: null, duration: 3,
      layers: [
        makeLayer("rect", { name: "Fundo", x: 4, y: 4, w: 312, h: 152, radius: 18, fill: grad(135, "@dark", "@primary"), stroke: "@secondary", strokeWidth: 3 }),
        makeLayer("particles", { name: "Brilhos", x: 4, y: 4, w: 312, h: 152, count: 12, size: 6, opacity: 0.6 }),
        title("SOBRE MIM", { x: 10, y: 40, w: 300, h: 80, fontSize: 40, fill: "@text", shadow: { color: "@primary", blur: 12, x: 0, y: 0 } }),
      ],
    }),
  },
  banner: {
    label: "Banner Twitch (1200×480)", kind: "Banner",
    build: () => ({
      width: 1200, height: 480, background: grad(120, "@dark", "@primary"), duration: 4,
      layers: [
        makeLayer("particles", { name: "Partículas", x: 0, y: 0, w: 1200, h: 480, count: 50, size: 10, opacity: 0.5 }),
        makeLayer("polygon", { name: "Hexágono", x: 760, y: 40, w: 420, h: 420, sides: 6, star: false, fill: "rgba(255,255,255,0.06)", stroke: "@secondary", strokeWidth: 4, rotation: 30 }),
        title("SEU NICK", { x: 60, y: 150, w: 700, h: 130, fontSize: 110, align: "left", fill: grad(0, "@light", "@secondary"), shadow: { color: "@primary", blur: 24, x: 0, y: 0 } }),
        title("games • conversa • diversão", { x: 64, y: 280, w: 700, h: 60, fontSize: 34, fontWeight: "600", align: "left", fill: "@text", letterSpacing: 3 }),
      ],
    }),
  },
  youtube: {
    label: "Banner YouTube (2560×1440)", kind: "Banner",
    build: () => ({
      width: 2560, height: 1440, background: grad(120, "@dark", "@primary"), duration: 4,
      layers: [
        makeLayer("particles", { name: "Partículas", x: 0, y: 0, w: 2560, h: 1440, count: 80, size: 16, opacity: 0.5 }),
        makeLayer("rect", { name: "Área segura", x: 507, y: 509, w: 1546, h: 423, radius: 40, fill: "rgba(0,0,0,0.25)", stroke: "@secondary", strokeWidth: 4 }),
        title("SEU CANAL", { x: 560, y: 560, w: 1440, h: 200, fontSize: 170, fill: grad(0, "@light", "@secondary") }),
        title("novos vídeos toda semana", { x: 560, y: 770, w: 1440, h: 100, fontSize: 64, fontWeight: "600", fill: "@text" }),
      ],
    }),
  },
  avatar: {
    label: "Avatar / perfil (800×800)", kind: "Avatar",
    build: () => ({
      width: 800, height: 800, background: null, duration: 3,
      layers: [
        makeLayer("ellipse", { name: "Fundo", x: 40, y: 40, w: 720, h: 720, fill: grad(135), stroke: "@light", strokeWidth: 12 }),
        makeLayer("image", { name: "Foto (use Cartoon)", x: 120, y: 100, w: 560, h: 620 }),
      ],
    }),
  },
  blank: { label: "Em branco (1920×1080)", kind: "Livre", build: () => ({ width: 1920, height: 1080, background: null, duration: 3, layers: [] }) },
};

export function makePage(presetKey) {
  const preset = PAGE_PRESETS[presetKey];
  return { id: uid(), name: preset.label.replace(/ \(.*\)$/, ""), kind: preset.kind, fps: 30, ...preset.build() };
}

export const PACK_PAGES = ["overlay", "webcam", "starting", "brb", "ending", "alert", "panel", "banner"];

export function makeDoc(themeName = "Neon Roxo", pages = PACK_PAGES) {
  const theme = { ...THEMES[themeName] };
  return { version: 1, name: "Meu Pack", theme, assets: {}, fonts: [], pages: pages.map((k) => makePage(k)) };
}
