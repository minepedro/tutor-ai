import { useEffect, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useIPC } from './useIPC';
import { ROUTES } from '@/lib/constants';
import type { ChatScope } from '@/types/ipc';

/*
  Detecta o escopo do chat baseado na rota atual:
  - /topics/:id   → topic
  - /subjects/:id → subject
  - outras        → null (botão fica disabled / painel mostra mensagem)

  v0.4.0 não suporta scope `document` ainda (precisaria de SourceView page).
  Inline (no quiz/flashcard) também fica pra v0.5+.
*/
export function useChatScope(): ChatScope | null {
  const location = useLocation();

  const topicMatch = matchPath(ROUTES.TOPIC_VIEW, location.pathname);
  if (topicMatch?.params['id']) {
    return { scopeType: 'topic', scopeId: topicMatch.params['id'] };
  }

  const subjectMatch = matchPath(ROUTES.SUBJECT_VIEW, location.pathname);
  if (subjectMatch?.params['id']) {
    return { scopeType: 'subject', scopeId: subjectMatch.params['id'] };
  }

  return null;
}

/*
  Resolve um label amigável pra mostrar no header do ChatPanel.
  Faz IPC calls pra pegar nome de subject/topic. Retorna null enquanto carrega
  ou se algo falhar.
*/
export function useChatScopeLabel(scope: ChatScope | null): string | null {
  const api = useIPC();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) {
      setLabel(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let result = '';
        if (scope.scopeType === 'topic') {
          const topic = await api.topics.get(scope.scopeId);
          if (topic) {
            const subject = await api.subjects.get(topic.subjectId);
            result = subject
              ? `${subject.emoji} ${subject.name} / ${topic.name}`
              : topic.name;
          }
        } else if (scope.scopeType === 'subject') {
          const subject = await api.subjects.get(scope.scopeId);
          if (subject) result = `${subject.emoji} ${subject.name}`;
        }
        if (!cancelled) setLabel(result || null);
      } catch {
        if (!cancelled) setLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, scope]);

  return label;
}
