import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { bootstrap } from './bootstrap.js';
import { getEnv } from './env.js';
import { errorHandler } from './middleware/error-handler.js';
import { a2aRoutes } from './routes/a2a.js';
import { agentFactsRoutes } from './routes/agent-facts.js';
import { authRoutes } from './routes/auth.js';
import { contactRoutes } from './routes/contacts.js';
import { conversationRoutes } from './routes/conversations.js';
import { knowledgeBasesRoutes } from './routes/knowledge-bases.js';
import { memoriesRoutes } from './routes/memories.js';
import { permissionRoutes } from './routes/permissions.js';
import { streamRoutes } from './routes/stream.js';
import { agentRoutes, userRoutes } from './routes/users.js';
import { wellKnownRoutes } from './routes/well-known.js';
import { websocket } from './ws/handler.js';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());
app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

app.route('/.well-known', wellKnownRoutes);

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1/agents', agentRoutes);
app.route('/api/v1/contacts', contactRoutes);
app.route('/api/v1/conversations', conversationRoutes);
app.route('/api/v1/stream', streamRoutes);
app.route('/api/v1/permissions', permissionRoutes);
app.route('/api/v1/memories', memoriesRoutes);
app.route('/api/v1/knowledge-bases', knowledgeBasesRoutes);

app.route('/a2a/v1', a2aRoutes);
app.route('/a2a/v1', agentFactsRoutes);

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
