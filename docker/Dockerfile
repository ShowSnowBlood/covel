# syntax=docker/dockerfile:1-labs
# node:26.7.0-alpine3.24 (2026-08-05) — pinned by multi-platform digest so
# the base image can't silently drift; bump the digest (and this comment)
# when intentionally upgrading Node.
FROM node:26.7.0-alpine3.24@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS base
RUN apk add --no-cache libc6-compat libstdc++
# Node 25+ no longer bundles corepack, so install it explicitly. Corepack
# resolves the pnpm version from the root package.json `packageManager` field,
# which keeps this image in sync without a second pinned version here.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm i -g corepack && corepack enable pnpm
WORKDIR /app

# ── Stage 1: Copy workspace manifests (cached by lockfile + manifests) ───
FROM base AS workspace-manifests
RUN apk add --no-cache --virtual .build-deps python3 make g++
# Every workspace importer declared in pnpm-lock.yaml must have its manifest
# present for --frozen-lockfile to succeed, even for members the final image
# never runs (apps/desktop). `--parents` keeps each manifest at its workspace
# path, so the globs stay correct when a package or plugin is added — an
# explicit per-member list silently drifts and breaks the build.
COPY --parents pnpm-lock.yaml package.json pnpm-workspace.yaml apps/*/package.json packages/*/package.json plugins/*/package.json ./

# ── Stage 2a: Dev dependencies for the web build ──────────────────
FROM workspace-manifests AS dev-deps
RUN pnpm install --frozen-lockfile

# ── Stage 2b: Production dependencies for the runtime image ────────
FROM workspace-manifests AS prod-deps
RUN pnpm install --prod --frozen-lockfile

# ── Stage 3: Build web frontend (static assets) ─────────────────────
FROM dev-deps AS build-web
COPY tsconfig.json turbo.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/
# TanStack Router generates routeTree.gen.ts during vite build,
# but tsc -b runs first and fails without it. Skip tsc in Docker
# (the dev workflow already catches type errors).
RUN cd apps/web && pnpm exec vite build

# ── Stage 4: Production runtime ─────────────────────────────────────
FROM prod-deps AS production
RUN apk del .build-deps

# Root tsconfig (needed by workspace packages)
COPY tsconfig.json ./

# Workspace packages (TS source — no build step, tsx handles runtime transpilation)
COPY packages/ packages/

# Server source
COPY apps/server/src/ apps/server/src/
COPY apps/server/tsconfig.json apps/server/

# Plugins (loaded by plugin-loader at startup)
COPY plugins/ plugins/

# Externalized prompt templates (loaded by @covel/context at runtime)
COPY prompts/ prompts/

# World packages (seed data loaded on first startup)
COPY worlds/ worlds/

# Model slot config. llm.toml is gitignored, so it is never in a CI/Render
# build context — it is supplied at runtime by the compose mount (or any
# bind-mount to /app/llm.toml); absent, the server boots on built-in defaults.
# The server resolves ./llm.toml from its cwd (/app/apps/server), hence the
# explicit override.
ENV COVEL_LLM_TOML=/app/llm.toml

# Built web static assets
COPY --from=build-web /app/dist/web apps/server/web-dist/

WORKDIR /app/apps/server

ENV NODE_ENV=production
ENV SERVE_STATIC=true
ENV STATIC_DIR=./web-dist
EXPOSE 3001

CMD ["pnpm", "exec", "tsx", "src/index.ts"]
