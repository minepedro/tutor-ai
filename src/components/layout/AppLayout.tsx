import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatScope, useChatScopeLabel } from '@/hooks/useChatScope';

/*
  AppLayout é o "shell" do app:
  - Sidebar fixa à esquerda
  - Outlet (conteúdo da rota atual) no meio
  - ChatPanel: drawer da direita, controlado por estado local (open/close)
  - Botão flutuante 💬 no canto inferior direito

  O escopo do chat é detectado automaticamente pela rota atual via
  `useChatScope` (TopicView → topic, SubjectView → subject, outras → null).
  Quando não há escopo, o painel ainda abre mas mostra mensagem orientando
  o usuário a entrar num tópico/matéria.
*/
export function AppLayout() {
  const [chatOpen, setChatOpen] = useState(false);
  const scope = useChatScope();
  const scopeLabel = useChatScopeLabel(scope);

  return (
    <div className="flex h-full bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>

      {/* Botão flutuante de chat */}
      {!chatOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Abrir chat"
          title="Chat com seu material (Ctrl+J)"
          className={[
            'fixed bottom-6 right-6 z-20',
            'flex size-14 items-center justify-center rounded-full',
            'bg-accent text-2xl text-white shadow-lg shadow-accent/40',
            'transition-all duration-150',
            'hover:bg-accent-hover hover:scale-105 active:scale-95',
          ].join(' ')}
        >
          💬
        </button>
      )}

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        scope={scope}
        {...(scopeLabel ? { scopeLabel } : {})}
      />
    </div>
  );
}
