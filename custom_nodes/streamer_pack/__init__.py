import os

import numpy as np
import torch
import torch.nn.functional as F
from aiohttp import web
from PIL import Image
from torchvision.transforms.functional import gaussian_blur
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, io
from server import PromptServer

WEB_DIRECTORY = "./web"
EDITOR_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "editor")
LUMA_WEIGHTS = (0.299, 0.587, 0.114)


def bilateral_filter(image, radius, sigma_space, sigma_color):
    h, w = image.shape[-2:]
    padded = F.pad(image, (radius, radius, radius, radius), mode="replicate")
    num = torch.zeros_like(image)
    den = torch.zeros_like(image[:, :1])
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            shifted = padded[..., radius + dy:radius + dy + h, radius + dx:radius + dx + w]
            weight = torch.exp(((shifted - image) ** 2).sum(1, keepdim=True) / (-2 * sigma_color ** 2) - (dy * dy + dx * dx) / (2 * sigma_space ** 2))
            num.addcmul_(weight, shifted)
            den.add_(weight)
    return num / den


def blur(image, sigma):
    k = int(sigma * 3) * 2 + 1
    return gaussian_blur(image, [k, k], [sigma, sigma])


class StreamerCartoonize(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="StreamerCartoonize",
            search_aliases=["cartoon", "toon", "comic filter", "streamer avatar"],
            display_name="Cartoonize Image",
            category="image/streamer pack",
            description="Turns a photo into a flat-shaded cartoon with ink lines. Alpha channels are preserved.",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("smoothing", default=4, min=0, max=16, tooltip="Bilateral filter passes. More passes give flatter color areas."),
                io.Int.Input("color_levels", default=6, min=2, max=64, tooltip="Number of shading bands."),
                io.Float.Input("saturation", default=1.2, min=0.0, max=3.0, step=0.05),
                io.Float.Input("line_strength", default=0.9, min=0.0, max=1.0, step=0.05),
                io.Float.Input("line_thickness", default=1.0, min=0.5, max=8.0, step=0.1),
                io.Float.Input("line_threshold", default=0.01, min=0.0, max=0.2, step=0.001, tooltip="Lower values draw more lines."),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, smoothing, color_levels, saturation, line_strength, line_thickness, line_threshold) -> io.NodeOutput:
        rgb = image[..., :3].movedim(-1, 1)
        h, w = rgb.shape[-2:]
        weights = torch.tensor(LUMA_WEIGHTS, device=rgb.device, dtype=rgb.dtype).view(1, 3, 1, 1)

        # Smooth at a bounded resolution so the filter flattens regions instead of just skin and fabric texture.
        scale = min(1.0, 640 / max(h, w))
        flat = F.interpolate(rgb, scale_factor=scale, mode="area") if scale < 1.0 else rgb
        for _ in range(smoothing):
            flat = bilateral_filter(flat, 3, 3.0, 0.08)
        if scale < 1.0:
            flat = F.interpolate(flat, size=(h, w), mode="bilinear")

        # Ink lines from a difference of gaussians on the smoothed luma.
        luma = (flat * weights).sum(1, keepdim=True)
        sigma = line_thickness * max(1.0, max(h, w) / 1024)
        edges = ((blur(luma, sigma * 1.6) - blur(luma, sigma) - line_threshold) * 40.0).clamp(0.0, 1.0)
        if image.shape[-1] == 4:
            alpha = image[..., 3:].movedim(-1, 1)
            edges = torch.maximum(edges, ((blur(alpha, sigma * 2) - alpha) * 6.0).abs().clamp(0.0, 1.0))

        # Cel shading: quantize brightness into bands while keeping each region's hue.
        flat = torch.lerp(luma, flat, saturation).clamp(0.0, 1.0)
        bands = torch.round(luma * (color_levels - 1)) / (color_levels - 1)
        out = (flat * (bands + 0.05) / (luma + 0.05)).clamp(0.0, 1.0) * (1.0 - edges * line_strength)

        return io.NodeOutput(torch.cat((out.movedim(1, -1), image[..., 3:]), dim=-1))


class LoadStreamerFrames(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="LoadStreamerFrames",
            display_name="Load Streamer Frames",
            category="image/streamer pack",
            description="Loads the PNG frame sequence of an input subfolder, in filename order, keeping transparency (RGBA).",
            inputs=[
                io.String.Input("folder", default="streamer_pack", tooltip="Subfolder of the input directory that holds the frames."),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, folder) -> io.NodeOutput:
        input_dir = folder_paths.get_input_directory()
        frames_dir = os.path.abspath(os.path.join(input_dir, folder))
        if frames_dir == os.path.abspath(input_dir) or not folder_paths.is_within_directory(input_dir, frames_dir):
            raise ValueError(f"Invalid folder {folder!r}: must be a subfolder of the input directory.")
        files = sorted(f for f in os.listdir(frames_dir) if f.lower().endswith(".png"))
        if not files:
            raise ValueError(f"No PNG frames found in {folder!r}.")

        frames = []
        for f in files:
            with Image.open(os.path.join(frames_dir, f)) as img:
                frames.append(torch.from_numpy(np.array(img.convert("RGBA")).astype(np.float32) / 255.0))
        return io.NodeOutput(torch.stack(frames))


@PromptServer.instance.routes.get("/streamer_pack")
async def editor_index(request):
    raise web.HTTPFound("/streamer_pack/index.html")

PromptServer.instance.routes.static("/streamer_pack", EDITOR_DIR)


class StreamerPackExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            StreamerCartoonize,
            LoadStreamerFrames,
        ]


async def comfy_entrypoint() -> StreamerPackExtension:
    return StreamerPackExtension()
