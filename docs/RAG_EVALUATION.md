# Avaliação empírica do RAG híbrido (v0.6)

Documento o experimento que validou a v0.6 (filtro estrutural + FTS5 + Reciprocal Rank Fusion)
e descobriu um bug crítico no backfill FTS5 que motivou a v0.6.1.

**Data:** 2026-05-04
**Versão testada:** v0.6.0 (recém-publicada)
**Ferramenta:** [scripts/compare-rag.ts](../scripts/compare-rag.ts)

---

## Por que fizemos esse teste

A v0.6 introduziu retrieval híbrido. A pergunta natural: **isso é melhor mesmo que o
semantic puro da v0.5, ou over-engineering?** Decisões de RAG são fáceis de defender
em teoria — vetores capturam significado, FTS captura termos literais — mas é fácil
não ver retorno em corpus pequeno ou queries simples.

Sem dados de uso real (zero usuários ativos), o teste é qualitativo: rodar as 3
estratégias lado a lado pras mesmas queries e julgar visualmente os resultados.

## Metodologia

### Corpus

Subject "gfdgd" do banco do desenvolvedor (Pedro), agregando 3 tópicos:

| Métrica | Valor |
|---|---|
| Sources (PDFs) | 21 |
| Chunks | 1901 |
| Domínios | Engenharia (Sistema Toyota de Produção, Lean, Poka Yoke), Pesquisa de Mercado, Literatura (Realismo) |
| Source dominante | `Realismo.pdf` (1492 chunks ≈ 78% do corpus) |

Mistura proposital pra exercitar engines em domínios diferentes — corpus monotemático
não testa bem retrieval híbrido.

### Estratégias comparadas

| # | Nome | Como funciona |
|---|---|---|
| 1 | **Semantic only** | Cosine distance contra todos os 1901 vetores no LanceDB. Equivalente ao retrieval da v0.5. |
| 2 | **FTS only** | SQLite FTS5 com BM25 (`document_chunks_fts`, tokenizer `unicode61 remove_diacritics 1`). Query parseada em palavras ≥3 chars, OR-joined. |
| 3 | **Hybrid RRF** | Roda 1 e 2 em paralelo, funde via `score = Σ 1/(60 + rank)`. Equivalente ao `searchByQuery` da v0.6 (sem o filtro estrutural pra isolar o efeito do RRF). |

### Queries (25)

Mistura proposital:
- Domínio técnico (Toyota/Lean) — 9 queries
- Pesquisa de Mercado — 2
- Literatura (Realismo) — 9
- Edge cases (vagas, estruturais, off-topic) — 5

Lista completa em [`scripts/compare-rag.ts`](../scripts/compare-rag.ts).

### Métricas

- **Latência por estratégia** (médias e p50)
- **Overlap @5**: quantos chunks aparecem nos dois top-5 (semantic ∩ fts)
- **Origem do top-1 do híbrido**: `both` / `sem-only` / `fts-only`
- **Diversidade de sources**: quantas sources únicas no top-5
- **Robustez do FTS**: quantas queries retornaram 0 resultados

Sem ground truth (ninguém rotulou "esse chunk é o certo"), análise qualitativa por
inspeção dos snippets.

---

## Resultados

### Latência

| Estratégia | Média (ms) | p50 (ms) |
|---|---|---|
| Semantic | 9.2 | 8.9 |
| **FTS** | **0.2** | **0.2** |
| Hybrid | 9.5 | 9.1 |

FTS é **~45× mais rápido** que semantic. Adicionar híbrido custou +3% de latência —
o FTS é praticamente grátis.

### Distribuição do overlap (semantic ∩ fts) @5

| Overlap | # queries |
|---|---|
| 0/5 | 11 (44%) |
| 1/5 | 2 |
| 2/5 | 6 |
| 3/5 | 1 |
| 4/5 | 0 |
| 5/5 | 5 (20%) |

**80% das queries têm overlap < 5/5** — semantic e FTS retornam coisas diferentes.
Híbrido não é redundância; está integrando informação real.

### Origem do top-1 do híbrido

| Origem | # queries | Significado |
|---|---|---|
| both | 14 (56%) | Top-1 está em ambos rankings (consenso) |
| sem-only | 11 (44%) | Semantic sozinho elegeria o mesmo top-1 |
| **fts-only** | **0** | Nunca top-1 do híbrido veio só do FTS |

Achado importante: com `RRF_K=60`, um chunk em rank 1 numa engine só vale `1/61 ≈ 0.0164`,
enquanto consenso (rank 1 nas duas) vale `2/61 ≈ 0.0328`. **RRF é conservador** — favorece
fortemente chunks que aparecem em ambos.

### Robustez

- **FTS retornou 0 resultados em 5/25 queries (20%)** — queries vagas ("introdução"), inglês
  com palavras curtas filtradas pelo `>= 3 chars`, termos ausentes do corpus.
- **FTS top-1 não estava no top-5 do semantic em 7/25 queries (28%)** — estes são os casos
  de **valor real adicionado** pelo FTS.

### Diversidade de sources no top-5

| Estratégia | Sources únicas (média) |
|---|---|
| Semantic | 1.84 |
| FTS | 1.76 |
| **Hybrid** | **2.08** |

Híbrido aumenta cobertura — top-5 vem de mais arquivos diferentes.

### Casos exemplares

**Query "Taiichi Ohno"** (nome próprio raro):
- Semantic puro retornou 5 chunks aleatórios do livro Realismo (`"mulato"`, `"Éramos"`,
  `"cotidiano"` — distance 0.55). **Lixo absoluto.**
- FTS achou o único chunk relevante (bibliografia citando "OmodeloToyota").
- Hybrid intercalou: 2 chunks relevantes em 5 vs 0 do semantic puro.

**Query "PHP"** (controle negativo, off-topic):
- Semantic retornou 5 chunks aleatórios do Realismo (distance ~0.67) — **app não sabe
  que são lixo**.
- **FTS retornou 0 — honestamente declarou que não achou.**
- Em produção isso é sinal forte de "fora do corpus".

**Query "Eça de Queirós"** (nome próprio do corpus):
- Semantic e FTS concordaram totalmente nos 5 primeiros (overlap 5/5).
- Hybrid só reforçou o consenso.
- Casos triviais — RRF não atrapalha.

---

## Achados

### 1. Bug crítico no backfill FTS5 (motivou v0.6.1)

A primeira execução do teste retornou **"FTS only: 0 resultados"** em **TODAS** as
25 queries — impossível dado que `MATCH 'toyota'` deveria achar dezenas de chunks.

Causa raiz: em **external content tables** (FTS5 com `content=document_chunks,
content_rowid=rowid`), o comando

```sql
INSERT INTO document_chunks_fts(rowid, content)
SELECT rowid, content FROM document_chunks
```

**insere as rows mas não popula o índice invertido**. Resultado: contagem de rows
bate (3456 = 3456) mas qualquer `MATCH` retorna 0.

A forma correta é o comando especial:

```sql
INSERT INTO document_chunks_fts(document_chunks_fts) VALUES('rebuild')
```

que reconstrói o índice lendo a tabela externa.

**Validação adicional:** triggers `AFTER INSERT` funcionam corretamente em chunks
novos — só o backfill estava bugado. Testado em DB em memória com 3 inserts.

**Impacto:** DBs criados em ≥v0.6 funcionam normal. DBs migrados de versões antigas
ficavam com FTS efetivamente desativado, sem erro visível. Fix em v0.6.1 detecta o
caso via probe (busca uma palavra real do 1º chunk; se MATCH=0, faz rebuild).

### 2. RRF é mais conservador do que o esperado

Zero queries no experimento tiveram top-1 do híbrido vindo apenas do FTS. Isso quer
dizer que, num corpus onde uma engine domina (semantic com 1901 candidatos vs FTS
com poucos hits relevantes), o FTS sozinho não consegue empurrar o top-1.

Implicação: o RRF default protege contra falsos positivos do FTS (queries com matches
acidentais), mas pode subutilizar o sinal do FTS quando ele é forte e o semantic é fraco.

Possível ajuste: `RRF_K` menor (ex: 30) aumenta o gradiente entre rank 1 e ranks
posteriores, dando mais peso ao top da lista de cada engine. Não testado.

### 3. FTS é "honesto" — semantic sempre retorna lixo

Semantic search **sempre** retorna top-K, mesmo quando nada no corpus é relevante.
A query "PHP" num corpus sobre Toyota e literatura retornou 5 chunks com distance
~0.67. Sem ground truth, o app não sabe se é resposta ou ruído.

FTS retorna 0 quando não acha nada literal. Isso é **sinal acionável**: combinado com
distance semantic alta (>0.6), pode disparar uma resposta "não encontrei sobre isso
no seu material" em vez de gerar texto sobre chunks irrelevantes.

### 4. FTS é praticamente grátis (latência)

0.2ms vs 9.2ms do semantic — 45× mais rápido. Em corpus 50× maior, FTS continua
sub-linear (índice invertido); semantic com scan completo cresce linear. O ponto de
inflexão onde FTS começa a dominar a latência total deve ser ~100k+ chunks.

Para o RAG atual, latência **não é argumento contra** o híbrido.

### 5. Diversidade aumenta no híbrido

Top-5 do semantic vem de 1.84 sources únicas (média), do híbrido vem de 2.08 — cobertura
mais ampla. Útil pra queries que poderiam ser respondidas por múltiplas fontes.

---

## Limitações do teste

1. **Amostra de 25 queries** é pequena. Ideal para validação inicial; insuficiente
   pra comparação estatística rigorosa (n=50+).
2. **Sem ground truth.** Análise é qualitativa por inspeção. Pra métricas formais
   (nDCG@5, MRR, recall@K) seria preciso rotular relevância de cada (query, chunk).
3. **Corpus heterogêneo mas dominado por um source** (Realismo.pdf é 78% dos chunks).
   Vieses do experimento favorecem queries que casam com esse domínio.
4. **Queries do dev, não do usuário real.** Quando o app tiver uso real, repetir com
   queries dos logs (anonimizadas) traz validação mais honesta.
5. **Não testou o filtro estrutural** (parte do pipeline da v0.6) — desligado pra
   isolar o efeito do RRF. O filtro estrutural foi testado manualmente em outro contexto.

---

## Recomendação

**Manter o RRF.** Custo zero, ganho real em ~28% das queries (quando FTS top-1 não
está no semantic top-5), nunca piora top-K em queries triviais.

Caminhos pra explorar quando virar dor:

- **Cross-encoder reranker** (BGE-reranker-base) sobre o top-50 do RRF → top-5. Ganha
  10-20% sobre RRF puro em benchmarks (BEIR, MS MARCO). Custo: ~200ms em CPU. Vale a
  pena quando RRF puro mostrar limitações em queries reais.
- **Heurística "fora do corpus"**: combinar `FTS=0` + `distance semantic > 0.6` pra
  declinar honestamente em vez de gerar resposta sobre chunks irrelevantes.
- **Tunar `RRF_K`**: testar 30 e 90 contra default 60 com mais queries.

## Como reproduzir

```bash
# Pré-requisito: app já rodou ao menos uma vez (DB e modelo ONNX existem em userData)
npx tsx scripts/compare-rag.ts
```

Output em `scripts/compare-rag.report.md` (gitignored).

Pra rodar em outro escopo, editar `SUBJECT_ID` e `QUERIES` no topo do script.

## Referências

- Cormack, Clarke, Buettcher — *"Reciprocal Rank Fusion outperforms Condorcet and
  individual Rank Learning Methods"* — SIGIR 2009
- [SQLite FTS5 docs](https://sqlite.org/fts5.html#external_content_tables) — particular:
  semântica do `INSERT` em external content tables
- [ADR-033](DECISIONS.md#adr-033) — filtro estrutural no RAG
- [ADR-034](DECISIONS.md#adr-034) — FTS5 + RRF
