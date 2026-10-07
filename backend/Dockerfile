# Practice image: nothing deploys this (plan 001, Q11). Build context is the repo root:
#   docker build -f backend/Dockerfile .

# ---- full dependencies (dev included) for the TypeScript build
FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN bun install --frozen-lockfile --filter backend

# ---- compile to backend/dist
FROM deps AS build
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
RUN bun run --filter backend build

# ---- production dependencies only (a clean install, so no dev package can leak in)
FROM oven/bun:1.4 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN bun install --frozen-lockfile --production --filter backend

# ---- runtime
FROM node:24-slim AS runtime
# The API binds to loopback by default, which a published container port cannot reach. Bind to
# all interfaces inside the container; compose publishes the port on 127.0.0.1 only.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000
WORKDIR /app/backend
COPY --from=prod-deps --chown=node:node /app/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./package.json
COPY --from=build --chown=node:node /app/backend/dist ./dist
# Migrations and schema: `node dist/lib/db/cli.js migrate` reads ../../../db/migration.
COPY --chown=node:node backend/db ./db
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
