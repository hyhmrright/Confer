# Alpine, not the default Debian tag: the same Bun on a musl base, and 200 MB
# less of it. Everything native here has a musl build — argon2 ships prebuilds
# for both libcs, and @napi-rs/canvas (which pdfjs needs, see the prune below)
# publishes one per libc. Verified by running the parsers and an argon2 hash
# inside the built image, not by reading the tags.
FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/client/package.json ./packages/client/
COPY packages/mcp-a2a/package.json ./packages/mcp-a2a/
# Every workspace's manifest has to be here for --frozen-lockfile to validate,
# but this image runs the gateway alone. --filter installs the gateway and what
# it depends on; --production drops devDependencies. Without the pair, a server
# image carried the client's build chain — biome, the TypeScript compiler,
# rolldown, the Tauri CLI, lightningcss, happy-dom — none of which it can run.
RUN bun install --frozen-lockfile --production \
      --filter '@confer/gateway' --filter '@confer/shared' \
      --filter '@confer/identity' --filter '@confer/agent-runtime' \
  # @napi-rs/canvas ships one 25 MB Skia binary per libc, and bun installs both
  # because os+cpu are the only axes it can match on. This base is musl, so the
  # gnu copy is dead weight. Deleting the wrong one is not a silent failure: the
  # bundled pdfjs loads canvas to polyfill DOMMatrix, so a missing binary throws
  # at the first PDF, which `doc-parser.test.ts` now covers.
  && rm -rf node_modules/.bun/@napi-rs+canvas-linux-*-gnu@*

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
