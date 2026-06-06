// Shared shapes of gateway consult API responses, used by the consult tools.

export interface ReplyResponse {
  status: 'answered' | 'pending';
  message?: { content: string | null };
}
