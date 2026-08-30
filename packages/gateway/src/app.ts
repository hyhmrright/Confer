import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { a2aRoutes } from './routes/a2a.js';
import { adminRoutes } from './routes/admin.js';
import { agentDidRoutes } from './routes/agent-did.js';
import { agentFactsRoutes } from './routes/agent-facts.js';
import { authRoutes } from './routes/auth.js';
import { consultRoutes } from './routes/consult.js';
import { contactRoutes } from './routes/contacts.js';
import { conversationRoutes } from './routes/conversations.js';
import { errandRoutes } from './routes/errands.js';
import { knowledgeBasesRoutes } from './routes/knowledge-bases.js';
import { memoriesRoutes } from './routes/memories.js';
import { permissionRoutes } from './routes/permissions.js';
import { probeRoutes } from './routes/probe.js';
import { projectsRoutes } from './routes/projects.js';
import { streamRoutes } from './routes/stream.js';
import { agentRoutes, userRoutes } from './routes/users.js';
import { wellKnownRoutes } from './routes/well-known.js';

// Hono app with all routes/middleware wired but no server start or bootstrap,
// so tests can drive it via app.request() without side effects on import.
export const app = new Hono();

// CORS is scoped to the four documents that exist to be read by strangers: the
// two DID documents, the agent directory, and AgentFacts. They carry no
// credentials and are public by design, so `*` is the right answer for them.
//
// It used to be `app.use('*', cors())` — every route, `/api/v1/*` included.
// Nothing needs that: the web client is served by the same nginx and calls
// `/api/v1` as a relative path, so it is same-origin, and peers and the MCP
// server are not browsers and never consult CORS at all. What the wildcard did
// add was permission for any page in a victim's browser to read this instance's
// API responses — reachable in practice for a LAN or localhost install, where
// the attacker's page runs inside the network boundary the instance relies on.
for (const path of ['/.well-known/*', '/agents/*', '/a2a/v1/agent-facts/*']) {
  app.use(path, cors());
}

if (process.env.NODE_ENV !== 'test') {
  app.use('*', logger());
}
app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

app.route('/.well-known', wellKnownRoutes);
// Root-level `/agents/:username/did.json` — per-user DID documents for did:web
// sub-identifier resolution. Distinct prefix from `/api/v1/agents` and
// `/.well-known`; public (no signature gate), like the instance DID document.
app.route('/agents', agentDidRoutes);

app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1/agents', agentRoutes);
app.route('/api/v1/contacts', contactRoutes);
app.route('/api/v1/conversations', conversationRoutes);
app.route('/api/v1/consult', consultRoutes);
app.route('/api/v1/stream', streamRoutes);
app.route('/api/v1/permissions', permissionRoutes);
app.route('/api/v1/probe', probeRoutes);
app.route('/api/v1/projects', projectsRoutes);
app.route('/api/v1/errands', errandRoutes);
app.route('/api/v1/memories', memoriesRoutes);
app.route('/api/v1/knowledge-bases', knowledgeBasesRoutes);
app.route('/api/v1/admin', adminRoutes);

app.route('/a2a/v1', a2aRoutes);
app.route('/a2a/v1', agentFactsRoutes);
