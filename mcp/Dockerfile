# syntax=docker/dockerfile:1.7
# Terrain Viewer MCP server, for a public HTTPS host (claude.ai and ChatGPT
# reach a connector by URL). Built and run on 2026-11-20 with Docker Desktop
# (linux/amd64, 1.6 GB): the ten tools answer and a slope view in 3D renders
# in 9 s without a GPU. Not yet run on a server.
#
# Build from the repository root (the bundle step reads lib/); what is sent
# to the build is listed in mcp/Dockerfile.dockerignore:
#   docker build -f mcp/Dockerfile -t terrain-viewer-mcp .
#   docker run -p 3300:3300 -e TV_ALLOWED_HOSTS=mcp.example.com -e TV_PUBLIC_URL=https://mcp.example.com -v tv-pictures:/data/pictures terrain-viewer-mcp
# or mcp/docker-compose.yml (a Portainer stack). The same file builds the
# tile service (tile-server.mjs) with `--target tiles`:
#   docker build -f mcp/Dockerfile --target tiles -t terrain-viewer-tiles .
#   docker run -p 3400:3400 --shm-size=1g -v tv-tiles:/data/tiles terrain-viewer-tiles
# Both are published by .github/workflows/docker-publish.yml as
# ghcr.io/iconem/terrain-viewer-mcp and ghcr.io/iconem/terrain-viewer-tiles.
#
# No .env is copied and import.meta.env is empty in the bundle (build.mjs):
# no key can reach the image.

# 1. The app's catalog code, bundled for Node. Needs the root dependencies.
FROM node:22-slim AS bundle
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY patches ./patches
COPY docs/package.json docs/package.json
COPY slides/package.json slides/package.json
COPY theme-editor/package.json theme-editor/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter .
COPY lib ./lib
COPY components ./components
COPY hooks ./hooks
COPY src ./src
COPY docs/src/generated/url-params.json docs/src/generated/url-params.json
COPY mcp ./mcp
RUN cd mcp && pnpm install --frozen-lockfile && node build.mjs

# 2. What both services run on: Node, a Chromium for the renderer, the
# shared code.
FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fontconfig ca-certificates && rm -rf /var/lib/apt/lists/*
# Noto Sans, the font of the app's map labels (MapLibre's "Noto Sans
# Bold" glyphs): the direct engine's contour labels are drawn with it.
# Pinned to a commit of notofonts.github.io, checked by hash.
ARG NOTO=https://raw.githubusercontent.com/notofonts/notofonts.github.io/c6f674cf56243b4c0b650134a9020e047eab702e/fonts/NotoSans/hinted/ttf
ADD --checksum=sha256:1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913 ${NOTO}/NotoSans-Bold.ttf /usr/share/fonts/truetype/noto/NotoSans-Bold.ttf
ADD --checksum=sha256:478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823 ${NOTO}/NotoSans-Regular.ttf /usr/share/fonts/truetype/noto/NotoSans-Regular.ttf
RUN chmod 644 /usr/share/fonts/truetype/noto/*.ttf && fc-cache -f
RUN corepack enable
WORKDIR /app
COPY mcp/package.json mcp/pnpm-lock.yaml mcp/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY mcp/server.mjs mcp/tile-server.mjs mcp/tile-openapi.mjs mcp/render.mjs mcp/direct.mjs mcp/dem.mjs mcp/browser-shim.mjs mcp/contours.mjs mcp/symbols.mjs mcp/mvt.mjs mcp/tools.mjs mcp/data-tools.mjs mcp/url.mjs mcp/view.html ./
COPY --from=bundle /repo/mcp/generated ./generated
ENV CHROME_PATH=/usr/bin/chromium TV_SOFTWARE_GL=1

# 3. The tile service (`--target tiles`): the app's rendering as XYZ tiles
# and pictures of a viewport. The rendered tiles are kept a week.
FROM runtime AS tiles
RUN mkdir -p /data/tiles && chown node:node /data/tiles
ENV PORT=3400 TILE_CACHE_DIR=/data/tiles
VOLUME /data/tiles
EXPOSE 3400
USER node
CMD ["node", "tile-server.mjs"]

# 4. The MCP server (the default target).
FROM runtime AS mcp
# The rendered pictures, kept a week: on a volume they survive a restart.
RUN mkdir -p /data/pictures && chown node:node /data/pictures
ENV PORT=3300 PICTURE_CACHE_DIR=/data/pictures
VOLUME /data/pictures
EXPOSE 3300
USER node
CMD ["node", "server.mjs"]
