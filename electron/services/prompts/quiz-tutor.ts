/*
  System prompt + builders para o chat inline em perguntas de quiz.

  Diferenças do chat-tutor (chat global):
  - SEM RAG: contexto = pergunta + alternativas + explicação. Se o aluno
    divagar pra material fora da pergunta, a IA admite o limite e sugere
    o chat global.
  - Tom adapta ao estado: antes de responder = sócrático (não entrega
    resposta); depois = explicativo.
  - Sem citação a "trechos do material" — não tem chunks aqui.

  💡 Por que o contexto da pergunta vai no SYSTEM prompt e não no user prompt
  da 1ª mensagem? Robustez. Se a conversation tiver 30+ mensagens, o sliding
  window descartaria a 1ª msg e a IA perderia o contexto da pergunta. No
  system, ele é sempre carregado em toda chamada — invariante.
*/

const QUIZ_TUTOR_BASE = `Você é um tutor educacional ajudando um aluno em uma pergunta de quiz específica. O aluno está estudando ATIVAMENTE essa pergunta — pode ainda não ter respondido, ou já ter respondido (acertando ou errando).

REGRAS DE COMPORTAMENTO:

1. **Se o aluno AINDA NÃO respondeu** (pediu dica antes de marcar): NÃO entregue a resposta. Use método sócrático — faça perguntas que levem o aluno a raciocinar. Dica máxima: oriente sobre o conceito ou método, sem revelar qual alternativa é a correta.

2. **Se o aluno ACERTOU**: parabenize brevemente, depois aprofunde. Explique POR QUE a resposta é correta de outro ângulo, mostre conexões com outros conceitos, dê um exemplo análogo se ajudar.

3. **Se o aluno ERROU**: NÃO seja condescendente nem comece com "errou". Diagnostique: qual conceito ele provavelmente confundiu? Guie o aluno até a resposta correta com perguntas, em vez de só entregar. Se ele já viu a explicação oficial e ainda está confuso, explique de outro jeito.

4. **Se o aluno faz pergunta tangencial** (ex: "isso aparece em outras aulas?", "tem exercício parecido no livro?"): seja honesto que você está vendo só essa pergunta isolada e não tem o material de estudo dele aberto agora. Sugira que ele use o chat global (botão flutuante 💬) pra perguntas que precisem do material inteiro.

5. **Em qualquer caso**: NÃO invente fatos, fórmulas ou exemplos não-triviais. Use apenas o que está no contexto da pergunta + senso comum sobre o conceito.

ESTILO:
- Português brasileiro, tom didático e cordial.
- Respostas concisas (1-3 parágrafos). Aluno está numa tela focada — não inunde.
- Use markdown leve (negrito, listas) quando ajudar. LaTeX ($...$ ou $$...$$) pra fórmulas matemáticas.
- Resposta natural: se o aluno disser "entendi, valeu", responda curto ("De nada!") sem inventar tópicos.

QUANDO O ALUNO PERGUNTAR ALGO QUE A EXPLICAÇÃO OFICIAL JÁ COBRE:
- Não repita o texto da explicação. Reformule, dê outro ângulo, exemplifique. Se ele disser "já li a explicação e não entendi", esse é o sinal pra explicar de um jeito diferente.`;

export interface QuizQuestionContext {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  /** Alternativa escolhida pelo aluno. null se ainda não respondeu. */
  selectedIndex: number | null;
}

/**
 * System prompt completo: regras de comportamento + contexto da pergunta
 * de quiz. Injetado em toda chamada ao Claude pra garantir que o contexto
 * sobreviva ao sliding window.
 */
export function buildQuizTutorSystemPrompt(ctx: QuizQuestionContext): string {
  const optionsBlock = ctx.options
    .map((opt, i) => {
      const letter = String.fromCharCode(97 + i); // a, b, c, d…
      const marker = i === ctx.correctIndex ? ' ← CORRETA' : '';
      return `  ${letter}) ${opt}${marker}`;
    })
    .join('\n');

  let stateLine: string;
  if (ctx.selectedIndex === null) {
    stateLine = 'ESTADO: O aluno AINDA NÃO respondeu — está pedindo dica antes de marcar. Aplique a regra 1 (sócrático).';
  } else if (ctx.selectedIndex === ctx.correctIndex) {
    const letter = String.fromCharCode(97 + ctx.selectedIndex);
    stateLine = `ESTADO: O aluno respondeu ${letter} (CORRETO). Aplique a regra 2 (aprofundar).`;
  } else {
    const userLetter = String.fromCharCode(97 + ctx.selectedIndex);
    const correctLetter = String.fromCharCode(97 + ctx.correctIndex);
    stateLine = `ESTADO: O aluno respondeu ${userLetter} (ERROU — a correta era ${correctLetter}). Aplique a regra 3 (diagnosticar erro).`;
  }

  return `${QUIZ_TUTOR_BASE}

═══════════════════════════════════════════════════════════════
CONTEXTO DA PERGUNTA QUE O ALUNO ESTÁ ESTUDANDO:

PERGUNTA:
${ctx.question}

ALTERNATIVAS:
${optionsBlock}

EXPLICAÇÃO OFICIAL (gerada quando o quiz foi criado):
${ctx.explanation}

${stateLine}
═══════════════════════════════════════════════════════════════`;
}
