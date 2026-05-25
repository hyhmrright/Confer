import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';

export default function ConversationList() {
  const { conversations, activeConversationId, selectConversation, createConversation } =
    useChatStore();
  const { openDialog } = useContactsStore();

  const handleNew = async () => {
    const id = await createConversation();
    await selectConversation(id);
  };

  return (
    <aside className="w-72 border-r border-gray-200 bg-white flex flex-col">
      <div className="p-3 border-b border-gray-100 space-y-2">
        <button
          onClick={handleNew}
          className="w-full py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          新对话
        </button>
        <button
          onClick={openDialog}
          className="w-full py-2 text-sm border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50"
        >
          添加联系人
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">暂无对话</p>
        )}
        {conversations.map((conv) => (
          <button
            key={conv.id}
            onClick={() => selectConversation(conv.id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${
              conv.id === activeConversationId ? 'bg-primary-50' : ''
            }`}
          >
            <div className="text-sm font-medium truncate">
              {conv.name ?? `对话 ${conv.id.slice(0, 8)}`}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {new Date(conv.updated_at).toLocaleString('zh-CN')}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
