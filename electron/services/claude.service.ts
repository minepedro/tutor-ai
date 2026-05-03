import Anthropic from '@anthropic-ai/sdk';
import { loadApiKey } from '../utils/crypto';

/*
  Wrapper interno (main process) pra API da Anthropic.

  Por que esse arquivo existe?
  - Centraliza a leitura da API key (via safeStorage) em 1 lugar.
  - Aplica defaults (modelo, max_tokens) consistentes.
  - Traduz erros do SDK pra mensagens em português que a UI pode mostrar.
  - Cliente é singleton lazy: criado na primeira chamada, reaproveita HTTP keep-alive.

  Renderer NÃO chama esse service direto (não tem IPC pra ele). Apenas outros
  services do main (quiz-generator, futuramente rag/chat) o usam. Isso garante
  que a API key nunca vaza pro renderer e que cada feature tem seu próprio IPC
  com superfície focada (quiz:generate, chat:sendMessage, etc).
*/

/*
  💡 Modelo escolhido na ADR-022. Sonnet 4.6 é o equilíbrio certo de
  qualidade vs custo/latência pra geração de quiz. Opus seria overkill;
  Haiku falharia em distratores plausíveis. Trocar exige bumping de versão
  e nova ADR.
*/
const MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

let client: Anthropic | null = null;

export interface CompleteParams {
  /** Prompt de sistema (instruções/persona). Opcional. */
  system?: string;
  /** Histórico de mensagens. Mínimo 1 user. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Default 4096. Limite hard do Sonnet 4.x é 8192. */
  maxTokens?: number;
  /** Default 0.7. Use 0 pra determinismo (validação). */
  temperature?: number;
}

export interface CompleteResult {
  /** Texto da resposta do modelo. */
  content: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * `end_turn` = resposta normal.
   * `max_tokens` = resposta foi cortada — `content` pode estar incompleto.
   * `stop_sequence` / `tool_use` = casos não usados aqui.
   */
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string;
}

function getClient(): Anthropic {
  if (client) return client;

  const key = loadApiKey();
  if (!key) {
    throw new Error(
      'API key da Anthropic não configurada. Vá em Settings e cole sua chave.',
    );
  }

  client = new Anthropic({ apiKey: key });
  return client;
}

/**
 * Invalida o cliente cacheado. Chamar quando a API key muda
 * (saveApiKey ou clearAll em settings.ipc.ts).
 */
export function resetClaudeClient(): void {
  client = null;
}

/**
 * Faz uma chamada de completion ao Claude e retorna o texto + uso de tokens.
 *
 * O SDK 0.30 já faz retry com backoff em 429 e 5xx (default 2 tentativas).
 * Erros 4xx (auth, validação) lançam direto sem retry.
 */
export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const c = getClient();

  try {
    const response = await c.messages.create({
      model: MODEL,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: params.temperature ?? DEFAULT_TEMPERATURE,
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
    });

    /*
      Resposta vem como `content: ContentBlock[]`. Pra requisição sem tools,
      esperamos um único bloco do tipo 'text'. Pegamos o primeiro de tipo
      texto e descartamos os outros (não devem aparecer nesse caso).
    */
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Resposta da Anthropic sem bloco de texto');
    }

    const stopReason = response.stop_reason ?? 'end_turn';
    if (stopReason === 'max_tokens') {
      console.warn(
        '[claude.service] resposta truncada (max_tokens). Considere aumentar maxTokens nessa chamada.',
      );
    }

    return {
      content: textBlock.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason,
    };
  } catch (err) {
    throw mapError(err);
  }
}

/**
 * Verifica se a API key configurada funciona. Custa ~1 token.
 * Útil pra Settings ("verificar conexão") e debug.
 */
export async function ping(): Promise<boolean> {
  try {
    await complete({
      messages: [{ role: 'user', content: 'Responda com "ok" (sem aspas).' }],
      maxTokens: 5,
      temperature: 0,
    });
    return true;
  } catch {
    return false;
  }
}

/*
  Tradução de erros do SDK pra mensagens amigáveis em português.

  💡 Não usamos `instanceof Anthropic.APIError` direto porque a estrutura
  exportada do SDK varia entre versões. Lemos o `status` numérico que está
  presente em todas as versões e isso cobre os casos comuns.
*/
function mapError(err: unknown): Error {
  const status = (err as { status?: number }).status;
  const rawMessage = (err as { message?: string }).message ?? '';
  const lower = rawMessage.toLowerCase();

  /*
    Casos específicos detectados pelo conteúdo da mensagem.
    Ficam ANTES dos códigos HTTP genéricos porque o status pode ser 400 ou
    402, mas a causa real (créditos) tem solução específica que vale citar.
  */
  if (
    lower.includes('credit balance is too low') ||
    lower.includes('credit_balance') ||
    lower.includes('insufficient credit') ||
    lower.includes('billing')
  ) {
    return new Error(
      'Saldo de créditos da Anthropic insuficiente. Acesse console.anthropic.com → "Plans & Billing" pra adicionar créditos e tente de novo.',
    );
  }

  if (typeof status === 'number') {
    if (status === 401) {
      return new Error('API key da Anthropic inválida. Verifique em Settings.');
    }
    if (status === 429) {
      return new Error(
        'Limite de uso da API atingido. Aguarde alguns segundos e tente novamente.',
      );
    }
    if (status === 400) {
      // Genérico — mensagem do SDK em vez do JSON cru.
      const cleaned = extractApiErrorMessage(rawMessage);
      return new Error(`API rejeitou a requisição: ${cleaned}`);
    }
    if (status >= 500) {
      return new Error(
        `Erro temporário na Anthropic (HTTP ${status}). Tente novamente em alguns segundos.`,
      );
    }
  }

  if (err instanceof Error) {
    if (
      lower.includes('fetch failed') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('network')
    ) {
      return new Error('Sem conexão com a Anthropic. Verifique sua internet.');
    }
    return err;
  }

  return new Error('Erro desconhecido ao chamar a API Anthropic');
}

/*
  Mensagens de erro do SDK vêm às vezes como "400 {...JSON...}". Tenta
  extrair só a parte "message" do JSON pra mostrar texto limpo.
*/
function extractApiErrorMessage(raw: string): string {
  // Tenta achar bloco JSON dentro da string.
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return raw;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      error?: { message?: string };
    };
    return parsed.error?.message ?? raw;
  } catch {
    return raw;
  }
}
