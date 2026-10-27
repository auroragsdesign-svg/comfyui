// Talks to the local ComfyUI server that serves this editor. The editor lives at
// /streamer_pack/, so every API path is resolved one level up.

const clientId = Math.random().toString(36).slice(2);
const apiUrl = (path) => new URL("../" + path, location.href).toString();

async function request(path, options) {
  const res = await fetch(apiUrl(path), options);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function serverStatus() {
  try {
    return await request("system_stats");
  } catch {
    return null;
  }
}

export async function listModels(folder) {
  try {
    return await request(`models/${folder}`);
  } catch {
    return [];
  }
}

export async function hasNode(name) {
  try {
    return name in await request(`object_info/${name}`);
  } catch {
    return false;
  }
}

export async function uploadImage(blob, name, subfolder = "") {
  const form = new FormData();
  form.append("image", blob, name);
  form.append("subfolder", subfolder);
  form.append("overwrite", "true");
  return request("upload/image", { method: "POST", body: form });
}

export function viewUrl(file) {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  return apiUrl(`view?${q}`);
}

export async function saveUserData(path, data) {
  return request(`userdata/${encodeURIComponent(path)}?overwrite=true`, { method: "POST", body: data });
}

export async function loadUserData(path) {
  return request(`userdata/${encodeURIComponent(path)}`);
}

export async function listUserData(dir) {
  try {
    return await request(`userdata?dir=${encodeURIComponent(dir)}`);
  } catch {
    return [];
  }
}

function describeError(err) {
  const lines = [err.error?.message || "Erro ao enviar o workflow"];
  for (const [id, n] of Object.entries(err.node_errors || {})) {
    for (const e of n.errors) lines.push(`${n.class_type} (#${id}): ${e.message} ${e.details || ""}`);
  }
  return lines.join("\n");
}

// Queues an API-format prompt and resolves with its history outputs.
export async function runPrompt(prompt, onProgress) {
  const res = await fetch(apiUrl("prompt"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: clientId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(describeError(body));
  const id = body.prompt_id;

  const ws = new WebSocket(apiUrl(`ws?clientId=${clientId}`).replace(/^http/, "ws"));
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    const msg = JSON.parse(ev.data);
    if (msg.type === "progress" && msg.data.prompt_id === id) onProgress?.(msg.data.value / msg.data.max, prompt[msg.data.node]?.class_type);
    if (msg.type === "executing" && msg.data.prompt_id === id && msg.data.node) onProgress?.(null, prompt[msg.data.node]?.class_type);
  };
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 800));
      const hist = (await request(`history/${id}`))[id];
      if (!hist) continue;
      if (hist.status?.status_str === "error") {
        const msg = hist.status.messages.find(([type]) => type === "execution_error");
        throw new Error(msg ? `${msg[1].node_type}: ${msg[1].exception_message}` : "Falha na execução");
      }
      if (hist.status?.completed) return hist.outputs;
    }
  } finally {
    ws.close();
  }
}

export const firstFile = (outputs, nodeId) => outputs[nodeId]?.images?.[0];

export const CARTOON_STYLES = {
  anime: { label: "Anime", prompt: "anime style portrait, cel shading, clean lineart, vibrant colors, expressive eyes, high quality illustration" },
  cartoon3d: { label: "Cartoon 3D", prompt: "3d cartoon character portrait, pixar style render, soft lighting, smooth shading, cute, vibrant colors" },
  comic: { label: "HQ / Comic", prompt: "comic book style portrait, bold ink outlines, halftone shading, dynamic colors, graphic novel art" },
  chibi: { label: "Chibi", prompt: "chibi style character, big head, cute, kawaii, flat colors, thick outline, sticker art" },
  vtuber: { label: "VTuber", prompt: "vtuber avatar style portrait, anime, glossy hair, soft gradients, colorful, detailed eyes, clean lineart" },
};

export const CARTOON_NEGATIVE = "photo, photorealistic, realistic skin, blurry, lowres, deformed, extra fingers, bad anatomy, watermark, text";

// Photo → cartoon. "ai" runs img2img with a checkpoint, the ink filter
// (StreamerCartoonize) can run alone or on top, and an optional background
// removal model cuts the subject out with transparency.
export function cartoonPrompt(o) {
  const p = { 1: { class_type: "LoadImage", inputs: { image: o.image } } };
  let image = ["1", 0];
  if (o.ai) {
    p[2] = { class_type: "ImageScaleToTotalPixels", inputs: { image, upscale_method: "lanczos", megapixels: o.megapixels, resolution_steps: 8 } };
    p[3] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.ckpt } };
    p[4] = { class_type: "CLIPTextEncode", inputs: { text: o.prompt, clip: ["3", 1] } };
    p[5] = { class_type: "CLIPTextEncode", inputs: { text: o.negative, clip: ["3", 1] } };
    p[6] = { class_type: "VAEEncode", inputs: { pixels: ["2", 0], vae: ["3", 2] } };
    p[7] = {
      class_type: "KSampler",
      inputs: {
        model: ["3", 0], positive: ["4", 0], negative: ["5", 0], latent_image: ["6", 0], seed: o.seed, steps: o.steps,
        cfg: o.cfg, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: o.denoise,
      },
    };
    p[8] = { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["3", 2] } };
    image = ["8", 0];
  }
  if (o.ink) {
    p[9] = { class_type: "StreamerCartoonize", inputs: { image, ...o.inkOptions } };
    image = ["9", 0];
  }
  if (o.bgModel) {
    p[10] = { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: o.bgModel } };
    p[11] = { class_type: "RemoveBackground", inputs: { bg_removal_model: ["10", 0], image } };
    p[12] = { class_type: "InvertMask", inputs: { mask: ["11", 0] } };
    p[13] = { class_type: "JoinImageWithAlpha", inputs: { image, alpha: ["12", 0] } };
    image = ["13", 0];
  }
  p[20] = { class_type: "SaveImage", inputs: { images: image, filename_prefix: "streamer_pack/cartoon" } };
  return p;
}

export const VIDEO_FORMATS = {
  webm: { label: "WebM VP9 (transparente, ideal para OBS)", alpha: true },
  apng: { label: "PNG animado (transparente)", alpha: true },
  webp: { label: "WebP animado (transparente)", alpha: true },
  mp4: { label: "MP4 H.264 (sem transparência)", alpha: false },
};

export function videoPrompt(folder, format, fps, prefix) {
  const p = { 1: { class_type: "LoadStreamerFrames", inputs: { folder } } };
  const images = ["1", 0];
  if (format === "webm") p[2] = { class_type: "SaveWEBM", inputs: { images, filename_prefix: prefix, codec: "vp9", fps, crf: 24 } };
  if (format === "apng") p[2] = { class_type: "SaveAnimatedPNG", inputs: { images, filename_prefix: prefix, fps, compress_level: 4 } };
  if (format === "webp") p[2] = { class_type: "SaveAnimatedWEBP", inputs: { images, filename_prefix: prefix, fps, lossless: false, quality: 90, method: "default" } };
  if (format === "mp4") {
    p[3] = { class_type: "SplitImageWithAlpha", inputs: { image: images } };
    p[4] = { class_type: "CreateVideo", inputs: { images: ["3", 0], fps } };
    p[2] = { class_type: "SaveVideo", inputs: { video: ["4", 0], filename_prefix: prefix, format: "mp4", "format.codec": "h264", "format.codec.encoding": "auto" } };
  }
  return p;
}
