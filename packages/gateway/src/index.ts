import { app } from './app.js';
import { bootstrap } from './bootstrap.js';
import { getEnv } from './env.js';
import { runDetached } from './lib/background.js';
import { isMaintaining, maintenanceRequest, setMaintenance } from './lib/maintenance.js';
import { websocket } from './ws/handler.js';

const env = getEnv();

runDetached(bootstrap(), (err) => console.error('Bootstrap failed:', err));
process.on('SIGUSR2', () => setMaintenance(true));
process.on('SIGUSR1', () => setMaintenance(false));

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
    if (isMaintaining() && url.pathname === '/ws')
      return new Response('Backup in progress', { status: 503 });
    if (url.pathname === '/ws' && req.headers.get('upgrade') === 'websocket') {
      return websocket.upgrade(req, server);
    }
    const ip = server.requestIP(req)?.address;
    const continuation =
      url.pathname.startsWith('/a2a/v1/') &&
      ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip ?? '');
    return maintenanceRequest(req, () => app.fetch(req, { ip }), continuation);
  },
  websocket: {
    open: websocket.open,
    message: websocket.message,
    close: websocket.close,
  },
};
