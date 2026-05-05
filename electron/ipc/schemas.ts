import { z } from 'zod';

/*
  Schemas Zod compartilhados pelos IPC handlers (v0.7.2).

  Padrão: cada handler valida o input com `MySchema.safeParse(value)` e,
  em caso de erro, lança Error com mensagem amigável. Substitui as
  validações manuais com `typeof`/`isObject` que existiam antes.

  Vantagens:
  - Tipo inferido automaticamente do schema (`z.infer<typeof Schema>`)
  - Mensagens de erro consistentes
  - Sintaxe idêntica quando virar API web (Next.js Server Actions, tRPC)
  - Composability: schemas reusáveis (UUID, paginação, etc.)
*/

// ── Primitivos reusáveis ─────────────────────────────────────────────────

/** ID não vazio (UUIDs em produção, mas aceitamos qualquer string não vazia). */
export const IdSchema = z.string().min(1, 'id obrigatório');

/** String com pelo menos 1 caractere após trim. */
export const NonEmptyStringSchema = z
  .string()
  .min(1, 'não pode ficar vazio')
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, 'não pode ficar vazio');

/** Inteiro >= 0. */
export const NonNegativeIntSchema = z
  .number()
  .int('precisa ser inteiro')
  .nonnegative('precisa ser >= 0');

/** Array não vazio de strings. */
export const NonEmptyStringArraySchema = z
  .array(z.string().min(1))
  .min(1, 'precisa ter pelo menos 1 item');

// ── Domínio: chat scope ──────────────────────────────────────────────────

/**
 * Escopo aceito nos handlers genéricos de chat (lista, create).
 * `quiz_question` fica fora — usa-se chat:askQuizDoubt direto.
 * `global` (v0.8.0+) cobre todos os PDFs do app — `scopeId` é o literal
 * `'global'` (necessário pro NOT NULL do schema, não usado no RAG).
 */
export const ChatScopeSchema = z.object({
  scopeType: z.enum(['inline', 'document', 'topic', 'subject', 'global']),
  scopeId: IdSchema,
});

// ── Helper: parse com erro amigável ──────────────────────────────────────

/**
 * Valida `value` contra `schema`. Em caso de erro, lança Error com
 * mensagens concatenadas das issues (legíveis na UI).
 *
 * Usar dentro do handler:
 *   const parsed = parseInput(MySchema, args);
 */
export function parseInput<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`Input inválido — ${issues}`);
  }
  return result.data;
}
