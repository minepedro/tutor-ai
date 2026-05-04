/*
  Detector heurístico de estrutura em texto acadêmico.

  Identifica labels estruturais ("Exercício 5", "Capítulo 3", "Seção 2.1") no
  início de um chunk. O label vai como metadado pro DB; UI e prompt podem usar
  pra navegação e citação ("De acordo com o Exercício 5...").

  Estratégia: regex simples nos primeiros ~100 chars do chunk. Patterns cobrem
  PT-BR (principal) e EN (bonus pra material em inglês).

  Retorna:
  - String normalizada lowercase com prefixo + número/numeração ("exercício 5",
    "capítulo 3.2", "seção 4")
  - null se nenhum pattern bater (chunk é texto contínuo sem marcador)

  Decisões:
  - Só pega o PRIMEIRO marcador (chunk pode começar com "Exercício 3" e ter
    "Exemplo 5" no meio — o que define o chunk é o início)
  - Aceita numeração simples (5) e composta (5.2, 5.2.1)
  - Não faz parsing semântico — se um trecho legítimo começa com algo
    parecido (ex: "Exercício de respiração..."), pode dar falso positivo. OK.
*/

const PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // PT-BR
  { regex: /^Exerc[íi]cio\s+(\d+(?:\.\d+)*)/i, label: 'exercício' },
  { regex: /^Exemplo\s+(\d+(?:\.\d+)*)/i, label: 'exemplo' },
  { regex: /^Quest[ãa]o\s+(\d+(?:\.\d+)*)/i, label: 'questão' },
  { regex: /^Problema\s+(\d+(?:\.\d+)*)/i, label: 'problema' },
  { regex: /^Cap[íi]tulo\s+(\d+(?:\.\d+)*)/i, label: 'capítulo' },
  { regex: /^Se[çc][ãa]o\s+(\d+(?:\.\d+)*)/i, label: 'seção' },
  { regex: /^Unidade\s+(\d+(?:\.\d+)*)/i, label: 'unidade' },
  { regex: /^Aula\s+(\d+(?:\.\d+)*)/i, label: 'aula' },
  // EN (cobre material em inglês — comum em CS, exatas)
  { regex: /^Exercise\s+(\d+(?:\.\d+)*)/i, label: 'exercise' },
  { regex: /^Example\s+(\d+(?:\.\d+)*)/i, label: 'example' },
  { regex: /^Problem\s+(\d+(?:\.\d+)*)/i, label: 'problem' },
  { regex: /^Question\s+(\d+(?:\.\d+)*)/i, label: 'question' },
  { regex: /^Chapter\s+(\d+(?:\.\d+)*)/i, label: 'chapter' },
  { regex: /^Section\s+(\d+(?:\.\d+)*)/i, label: 'section' },
];

/**
 * Detecta label estrutural no início do texto. Retorna null se não bater
 * nenhum padrão.
 */
export function detectStructuralLabel(text: string): string | null {
  // Considera só os primeiros 80 chars (label tem que estar no começo).
  const head = text.trimStart().slice(0, 80);

  for (const { regex, label } of PATTERNS) {
    const match = head.match(regex);
    if (match) {
      return `${label} ${match[1]}`;
    }
  }

  return null;
}
