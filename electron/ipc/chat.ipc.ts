import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  createConversation,
  getConversation,
  listConversationsByScope,
  deleteConversation,
  renameConversation,
} from '../database/repositories/conversations.repo';
import {
  sendMessage,
  sendQuizDoubt,
  getQuizDoubtConversation,
} from '../services/chat.service';
import { ChatScopeSchema, IdSchema, parseInput } from './schemas';

/*
  Handlers do chat. Expõe:
  - chat:listConversations(scope) — lista conversas de um escopo
  - chat:get(id) — busca conversa com mensagens
  - chat:create(input) — nova conversa
  - chat:sendMessage(conversationId, content) — chat global: dispara
    pipeline RAG + Claude e devolve a resposta com chunks usados
  - chat:askQuizDoubt(quizQuestionId, content) — chat inline em pergunta
    de quiz (v0.7.0): SEM RAG, contexto = pergunta + explicação
  - chat:getQuizDoubt(quizQuestionId) — busca conversa de dúvida (null se
    o aluno ainda não abriu o chat dessa pergunta)
  - chat:rename(id, title) — muda título
  - chat:delete(id) — apaga (cascade nas mensagens)
*/

const CreateConversationSchema = ChatScopeSchema.extend({
  title: z.string().nullable().optional(),
});

const NonEmptyContentSchema = z
  .string()
  .min(1)
  .refine((s) => s.trim().length > 0, 'content não pode ficar vazio');

const SendMessageSchema = z.object({
  conversationId: IdSchema,
  content: NonEmptyContentSchema,
});

const AskQuizDoubtSchema = z.object({
  quizQuestionId: IdSchema,
  content: NonEmptyContentSchema,
});

const RenameSchema = z.object({
  id: IdSchema,
  title: z.string(),
});

export function registerChatHandlers(): void {
  ipcMain.handle('chat:listConversations', (_event, scope: unknown) => {
    const parsed = parseInput(ChatScopeSchema, scope);
    return listConversationsByScope(parsed.scopeType, parsed.scopeId);
  });

  ipcMain.handle('chat:get', (_event, id: unknown) => {
    return getConversation(parseInput(IdSchema, id));
  });

  ipcMain.handle('chat:create', (_event, input: unknown) => {
    const parsed = parseInput(CreateConversationSchema, input);
    return createConversation({
      scopeType: parsed.scopeType,
      scopeId: parsed.scopeId,
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
    });
  });

  ipcMain.handle(
    'chat:sendMessage',
    async (_event, conversationId: unknown, content: unknown) => {
      const parsed = parseInput(SendMessageSchema, { conversationId, content });
      return sendMessage(parsed.conversationId, parsed.content);
    },
  );

  ipcMain.handle(
    'chat:askQuizDoubt',
    async (_event, quizQuestionId: unknown, content: unknown) => {
      const parsed = parseInput(AskQuizDoubtSchema, { quizQuestionId, content });
      return sendQuizDoubt(parsed.quizQuestionId, parsed.content);
    },
  );

  ipcMain.handle('chat:getQuizDoubt', (_event, quizQuestionId: unknown) => {
    return getQuizDoubtConversation(parseInput(IdSchema, quizQuestionId));
  });

  ipcMain.handle('chat:rename', (_event, id: unknown, title: unknown) => {
    const parsed = parseInput(RenameSchema, { id, title });
    return renameConversation(parsed.id, parsed.title);
  });

  ipcMain.handle('chat:delete', (_event, id: unknown) => {
    deleteConversation(parseInput(IdSchema, id));
  });
}
