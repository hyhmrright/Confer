import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GatewayClient } from '../gateway-client.js';
import { syncProjectMemory } from './sync-project-memory.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'confer-memory-'));
  roots.push(root);
  let snapshot = {
    facts_md: '# Facts\nX100 uses 24V',
    decisions_md: '# Decisions\nManual only',
    version: 1,
  };
  const writes: unknown[] = [];
  const client = {
    get: async () => ({ ...snapshot }),
    put: async (_: string, body: typeof snapshot & { expected_version: number }) => {
      writes.push(body);
      snapshot = {
        facts_md: body.facts_md,
        decisions_md: body.decisions_md,
        version: snapshot.version + 1,
      };
      return snapshot;
    },
  } as unknown as GatewayClient;
  const options = {
    root,
    gateway: 'https://confer.example',
    accountId: 'alice',
    projectId: 'x100',
    peerId: '01J00000000000000000000001',
    direction: 'pull' as 'pull' | 'push',
  };
  const directory = join(root, '.confer', 'peers', options.peerId);
  return {
    client,
    options,
    directory,
    writes,
    changeRemote: () => {
      snapshot.version++;
    },
  };
}
describe('reviewable Markdown sync', () => {
  test('pulls both Markdown files; pushes reviewed edits against the exact version', async () => {
    const f = await fixture();
    await syncProjectMemory(f.client, f.options);
    expect(await readFile(join(f.directory, 'facts.md'), 'utf8')).toBe('# Facts\nX100 uses 24V');
    await writeFile(join(f.directory, 'facts.md'), '# Facts\n24 V DC');
    const pushed = await syncProjectMemory(f.client, { ...f.options, direction: 'push' });
    expect(pushed.version).toBe(2);
    expect(f.writes).toEqual([
      {
        facts_md: '# Facts\n24 V DC',
        decisions_md: '# Decisions\nManual only',
        expected_version: 1,
      },
    ]);
    await syncProjectMemory(f.client, f.options);
  });
  test('preserves local edits, untracked files and server edits', async () => {
    const f = await fixture();
    await mkdir(f.directory, { recursive: true });
    await writeFile(join(f.directory, 'facts.md'), 'valuable untracked notes');
    await expect(syncProjectMemory(f.client, f.options)).rejects.toThrow(
      'Local Markdown has changes',
    );
    expect(await readFile(join(f.directory, 'facts.md'), 'utf8')).toBe('valuable untracked notes');
    await rm(join(f.directory, 'facts.md'));
    await syncProjectMemory(f.client, f.options);
    await writeFile(join(f.directory, 'facts.md'), 'local change');
    await expect(syncProjectMemory(f.client, f.options)).rejects.toThrow(
      'Local Markdown has changes',
    );
    f.changeRemote();
    await expect(syncProjectMemory(f.client, { ...f.options, direction: 'push' })).rejects.toThrow(
      'Server memory changed',
    );
    expect(f.writes).toEqual([]);
  });
  test('isolates accounts and refuses symlinked directories and files', async () => {
    const f = await fixture();
    await syncProjectMemory(f.client, f.options);
    await expect(syncProjectMemory(f.client, { ...f.options, accountId: 'bob' })).rejects.toThrow(
      'different instance',
    );
    await rm(join(f.directory, 'facts.md'));
    await symlink(join(f.directory, 'decisions.md'), join(f.directory, 'facts.md'));
    await expect(syncProjectMemory(f.client, f.options)).rejects.toThrow('unsafe sync path');
    const g = await fixture();
    await mkdir(join(g.options.root, '.confer'));
    await symlink(f.directory, join(g.options.root, '.confer', 'peers'));
    await expect(syncProjectMemory(g.client, g.options)).rejects.toThrow('unsafe sync path');
  });
});
