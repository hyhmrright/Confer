import { z } from 'zod';

// Idea C — MCP↔A2A bridge probe. A Wizard-of-Oz tool that records who asked a
// named person a question; the answer is later filled in by a human Wizard. The
// `question` text is stored (verification needs it) but truncated to 4000 chars
// and never written to logs.
export const PROBE_QUESTION_MAX = 4000;

// External input from the MCP tool (`ask_person_agent`). `person` is free text —
// the MVP deliberately does not resolve it to a peer agent.
export const askPersonRequestSchema = z.object({
  person: z.string().min(1).max(255),
  question: z.string().min(1).max(PROBE_QUESTION_MAX),
  // Whether a Slack-DM alternative was available at call time — an instrumentation
  // signal, not a behavioral input.
  had_slack_dm_alt: z.boolean().optional(),
  // Whether this call was prompted (vs unprompted), used to measure the 7-day
  // unprompted active-use rate.
  prompted: z.boolean().optional(),
});

// External input for the Wizard fill endpoint: the human-relayed answer plus
// optional audit annotations.
export const fillProbeRequestSchema = z.object({
  answer: z.string().min(1).max(8000),
  // Wizard's after-the-fact annotation: could the host model have answered this
  // itself? Tri-state (omitted = not yet judged).
  could_self_answer: z.boolean().optional(),
  // Audit flag to exclude founder dual-account self-tests from success counts.
  is_founder_test: z.boolean().optional(),
});

export type AskPersonRequest = z.infer<typeof askPersonRequestSchema>;
export type FillProbeRequest = z.infer<typeof fillProbeRequestSchema>;
