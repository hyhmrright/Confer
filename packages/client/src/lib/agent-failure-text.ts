import i18n from '../i18n/index.js';

// The gateway reports why a turn could not run as a machine code and never as a
// sentence — it has no locale context, so anything it worded would reach en/ja
// users in Chinese. This is where those codes become text, and it is shared
// because the same codes arrive by two routes: live, on the chat stream, and
// after the fact, as the `system_notice` row an A2A turn leaves behind.

const FAILURE_TEXT = {
  no_model_configured: 'message.statusNoModel',
  // A provider the catalogue no longer carries is still a choice to be made in
  // the same place — "try again" would be the one useless thing to say.
  unknown_provider: 'message.statusNoModel',
  no_key_for_provider: 'message.statusNoKey',
} as const;

/** What to show the reader for an agent-failure code. */
export function agentFailureText(code: string): string {
  const key = FAILURE_TEXT[code as keyof typeof FAILURE_TEXT];
  return key ? i18n.t(key) : i18n.t('message.statusFailed');
}
