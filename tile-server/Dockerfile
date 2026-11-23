# syntax=docker/dockerfile:1.7
# Terrain Viewer tile service: the app's terrain modes and overlays as XYZ
# raster and vector tiles, pictures of a viewport, /openapi.json and /docs.
# Build from the repository root (the bundle step reads lib/); what is sent
# to the build is listed in tile-server/Dockerfile.dockerignore:
#   docker build -f tile-server/Dockerfile -t terrain-viewer-tiles .
#   docker run -p 3400:3400 --shm-size=1g -v tv-tiles:/data/tiles terrain-viewer-tiles
# Published by .github/workflows/docker-publish.yml as
# ghcr.io/iconem/terrain-viewer-tiles. mcp/docker-compose.yml runs it beside
# the MCP server, which asks it for its pictures.
#
# No .env is copied and import.meta.env is empty in the bundle (build.mjs):
# no key can reach the image.

# 1. The app's code bundled for Node (generated/). Needs the root dependencies.
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
COPY tile-server ./tile-server
RUN cd tile-server && pnpm install --frozen-lockfile && node build.mjs

# 2. Node, a Chromium for the browser engine, the service.
FROM node:22-slim AS tiles
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fontconfig ca-certificates && rm -rf /var/lib/apt/lists/*
# Noto Sans, the font of the app's map labels (MapLibre's "Noto Sans
# Bold" glyphs): the direct engine's contour labels are drawn with it.
# Pinned to a commit of notofonts.github.io, checked by hash.
ARG NOTO=https://raw.githubusercontent.com/notofonts/notofonts.github.io/c6f674cf56243b4c0b650134a9020e047eab702e/fonts/NotoSans/hinted/ttf
ADD --checksum=sha256:1df075a380fc7cb898acf64c1f7b3b4dd780de3caa860178bf929de35817a913 ${NOTO}/NotoSans-Bold.ttf /usr/share/fonts/truetype/noto/NotoSans-Bold.ttf
ADD --checksum=sha256:478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823 ${NOTO}/NotoSans-Regular.ttf /usr/share/fonts/truetype/noto/NotoSans-Regular.ttf
RUN chmod 644 /usr/share/fonts/truetype/noto/*.ttf && fc-cache -f
RUN corepack enable
WORKDIR /app/tile-server
COPY tile-server/package.json tile-server/pnpm-lock.yaml tile-server/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tile-server/*.mjs ./
COPY --from=bundle /repo/tile-server/generated ./generated
ENV CHROME_PATH=/usr/bin/chromium TV_SOFTWARE_GL=1
# The rendered tiles, kept a week: on a volume they survive a restart.
RUN mkdir -p /data/tiles && chown node:node /data/tiles
ENV PORT=3400 TILE_CACHE_DIR=/data/tiles
VOLUME /data/tiles
EXPOSE 3400
USER node
CMD ["node", "server.mjs"]
