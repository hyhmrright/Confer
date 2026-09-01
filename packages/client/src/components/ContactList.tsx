import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';
import { ContactDetail } from './ContactDetail.js';
import { EmptyState } from './EmptyState.js';
import { Bot, Shield, Trash } from './Icons.js';
import { LoadMore } from './LoadMore.js';

export function ContactList() {
  const { t } = useTranslation();
  const contacts = useContactsStore((s) => s.contacts);
  const contactsTotal = useContactsStore((s) => s.contactsTotal);
  const loadingMore = useContactsStore((s) => s.loadingMore);
  const loadContacts = useContactsStore((s) => s.loadContacts);
  const loadMoreContacts = useContactsStore((s) => s.loadMoreContacts);
  const removeContact = useContactsStore((s) => s.removeContact);
  const openDetail = useContactsStore((s) => s.openDetail);
  // Selectors here, unlike the contacts store above: this list stays mounted
  // next to the message view, and the chat store updates once per streamed token.
  const createConversation = useChatStore((s) => s.createConversation);
  const selectConversation = useChatStore((s) => s.selectConversation);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const handleStartChat = async (name?: string) => {
    const id = await createConversation(name ? t('contacts.chatName', { name }) : undefined);
    await selectConversation(id);
  };

  if (contacts.length === 0) {
    return <EmptyState icon={Bot} title={t('contacts.empty')} hint={t('contacts.emptyHint')} />;
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
            onClick={() => handleStartChat(contact.alias ?? contact.peer.name)}
            className="flex items-center gap-3 flex-1 min-w-0 text-start cursor-pointer"
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
      <LoadMore
        shown={contacts.length}
        total={contactsTotal}
        busy={loadingMore}
        onMore={loadMoreContacts}
      />
      <ContactDetail />
    </div>
  );
}
