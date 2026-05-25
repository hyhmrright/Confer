FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/identity/package.json ./packages/identity/
COPY packages/conversation/package.json ./packages/conversation/
COPY packages/agent-runtime/package.json ./packages/agent-runtime/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/client/package.json ./packages/client/
RUN bun install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY packages/client ./packages/client
RUN cd packages/client && bun run build

FROM nginx:alpine
COPY --from=build /app/packages/client/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
