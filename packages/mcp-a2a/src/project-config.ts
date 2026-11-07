import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { normalizeGateway } from './device-login.js';

/** Shared by Codex and Claude: non-secret project identity, never credentials. */
export function loadProjectConfig(root: string): { gatewayUrl?: string; projectId?: string } {
  const directory = join(root, '.confer');
  const path = join(directory, 'project.json');
  try {
    if (lstatSync(directory).isSymbolicLink() || lstatSync(path).isSymbolicLink())
      throw new Error('Project config cannot be a symbolic link');
    const result = z
      .object({
        gatewayUrl: z.string().optional(),
        projectId: z
          .string()
          .regex(/^[a-zA-Z0-9._-]{1,255}$/)
          .optional(),
      })
      .strict()
      .parse(JSON.parse(readFileSync(path, 'utf8')));
    return {
      ...result,
      ...(result.gatewayUrl ? { gatewayUrl: normalizeGateway(result.gatewayUrl) } : {}),
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}
