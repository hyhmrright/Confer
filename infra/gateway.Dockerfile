FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/client/package.json ./packages/client/
COPY packages/mcp-a2a/package.json ./packages/mcp-a2a/
RUN bun install --frozen-lockfile

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/identity ./packages/identity
COPY packages/agent-runtime ./packages/agent-runtime
COPY packages/gateway ./packages/gateway
# Bun 1.4 stopped hoisting workspace dependencies to the root node_modules —
# each package now resolves its own through symlinks into the root .bun store.
# Copying only the root leaves those links behind and nothing can find
# drizzle-orm. Must stay after the source copies, which would overwrite them.
COPY --from=install /app/packages ./packages

USER bun
EXPOSE 3000
CMD ["bun", "run", "packages/gateway/src/index.ts"]
