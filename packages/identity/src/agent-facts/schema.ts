import { z } from 'zod';

export const agentFactsSchema = z.object({
  '@context': z.string().default('https://nanda.dev/schemas/agent/v1'),
  did: z.string(),
  name: z.string(),
  description: z.string().optional(),
  owner: z
    .object({
      type: z.enum(['Organization', 'Individual']),
      name: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  capabilities: z.array(
    z.object({
      type: z.string(),
      scope: z.array(z.string()),
      languages: z.array(z.string()),
    }),
  ),
  endpoints: z.object({
    a2a: z.string().url(),
    stream: z.string().url().optional(),
  }),
  trust: z
    .object({
      verifiedBy: z.array(z.string()).optional(),
      issuedAt: z.string().optional(),
    })
    .optional(),
  publicKey: z
    .object({
      id: z.string(),
      type: z.string(),
    })
    .optional(),
});

export type AgentFacts = z.infer<typeof agentFactsSchema>;
