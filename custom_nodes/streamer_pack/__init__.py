import os

import numpy as np
import torch
import torch.nn.functional as F
from aiohttp import web
from PIL import Image
from typing_extensions import override

import folder_paths
from comfy_api.latest import ComfyExtension, io
from server import PromptServer

WEB_DIRECTORY = "./web"
EDITOR_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "editor")


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
                io.Int.Input("color_levels", default=8, min=2, max=64, tooltip="Number of color steps per channel."),
                io.Float.Input("saturation", default=1.25, min=0.0, max=3.0, step=0.05),
                io.Float.Input("line_strength", default=0.85, min=0.0, max=1.0, step=0.05),
                io.Int.Input("line_thickness", default=2, min=1, max=8),
                io.Float.Input("line_threshold", default=0.03, min=0.0, max=0.5, step=0.005, tooltip="Lower values draw more lines."),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, smoothing, color_levels, saturation, line_strength, line_thickness, line_threshold) -> io.NodeOutput:
        rgb = image[..., :3].movedim(-1, 1)

        gray = (rgb * torch.tensor([0.299, 0.587, 0.114], device=rgb.device, dtype=rgb.dtype).view(1, 3, 1, 1)).sum(1, keepdim=True)
        local_mean = F.avg_pool2d(gray, 7, stride=1, padding=3, count_include_pad=False)
        edges = ((local_mean - gray - line_threshold) * 25.0).clamp(0.0, 1.0)
        edges = F.max_pool2d(edges, line_thickness * 2 - 1, stride=1, padding=line_thickness - 1)

        flat = rgb
        for _ in range(smoothing):
            flat = bilateral_filter(flat, 2, 3.0, 0.1)

        luma = (flat * torch.tensor([0.299, 0.587, 0.114], device=rgb.device, dtype=rgb.dtype).view(1, 3, 1, 1)).sum(1, keepdim=True)
        flat = torch.lerp(luma, flat, saturation).clamp(0.0, 1.0)
        flat = torch.round(flat * (color_levels - 1)) / (color_levels - 1)
        out = flat * (1.0 - edges * line_strength)

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
