import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { conversationRoutes } from './routes/conversations.js';
import { contactRoutes } from './routes/contacts.js';
import { userRoutes, agentRoutes } from './routes/users.js';
import { wellKnownRoutes } from './routes/well-known.js';
import { getEnv } from './env.js';

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

// TODO: A2A routes
// TODO: WebSocket handler
// TODO: SSE streaming handler

const env = getEnv();
console.log(`Confer gateway starting on ${env.HOST}:${env.PORT}`);

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};
