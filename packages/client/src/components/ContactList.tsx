import { useEffect } from 'react';
import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';
import { Bot, Trash } from './Icons.js';

export function ContactList() {
  const { contacts, loadContacts, removeContact } = useContactsStore();
  const { createConversation, selectConversation } = useChatStore();

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const handleStartChat = async (peerId: string, name?: string) => {
    const id = await createConversation(peerId, name ? `与 ${name} 的对话` : undefined);
    await selectConversation(id);
  };

  if (contacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-6">
        <Bot className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm text-center">还没有联系人</p>
        <p className="text-xs text-center mt-1">点击上方按钮添加</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {contacts.map((contact) => (
        <div
          key={contact.id}
          className="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50"
          onClick={() => handleStartChat(contact.peer_id, contact.alias ?? contact.peer.name)}
        >
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
            <Bot className="w-[18px] h-[18px] text-gray-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-800 truncate">
              {contact.alias ?? contact.peer.name ?? 'Unnamed'}
            </div>
            <div className="text-xs text-gray-400 truncate">
              {contact.peer.organization ?? contact.peer.did}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeContact(contact.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
