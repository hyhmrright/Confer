import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { GatewayClient } from '../gateway-client.js';

const snapshotSchema = z.object({
  facts_md: z.string(),
  decisions_md: z.string(),
  version: z.number().int().min(0),
});
const stateSchema = z.object({
  identity: z.string(),
  version: z.number().int().min(0),
  facts: z.string(),
  decisions: z.string(),
});
interface SyncOptions {
  root: string;
  gateway: string;
  accountId: string;
  projectId: string;
  peerId: string;
  direction: 'pull' | 'push';
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function safePath(path: string, directory: boolean) {
  const stat = await lstat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())))
    throw new Error(`Refusing unsafe sync path: ${path}`);
}
async function readOptional(path: string) {
  await safePath(path, false);
  return readFile(path, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
}
async function atomicWrite(path: string, text: string) {
  await safePath(path, false);
  const tmp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tmp, text, { flag: 'wx', mode: 0o600 });
  await rename(tmp, path);
}

/** Explicit two-way sync. The server compare-and-swap is the write authority. */
export async function syncProjectMemory(client: GatewayClient, options: SyncOptions) {
  const { root, projectId, peerId, gateway, accountId, direction } = options;
  if (!/^[a-zA-Z0-9._-]{1,255}$/.test(projectId) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(peerId))
    throw new Error('Invalid project or peer id');
  let directory = root;
  for (const segment of ['.confer', 'peers', peerId]) {
    directory = join(directory, segment);
    await safePath(directory, true);
    await mkdir(directory, { recursive: true });
  }
  const factsPath = join(directory, 'facts.md');
  const decisionsPath = join(directory, 'decisions.md');
  const statePath = join(directory, '.sync.json');
  const identity = hash(JSON.stringify([gateway.replace(/\/$/, ''), accountId, projectId, peerId]));
  const rawState = await readOptional(statePath);
  const state = rawState === null ? null : stateSchema.parse(JSON.parse(rawState));
  if (state && state.identity !== identity)
    throw new Error(
      'Sync files belong to a different instance, account or project. Use another checkout.',
    );
  const facts = await readOptional(factsPath);
  const decisions = await readOptional(decisionsPath);
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/peers/${peerId}/memory`;
  const remote = snapshotSchema.parse(await client.get(path));
  if (direction === 'pull') {
    if (
      (facts !== null && hash(facts) !== state?.facts) ||
      (decisions !== null && hash(decisions) !== state?.decisions)
    )
      throw new Error('Local Markdown has changes. Reconcile or push them before pulling.');
    await atomicWrite(factsPath, remote.facts_md);
    await atomicWrite(decisionsPath, remote.decisions_md);
  } else {
    if (!state || facts === null || decisions === null)
      throw new Error('Pull first before pushing local Markdown.');
    if (remote.version !== state.version)
      throw new Error('Server memory changed. Reconcile local and remote edits before syncing.');
    const updated = snapshotSchema.parse(
      await client.put(path, {
        facts_md: facts,
        decisions_md: decisions,
        expected_version: state.version,
      }),
    );
    remote.facts_md = updated.facts_md;
    remote.decisions_md = updated.decisions_md;
    remote.version = updated.version;
  }
  await atomicWrite(
    statePath,
    `${JSON.stringify({ identity, version: remote.version, facts: hash(remote.facts_md), decisions: hash(remote.decisions_md) }, null, 2)}\n`,
  );
  return { directory, version: remote.version, direction };
}
