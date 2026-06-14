import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';
import { ContactDetail } from './ContactDetail.js';
import { Bot, Shield, Trash } from './Icons.js';

export function ContactList() {
  const { t } = useTranslation();
  const { contacts, loadContacts, removeContact, openDetail } = useContactsStore();
  const { createConversation, selectConversation } = useChatStore();

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const handleStartChat = async (peerId: string, name?: string) => {
    const id = await createConversation(
      peerId,
      name ? t('contacts.chatName', { name }) : undefined,
    );
    await selectConversation(id);
  };

  if (contacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-ink-muted p-6">
        <Bot className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm text-center">{t('contacts.empty')}</p>
        <p className="text-xs text-center mt-1">{t('contacts.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {contacts.map((contact) => (
        <div
          key={contact.id}
          className="group flex items-center gap-3 px-4 py-3 hover:bg-dark-hover border-b border-dark-border"
        >
          <button
            type="button"
            onClick={() => handleStartChat(contact.peer_id, contact.alias ?? contact.peer.name)}
            className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-full bg-dark-border flex items-center justify-center shrink-0">
              <Bot className="w-[18px] h-[18px] text-ink-muted" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-primary truncate">
                {contact.alias ?? contact.peer.name ?? t('contacts.unnamed')}
              </div>
              <div className="text-xs text-ink-muted truncate">
                {contact.peer.organization ?? contact.peer.did}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => openDetail(contact.id)}
            aria-label={t('contacts.openDetail')}
            title={t('contacts.openDetail')}
            className="opacity-0 group-hover:opacity-100 p-1 text-ink-muted hover:text-primary-400 transition-all"
          >
            <Shield className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => removeContact(contact.id)}
            className="opacity-0 group-hover:opacity-100 p-1 text-ink-muted hover:text-red-400 transition-all"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <ContactDetail />
    </div>
  );
}
