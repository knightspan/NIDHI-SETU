# syntax=docker/dockerfile:1.7
# Build context: repository root (see docker-compose.yml).
FROM node:22-alpine AS base
RUN npm install -g pnpm@12.15.0 turbo@2.11.10
WORKDIR /repo

# 1. Prune the monorepo to just the API and its workspace dependencies.
FROM base AS pruner
COPY . .
RUN turbo prune @nidhisetu/api --docker

# 2. Install (cached on lockfile) and build.
FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune leaves out the shared root tsconfig that every package extends.
COPY --from=pruner /repo/tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@nidhisetu/api...

# 3. Runtime image, non-root.
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /repo
RUN npm install -g pnpm@12.15.0 && addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo .
USER app
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
