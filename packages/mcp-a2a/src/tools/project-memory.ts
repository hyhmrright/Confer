import type { GatewayClient } from '../gateway-client.js';

export type MemorySection = 'facts' | 'decisions';

interface FactsResponse {
  facts_md: string;
  version: number;
  updated_at: string | null;
}

interface DecisionsResponse {
  decisions_md: string;
  version: number;
  updated_at: string | null;
}

export interface ReadMemoryInput {
  projectId: string;
  peerId: string;
  // Omit to read both sections.
  section?: MemorySection;
}

export interface ReadMemoryResult {
  projectId: string;
  peerId: string;
  facts?: string;
  decisions?: string;
  version: number;
  updated_at: string | null;
}

function basePath(projectId: string, peerId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/peers/${encodeURIComponent(peerId)}`;
}

// Read a peer's memory for a project. A peer with nothing written yet reads back
// empty strings and version 0 — that's the normal "no memory yet" state, not an
// error, so callers can present it as "this peer has no notes in this project".
export async function readProjectMemory(
  client: GatewayClient,
  input: ReadMemoryInput,
): Promise<ReadMemoryResult> {
  const base = basePath(input.projectId, input.peerId);

  if (input.section === 'facts') {
    const r = await client.get<FactsResponse>(`${base}/facts`);
    return {
      projectId: input.projectId,
      peerId: input.peerId,
      facts: r.facts_md,
      version: r.version,
      updated_at: r.updated_at,
    };
  }
  if (input.section === 'decisions') {
    const r = await client.get<DecisionsResponse>(`${base}/decisions`);
    return {
      projectId: input.projectId,
      peerId: input.peerId,
      decisions: r.decisions_md,
      version: r.version,
      updated_at: r.updated_at,
    };
  }

  const [facts, decisions] = await Promise.all([
    client.get<FactsResponse>(`${base}/facts`),
    client.get<DecisionsResponse>(`${base}/decisions`),
  ]);
  return {
    projectId: input.projectId,
    peerId: input.peerId,
    facts: facts.facts_md,
    decisions: decisions.decisions_md,
    // facts and decisions live in the same row, so absent a write landing between
    // these two GETs their versions are identical; report facts'.
    version: facts.version,
    updated_at: facts.updated_at,
  };
}

export interface WriteMemoryInput {
  projectId: string;
  peerId: string;
  section: MemorySection;
  content: string;
}

export interface WriteMemoryResult {
  projectId: string;
  peerId: string;
  section: MemorySection;
  version: number;
  updated_at: string | null;
}

// Write one section. The gateway sets only the targeted column, so a facts write
// never clears decisions (and vice versa).
export async function writeProjectMemory(
  client: GatewayClient,
  input: WriteMemoryInput,
): Promise<WriteMemoryResult> {
  const base = basePath(input.projectId, input.peerId);

  if (input.section === 'facts') {
    const r = await client.put<FactsResponse>(`${base}/facts`, { facts_md: input.content });
    return {
      projectId: input.projectId,
      peerId: input.peerId,
      section: 'facts',
      version: r.version,
      updated_at: r.updated_at,
    };
  }
  const r = await client.put<DecisionsResponse>(`${base}/decisions`, {
    decisions_md: input.content,
  });
  return {
    projectId: input.projectId,
    peerId: input.peerId,
    section: 'decisions',
    version: r.version,
    updated_at: r.updated_at,
  };
}
