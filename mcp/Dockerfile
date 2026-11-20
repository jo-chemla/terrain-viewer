# Terrain Viewer MCP server, for a public HTTPS host (claude.ai and ChatGPT
# reach a connector by URL). Built and run on 2026-11-20 with Docker Desktop
# (linux/amd64, 1.6 GB): the ten tools answer and a slope view in 3D renders
# in 9 s without a GPU. Not yet run on a server.
#
# Build from the repository root (the bundle step reads lib/); what is sent
# to the build is listed in mcp/Dockerfile.dockerignore:
#   docker build -f mcp/Dockerfile -t terrain-viewer-mcp .
#   docker run -p 3300:3300 -e TV_ALLOWED_HOSTS=mcp.example.com -e TV_PUBLIC_URL=https://mcp.example.com -v tv-pictures:/data/pictures terrain-viewer-mcp
# or mcp/docker-compose.yml (a Portainer stack).
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
COPY mcp ./mcp
RUN cd mcp && pnpm install --frozen-lockfile && node build.mjs

# 2. The server, with a Chromium for the `screenshot` tool.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY mcp/package.json mcp/pnpm-lock.yaml mcp/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY mcp/server.mjs mcp/tools.mjs mcp/data-tools.mjs mcp/url.mjs mcp/view.html ./
COPY --from=bundle /repo/mcp/generated ./generated
# The rendered pictures, kept a week: on a volume they survive a restart.
RUN mkdir -p /data/pictures && chown node:node /data/pictures
ENV CHROME_PATH=/usr/bin/chromium TV_SOFTWARE_GL=1 PORT=3300 PICTURE_CACHE_DIR=/data/pictures
VOLUME /data/pictures
EXPOSE 3300
USER node
CMD ["node", "server.mjs"]
