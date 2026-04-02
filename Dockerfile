# Build-verification image for CI.
# Production runtime is Cloudflare Workers (deployed via `wrangler deploy`).
# This image does NOT run the Worker; it validates that the build succeeds
# and produces frontend/dist + backend artifacts.
FROM node:22-bookworm-slim AS base
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm ci

FROM base AS build

COPY shared ./shared
RUN npm run build -w shared

COPY frontend ./frontend
RUN npm run build -w frontend

COPY backend ./backend
RUN npm run build -w backend

FROM node:22-bookworm-slim AS production
WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/

RUN npm ci --omit=dev

COPY --from=build /workspace/shared/dist ./shared/dist
COPY --from=build /workspace/shared/package.json ./shared/
COPY --from=build /workspace/frontend/dist ./frontend/dist
COPY --from=build /workspace/backend ./backend

EXPOSE 8787
