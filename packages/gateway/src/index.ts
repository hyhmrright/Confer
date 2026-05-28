import { app } from './app.js';
import { bootstrap } from './bootstrap.js';
import { getEnv } from './env.js';
import { websocket } from './ws/handler.js';

const env = getEnv();

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
});

console.log(`Confer gateway starting on ${env.HOST}:${env.PORT}`);

export default {
  port: env.PORT,
  hostname: env.HOST,
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
