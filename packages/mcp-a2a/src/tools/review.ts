import type { GatewayClient } from '../gateway-client.js';
import { type AskResult, askAgent } from './consult.js';

export interface DesignReviewInput {
  peerId: string;
  plan: string;
  scope?: string;
  language?: string;
  waitSeconds: number;
}

// Build the design-review question markdown (the body of POST /consult question).
export function buildDesignReviewQuestion(plan: string, scope?: string): string {
  const heading = scope ? `# Design review request — ${scope}` : '# Design review request';
  return `${heading}

Please review this plan before I implement it. Flag vendor-specific gotchas,
wrong assumptions, and missing steps.

## Plan
${plan}`;
}

// Ask a peer to review a design/plan before implementation. Thin wrapper over the
// consult flow — the gateway signs and delivers the outbound A2A message.
export async function requestDesignReview(
  client: GatewayClient,
  input: DesignReviewInput,
): Promise<AskResult> {
  return askAgent(client, {
    peerId: input.peerId,
    question: buildDesignReviewQuestion(input.plan, input.scope),
    language: input.language,
    waitSeconds: input.waitSeconds,
  });
}

export interface ReviewFile {
  path: string;
  content: string;
}

export interface CodeReviewInput {
  peerId: string;
  files: ReviewFile[];
  focus?: string;
  language?: string;
  waitSeconds: number;
}

// The explanatory question (focus goes here; the code body goes in code_context
// to stay under the consult question length cap).
export function buildCodeReviewQuestion(focus?: string): string {
  return `# Code review request
Please review the following file(s). Focus: ${focus ?? 'correctness + vendor gotchas'}.`;
}

// One fenced block per file, headed by its path.
export function buildCodeReviewContext(files: ReviewFile[]): string {
  return files.map((f) => `## ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
}

export async function requestCodeReview(
  client: GatewayClient,
  input: CodeReviewInput,
): Promise<AskResult> {
  return askAgent(client, {
    peerId: input.peerId,
    question: buildCodeReviewQuestion(input.focus),
    codeContext: buildCodeReviewContext(input.files),
    language: input.language,
    waitSeconds: input.waitSeconds,
  });
}
