import { app } from './app.js';
import { bootstrap } from './bootstrap.js';
import { getEnv } from './env.js';
import { websocket } from './ws/handler.js';

const env = getEnv();

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});

console.log(`Confer gateway starting on ${env.HOST}:${env.PORT}`);

// Bun closes a connection after 10 seconds of silence by default, and both of
// this server's long-lived responses are silent for far longer than that: an
// SSE turn writes nothing until the model's first token (a local model with a
// full context takes tens of seconds), and the consult long-poll deliberately
// waits up to 55. Both were being cut mid-flight — the client saw a dropped
// socket, and behind nginx a bare 502, with the gateway's own log still
// showing a clean `200`. 255 is Bun's maximum.
const IDLE_TIMEOUT_SECONDS = 255;

export default {
  port: env.PORT,
  hostname: env.HOST,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  fetch(req: Request, server: import('bun').Server<unknown>) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' && req.headers.get('upgrade') === 'websocket') {
      return websocket.upgrade(req, server);
    }
    return app.fetch(req, { ip: server.requestIP(req)?.address });
  },
  websocket: {
    open: websocket.open,
    message: websocket.message,
    close: websocket.close,
  },
};
