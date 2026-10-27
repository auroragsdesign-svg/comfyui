# Streamer Pack

Editor de packs para streamers que roda dentro do ComfyUI: overlays, molduras de webcam, telas (começando / já volto / encerrando / offline), alertas, painéis e banners, com animações, e cartoon gerado a partir de fotos.

Abra em `http://127.0.0.1:8188/streamer_pack` ou pelo menu **Extensions → Streamer Pack Editor** do ComfyUI.

## Recursos

- Telas prontas com tema compartilhado: cores e fonte marcadas como “Tema” mudam juntas em todas as telas.
- Elementos editáveis: texto, retângulo, elipse, polígono/estrela, moldura de webcam (centro transparente), partículas e imagens. Todos podem ser movidos, redimensionados e girados, e têm gradiente, contorno, sombra/brilho, mesclagem e opacidade.
- Animações de entrada/saída (aparecer, deslizar, zoom, pop, quique, girar, revelar, máquina de escrever) e de loop (pulsar, flutuar, balançar, girar, tremer, piscar, brilho, arco-íris, gradiente). Os loops usam ciclos inteiros por duração, então o vídeo exportado repete sem emenda.
- Exportação: PNG transparente da tela, `.zip` com todas as telas, e vídeo em WebM VP9 com transparência (ideal para o OBS), PNG animado, WebP animado ou MP4.
- Cartoon da foto: filtro rápido (`Cartoonize Image`, sem modelo) ou img2img com qualquer checkpoint de `models/checkpoints`, com estilos prontos (anime, 3D, HQ, chibi, VTuber). Se houver um modelo em `models/background_removal`, o fundo pode ser removido.
- Projetos são salvos automaticamente em `user/default/streamer_pack/`.

Atalhos: `Ctrl+Z`/`Ctrl+Shift+Z`, `Ctrl+D` duplicar, `Ctrl+C`/`Ctrl+V`, `Delete`, setas (com `Shift` = 10px), `Espaço` reproduz a animação (segurar + arrastar move a visão), `Shift` ao redimensionar mantém a proporção, `Ctrl` ao arrastar desliga o encaixe. Dá para colar ou arrastar imagens direto no canvas.

## Nós

- **Cartoonize Image**: suavização bilateral, cores chapadas e traço de tinta. Preserva o canal alfa.
- **Load Streamer Frames**: carrega uma sequência de PNG de uma subpasta de `input/` mantendo a transparência. O editor envia os quadros para `input/streamer_pack/frames_*` e codifica o vídeo com os nós nativos `SaveWEBM`, `SaveAnimatedPNG`, `SaveAnimatedWEBP` ou `CreateVideo` + `SaveVideo`. Essas pastas de quadros podem ser apagadas depois da exportação.
