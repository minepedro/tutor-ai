import { ipcMain } from 'electron';
import {
  createConversation,
  getConversation,
  listConversationsByScope,
  deleteConversation,
  renameConversation,
  type ScopeType,
} from '../database/repositories/conversations.repo';
import { sendMessage } from '../services/chat.service';
import { isObject } from '../utils/type-guards';

/*
  Handlers do chat. Expõe:
  - chat:listConversations(scope) — lista conversas de um escopo
  - chat:get(id) — busca conversa com mensagens
  - chat:create(input) — nova conversa
  - chat:sendMessage(conversationId, scope, content) — núcleo: dispara o
    pipeline RAG + Claude e devolve a resposta
  - chat:rename(id, title) — muda título
  - chat:delete(id) — apaga (cascade nas mensagens)
*/

const VALID_SCOPE_TYPES: ScopeType[] = ['inline', 'document', 'topic', 'subject'];

export function registerChatHandlers(): void {
  ipcMain.handle('chat:listConversations', (_event, scope: unknown) => {
    const parsed = parseScope(scope);
    return listConversationsByScope(parsed.scopeType, parsed.scopeId);
  });

  ipcMain.handle('chat:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('chat:get exige id (string)');
    return getConversation(id);
  });

  ipcMain.handle('chat:create', (_event, input: unknown) => {
    if (!isObject(input)) throw new Error('chat:create exige um objeto');
    const scope = parseScope(input);
    const title = input['title'];
    if (title !== undefined && title !== null && typeof title !== 'string') {
      throw new Error('title deve ser string ou null');
    }
    return createConversation({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      ...(title === undefined ? {} : { title }),
    });
  });

  ipcMain.handle(
    'chat:sendMessage',
    async (_event, conversationId: unknown, content: unknown) => {
      if (typeof conversationId !== 'string') {
        throw new Error('chat:sendMessage exige conversationId (string)');
      }
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('chat:sendMessage exige content (string não vazia)');
      }
      // Escopo é derivado da conversa (lido do DB internamente). Ver chat.service.
      return sendMessage(conversationId, content);
    },
  );

  ipcMain.handle('chat:rename', (_event, id: unknown, title: unknown) => {
    if (typeof id !== 'string') throw new Error('chat:rename exige id (string)');
    if (typeof title !== 'string') throw new Error('chat:rename exige title (string)');
    return renameConversation(id, title);
  });

  ipcMain.handle('chat:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('chat:delete exige id (string)');
    deleteConversation(id);
  });
}

interface ParsedScope {
  scopeType: ScopeType;
  scopeId: string;
}

function parseScope(value: unknown): ParsedScope {
  if (!isObject(value)) throw new Error('scope deve ser um objeto');
  const scopeType = value['scopeType'];
  const scopeId = value['scopeId'];
  if (typeof scopeType !== 'string' || !VALID_SCOPE_TYPES.includes(scopeType as ScopeType)) {
    throw new Error(`scopeType inválido: ${String(scopeType)}`);
  }
  if (typeof scopeId !== 'string' || scopeId.length === 0) {
    throw new Error('scopeId é obrigatório (string não vazia)');
  }
  return { scopeType: scopeType as ScopeType, scopeId };
}
