# syntax=docker/dockerfile:1.7
# Build context: repository root (see docker-compose.yml).
FROM node:22-alpine AS base
RUN npm install -g pnpm@12.15.0 turbo@2.11.10
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN turbo prune @nidhisetu/web --docker

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@nidhisetu/web...

FROM node:22-alpine AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Standalone output mirrors the monorepo layout under .next/standalone.
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
