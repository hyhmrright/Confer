import { z } from 'zod';

// PUT body for a project-memory write. Each section has its own schema with its
// field REQUIRED (non-empty): a write targets exactly one section, so making the
// field required rejects an empty or mis-keyed body with a 400 instead of silently
// inserting NULL into the column. The route only ever sets the field it owns, so a
// write still can't clobber the sibling section.
export const projectFactsWriteSchema = z.object({
  facts_md: z.string().min(1),
});

export const projectDecisionsWriteSchema = z.object({
  decisions_md: z.string().min(1),
});

export type ProjectFactsWrite = z.infer<typeof projectFactsWriteSchema>;
export type ProjectDecisionsWrite = z.infer<typeof projectDecisionsWriteSchema>;
