import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { a2aRoutes } from './routes/a2a.js';
import { a2aRestRoutes } from './routes/a2a-rest.js';
import { adminRoutes } from './routes/admin.js';
import { agentCardRoutes } from './routes/agent-card.js';
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

// The desktop and mobile bundles are the one browser client that is *not*
// same-origin. A Tauri app serves its own assets from `tauri://localhost` (macOS,
// iOS) or `http://tauri.localhost` (Windows, Linux, Android) and calls whichever
// gateway its owner pointed it at, so without this every request from a shipped
// build dies in a preflight — the reason those builds could be installed and
// launched but never signed in.
//
// Named exactly, never `*`. Only a Tauri webview on the user's own machine can
// occupy these two origins; no web page can claim them. And since this API
// carries no cookies — the bearer token is read from localStorage and set as a
// header — what CORS grants here is read access to code that already holds a
// token, not ambient authority.
// `maxAge` is not decoration: every call this client makes carries an
// `Authorization` header, which is not CORS-safelisted, so each one is preceded
// by its own preflight. Uncached, a desktop app on a remote instance pays two
// round trips for every request it makes.
const TAURI_ORIGINS = ['tauri://localhost', 'http://tauri.localhost'];
app.use('/api/v1/*', cors({ origin: TAURI_ORIGINS, maxAge: 3600 }));

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
app.route('/agents', agentCardRoutes);

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

// One rate limiter for everything under `/a2a/v1`, registered here rather than
// inside a router. Hono runs a sub-app's `use('/*')` for any request under the
// mount path — including one destined for a SIBLING sub-app — so a limiter in
// each of the two bindings would charge a single request twice. Verified, not
// assumed. It now also covers `agent-facts`, which is a public read and had no
// limit of its own.
app.use('/a2a/v1/*', rateLimit(60, 60_000));

// The two A2A bindings share a prefix and every gate; only their wire format
// differs. `a2a-rest.ts` is the spec's HTTP+JSON binding and the one the Agent
// Card advertises; `a2a.ts` is Confer's own dialect, found through
// `/.well-known/agents.json`.
app.route('/a2a/v1', a2aRestRoutes);
app.route('/a2a/v1', a2aRoutes);
app.route('/a2a/v1', agentFactsRoutes);
