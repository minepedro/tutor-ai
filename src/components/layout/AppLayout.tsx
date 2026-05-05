import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatScope, useChatScopeLabel } from '@/hooks/useChatScope';
import { ROUTES } from '@/lib/constants';

/*
  AppLayout é o "shell" do app:
  - Sidebar fixa à esquerda
  - Outlet (conteúdo da rota atual) no meio
  - ChatPanel drawer (legacy v0.4-0.7): aparece em todas as rotas EXCETO
    /chat (lá já tem chat fullscreen — drawer seria redundante).
  - Botão flutuante 💬 segue mesma regra (escondido em /chat).

  v0.8.0: chat fullscreen em /chat substitui parcialmente o drawer. Drawer
  é mantido por enquanto pra continuar oferecendo "chat com escopo da rota
  atual" (ex: chat dentro de TopicView com escopo = aquele topic). Em v0.8.1
  pode ser removido se /chat ganhar dropdown de escopo (todos os usos
  cobertos pelo fullscreen).
*/
export function AppLayout() {
  const [chatOpen, setChatOpen] = useState(false);
  const scope = useChatScope();
  const scopeLabel = useChatScopeLabel(scope);
  const location = useLocation();
  const isOnChatPage = location.pathname === ROUTES.CHAT;

  return (
    <div className="flex h-full bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>

      {/* Botão flutuante de chat — escondido em /chat */}
      {!chatOpen && !isOnChatPage && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          aria-label="Abrir chat"
          title="Chat com seu material"
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

      {/* Drawer (legacy) — escondido em /chat */}
      {!isOnChatPage && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          scope={scope}
          {...(scopeLabel ? { scopeLabel } : {})}
        />
      )}
    </div>
  );
}
