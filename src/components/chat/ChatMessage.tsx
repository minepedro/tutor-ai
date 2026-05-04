import type { ChatMessage as ChatMessageType, ChatRagChunk } from '@/types/ipc';
import { ChatSources } from './ChatSources';

interface Props {
  message: ChatMessageType;
  /** Chunks usados pra responder (só faz sentido pra mensagens 'assistant'). */
  chunks?: ChatRagChunk[];
}

export function ChatMessage({ message, chunks }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={['flex flex-col', isUser ? 'items-end' : 'items-start'].join(' ')}>
      <div
        className={[
          'max-w-[85%] rounded-[12px] px-4 py-2.5',
          'font-sans text-sm leading-relaxed',
          isUser
            ? 'bg-accent text-white'
            : 'border border-border bg-bg-elevated text-text',
        ].join(' ')}
      >
        {/* Renderização simples: parágrafos por \n\n, quebra de linha por \n */}
        {message.content.split(/\n\n+/).map((paragraph, i) => (
          <p key={i} className={i > 0 ? 'mt-2' : ''}>
            {paragraph.split('\n').map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ))}
      </div>

      {/* Citações (só pra assistant messages com chunks) */}
      {!isUser && chunks && chunks.length > 0 && <ChatSources chunks={chunks} />}
    </div>
  );
}
