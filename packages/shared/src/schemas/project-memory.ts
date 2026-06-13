import { z } from 'zod';

// PUT body for project memory. Both fields are optional because a write targets a
// single section (facts OR decisions) — the route picks the one field it owns and
// never touches the other, so one PUT can't clobber the sibling section.
export const projectMemoryWriteSchema = z.object({
  facts_md: z.string().optional(),
  decisions_md: z.string().optional(),
});

export type ProjectMemoryWrite = z.infer<typeof projectMemoryWriteSchema>;
