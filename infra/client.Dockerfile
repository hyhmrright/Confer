FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/client/package.json ./packages/client/
COPY packages/mcp-a2a/package.json ./packages/mcp-a2a/
RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
RUN cd packages/client && bun run build

# Compress once here instead of on every request. Brotli -11 is far too slow to
# run per-request, but it is free at build time and beats gzip -9 by ~14% on
# this bundle. Content-hashed filenames mean these variants can never go stale.
# woff2 is already brotli-compressed internally and is deliberately excluded.
FROM alpine:3.24 AS compress
RUN apk add --no-cache brotli gzip
COPY --from=build /app/packages/client/dist /dist
RUN find /dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \
        -o -name '*.svg' -o -name '*.json' -o -name '*.txt' \) -print0 > /tmp/files \
    && xargs -0 -r brotli -q 11 -k < /tmp/files \
    && xargs -0 -r gzip -9 -k < /tmp/files \
    && rm /tmp/files

# Alpine's own nginx, not the official nginx:alpine image. Brotli is a dynamic
# module, and only Alpine's repo ships one built against a matching nginx —
# nginx.org's module set (which the official image uses) has no brotli at all,
# so `brotli_static` is unavailable there. Config therefore lives in http.d/,
# which is where Alpine's nginx.conf includes server blocks from.
FROM alpine:3.24
RUN apk add --no-cache nginx nginx-mod-http-brotli \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log
COPY --from=compress /dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/http.d/default.conf
COPY infra/security-headers.conf /etc/nginx/security-headers.conf

# Name the page's inline scripts in the CSP by hash, so script-src needs no
# 'unsafe-inline'. The tokens are produced by the locale-preload Vite plugin,
# which sees the page as it is built, so the two cannot drift.
#
# Both guards matter and they catch different things. `test -s` catches a
# missing or empty file, where `$(cat)` would expand to nothing and sed would
# quietly substitute an empty token list — a policy that blocks every inline
# script with no sign anything went wrong. The `grep` catches a placeholder that
# is no longer in the config, where sed matches nothing and whatever literal is
# there now ships as the policy.
RUN test -s /usr/share/nginx/html/csp-script-hashes.txt \
    && sed -i "s|__CSP_SCRIPT_HASHES__|$(cat /usr/share/nginx/html/csp-script-hashes.txt)|" \
        /etc/nginx/security-headers.conf \
    && ! grep -q __CSP_SCRIPT_HASHES__ /etc/nginx/security-headers.conf \
    && rm -f /usr/share/nginx/html/csp-script-hashes.txt*

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
