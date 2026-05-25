FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/conversation/package.json ./packages/conversation/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/client/package.json ./packages/client/
RUN bun install --frozen-lockfile

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/identity ./packages/identity
COPY packages/conversation ./packages/conversation
COPY packages/agent-runtime ./packages/agent-runtime
COPY packages/gateway ./packages/gateway

USER bun
EXPOSE 3000
CMD ["bun", "run", "packages/gateway/src/index.ts"]
