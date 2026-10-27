import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

app.registerExtension({
  name: "Comfy.StreamerPack",
  commands: [
    {
      id: "StreamerPack.OpenEditor",
      label: "Streamer Pack Editor",
      icon: "pi pi-video",
      function: () => window.open(api.fileURL("/streamer_pack/index.html"), "_blank"),
    },
  ],
  menuCommands: [{ path: ["Extensions"], commands: ["StreamerPack.OpenEditor"] }],
});
