import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Slider } from '@/components/ui/Slider';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { useIPC } from '@/hooks/useIPC';
import { useQuizGeneration } from '@/hooks/useQuizGeneration';
import { useSmoothProgress } from '@/hooks/useSmoothProgress';
import { quizPlayPath, ROUTES, topicViewPath } from '@/lib/constants';
import type { QuestionTypePref, Source, Subject, Topic } from '@/types/ipc';

const COUNT_MIN = 3;
const COUNT_MAX = 30;
const COUNT_DEFAULT = 10;

export function QuizSetup() {
  const api = useIPC();
  const navigate = useNavigate();
  const { topicId } = useParams<{ topicId: string }>();

  const [topic, setTopic] = useState<Topic | null | undefined>(undefined);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [sources, setSources] = useState<Source[]>([]);

  // Form state
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(COUNT_DEFAULT);
  const [types, setTypes] = useState<QuestionTypePref>('mixed');
  const [theme, setTheme] = useState('');
  /*
    Temas selecionados via chips (multi-seleção, v0.7.1).
    Coexistem com o input de texto livre — combinados na hora de enviar.
  */
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [suggestedThemes, setSuggestedThemes] = useState<string[]>([]);
  const [loadingThemes, setLoadingThemes] = useState(false);
  const [themeNotMatchedMessage, setThemeNotMatchedMessage] = useState<string | null>(
    null,
  );

  const generation = useQuizGeneration();
  // Interpola visualmente o progresso entre os checkpoints reais — evita
  // sensação de "barra travada" durante etapas longas (geração ~18s, etc).
  const smoothPct = useSmoothProgress(
    generation.generating ? (generation.progress?.pct ?? 0) : null,
  );

  // Carrega tópico → matéria → sources do tópico
  useEffect(() => {
    if (!topicId) {
      setTopic(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const t = await api.topics.get(topicId);
      if (cancelled) return;
      setTopic(t);
      if (!t) return;
      const [s, srcs] = await Promise.all([
        api.subjects.get(t.subjectId),
        api.sources.listByTopic(topicId),
      ]);
      if (cancelled) return;
      setSubject(s);
      setSources(srcs);
      // Seleciona automaticamente todas as sources processadas (UX comum)
      const processedIds = srcs
        .filter((src) => src.rawText !== null)
        .map((src) => src.id);
      setSelectedSourceIds(new Set(processedIds));
    })();
    return () => {
      cancelled = true;
    };
  }, [api, topicId]);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function handleSuggestThemes() {
    if (selectedSourceIds.size === 0) return;
    setLoadingThemes(true);
    try {
      const themes = await generation.suggestThemes(Array.from(selectedSourceIds));
      setSuggestedThemes(themes);
    } finally {
      setLoadingThemes(false);
    }
  }

  /*
    Combina texto livre + chips selecionados num filtro único, separado por
    vírgula. O backend (quiz-generation.ts) interpreta lista como OR.
    Dedup case-insensitive pra evitar "derivadas, Derivadas".
  */
  function buildThemeFilter(): string {
    const seen = new Set<string>();
    const all: string[] = [];
    const add = (t: string) => {
      const trimmed = t.trim();
      if (trimmed.length === 0) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      all.push(trimmed);
    };
    theme.split(',').forEach(add);
    selectedThemes.forEach(add);
    return all.join(', ');
  }

  async function handleGenerate() {
    if (!topicId || selectedSourceIds.size === 0) return;
    setThemeNotMatchedMessage(null);

    /*
      Título: se o usuário não preencheu, gera um default amigável que mistura
      tópico + tema (se filtro foi usado) + data. Ex: "Quiz de Probabilidade
      sobre derivadas · 03/05/2026". Se preencheu, respeita.
    */
    const finalTitle = title.trim().length > 0 ? title.trim() : buildDefaultTitle();
    const combinedThemes = buildThemeFilter();

    const result = await generation.generate({
      topicId,
      sourceIds: Array.from(selectedSourceIds),
      count,
      types,
      title: finalTitle,
      ...(combinedThemes.length > 0 ? { themeFilter: combinedThemes } : {}),
    });

    if (!result) return; // erro já está em generation.error

    if (!result.themeMatched) {
      setThemeNotMatchedMessage(
        `O(s) tema(s) "${combinedThemes}" não foram encontrados no material. Tente outros ou deixe em branco.`,
      );
      return;
    }

    if (result.quiz) {
      navigate(quizPlayPath(result.quiz.id));
    }
  }

  function buildDefaultTitle(): string {
    const today = new Date().toLocaleDateString('pt-BR');
    const combined = buildThemeFilter();
    const themePart = combined.length > 0 ? ` sobre ${combined}` : '';
    const topicName = topic?.name ?? 'tópico';
    return `Quiz de ${topicName}${themePart} · ${today}`;
  }

  function toggleSuggestedTheme(t: string) {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  // ── Estados de carregamento ───────────────────────────────────────────────
  if (topic === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando…" />
      </div>
    );
  }

  if (topic === null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Tópico não encontrado" />
        <main className="flex flex-1 items-center justify-center p-8">
          <Button variant="secondary" onClick={() => navigate(ROUTES.HOME)}>
            ← Voltar
          </Button>
        </main>
      </div>
    );
  }

  const processedSources = sources.filter((s) => s.rawText !== null);
  const pendingSources = sources.filter((s) => s.rawText === null);
  const canGenerate = selectedSourceIds.size > 0 && !generation.generating;

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title="Novo quiz"
        subtitle={
          subject
            ? `${subject.emoji} ${subject.name} · ${topic.name}`
            : topic.name
        }
      />

      <main className="flex flex-1 flex-col gap-6 p-8 pb-24">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(topicViewPath(topic.id))}
          >
            ← Voltar
          </Button>
        </div>

        {generation.error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 font-sans text-sm text-danger">
            {generation.error}
          </div>
        )}

        {themeNotMatchedMessage && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 font-sans text-sm text-warning">
            {themeNotMatchedMessage}
          </div>
        )}

        <Card className="flex flex-col gap-6">
          {/* ─── Título (primeira coisa) ─── */}
          <Input
            label="Título do quiz"
            placeholder={`Quiz de ${topic.name} · ${new Date().toLocaleDateString('pt-BR')}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            hint="Opcional. Se deixar em branco, usamos o título sugerido."
          />

          {/* ─── Sources ─── */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-sm font-medium text-text-muted">
              Materiais ({processedSources.length}{' '}
              {processedSources.length === 1 ? 'disponível' : 'disponíveis'})
            </label>

            {processedSources.length === 0 ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 font-sans text-sm text-warning">
                Nenhum material processado nesse tópico ainda. Suba PDFs e aguarde
                o processamento antes de gerar quiz.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {processedSources.map((source) => (
                  <SourceCheckbox
                    key={source.id}
                    source={source}
                    checked={selectedSourceIds.has(source.id)}
                    onToggle={() => toggleSource(source.id)}
                  />
                ))}
                {pendingSources.length > 0 && (
                  <p className="mt-1 font-sans text-xs text-text-subtle">
                    {pendingSources.length}{' '}
                    {pendingSources.length === 1
                      ? 'material ainda processando'
                      : 'materiais ainda processando'}{' '}
                    (não disponíveis pra quiz).
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ─── Tema (filtro) ─── */}
          <div className="flex flex-col gap-2">
            <Input
              label="Tema (opcional)"
              placeholder="Ex: derivadas, capacidade produtiva..."
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              hint="Deixe em branco pra cobrir todo o material. Texto livre — separe múltiplos temas por vírgula. Chips abaixo também valem (combinam com o texto)."
            />
            <div className="flex flex-wrap items-center gap-2">
              {/*
                v0.7.5: quando ainda não há chips, mostra botão "Sugerir
                temas" prominente. Quando já há chips, troca pra um link
                discreto "↻ Atualizar" — evita que o aluno clique sem
                querer e gaste tokens (apesar do cache in-memory deixar a
                2ª chamada gratuita pras mesmas sources, fica mais limpo).
              */}
              {suggestedThemes.length === 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSuggestThemes}
                  loading={loadingThemes}
                  disabled={selectedSourceIds.size === 0}
                >
                  Sugerir temas
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={handleSuggestThemes}
                  disabled={loadingThemes || selectedSourceIds.size === 0}
                  className={[
                    'font-sans text-xs text-text-muted underline',
                    'hover:text-text disabled:opacity-40',
                    'transition-colors',
                  ].join(' ')}
                  title="Pedir ao Claude pra sugerir temas de novo (usa cache se nada mudou)"
                >
                  {loadingThemes ? '↻ Atualizando…' : '↻ Atualizar temas'}
                </button>
              )}
              {suggestedThemes.map((t) => {
                const isSelected = selectedThemes.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleSuggestedTheme(t)}
                    aria-pressed={isSelected}
                    className={[
                      'rounded-full border px-3 py-1',
                      'font-sans text-xs',
                      'transition-colors',
                      isSelected
                        ? 'border-accent bg-accent/15 text-text'
                        : 'border-border bg-surface text-text-muted hover:border-accent hover:text-text',
                    ].join(' ')}
                  >
                    {isSelected ? '✓ ' : ''}
                    {t}
                  </button>
                );
              })}
            </div>
            {selectedThemes.size > 0 && (
              <p className="font-sans text-xs text-text-subtle">
                {selectedThemes.size}{' '}
                {selectedThemes.size === 1 ? 'tema selecionado' : 'temas selecionados'}
                {' · '}
                <button
                  type="button"
                  onClick={() => setSelectedThemes(new Set())}
                  className="underline hover:text-text"
                >
                  limpar
                </button>
              </p>
            )}
          </div>

          {/* ─── Número de perguntas ─── */}
          <Slider
            label="Número de perguntas"
            value={count}
            onChange={setCount}
            min={COUNT_MIN}
            max={COUNT_MAX}
          />

          {/*
            Warning de cobertura (v0.9.1+): quando count < numSources, alguns
            PDFs vão ficar SEM nenhuma pergunta. Avisa o aluno e oferece
            sugestão de aumentar count. Cálculo trivial — sem chamada IA.
            Documentação técnica em docs/_internal/pipeline-evaluation-*.
          */}
          {count < selectedSourceIds.size && selectedSourceIds.size > 1 && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3">
              <p className="font-sans text-sm font-medium text-warning">
                ⚠️ Cobertura desigual provável
              </p>
              <p className="mt-1 font-sans text-xs leading-relaxed text-text">
                Você selecionou <strong>{selectedSourceIds.size} materiais</strong>{' '}
                mas pediu só <strong>{count} perguntas</strong>. Pelo menos{' '}
                <strong>{selectedSourceIds.size - count}</strong>{' '}
                {selectedSourceIds.size - count === 1 ? 'PDF vai' : 'PDFs vão'}{' '}
                ficar sem nenhuma pergunta.
              </p>
              <button
                type="button"
                onClick={() => setCount(selectedSourceIds.size)}
                className="mt-2 font-sans text-xs text-warning underline hover:opacity-80"
              >
                ↑ Aumentar para {selectedSourceIds.size} (1 por PDF)
              </button>
            </div>
          )}

          {/* ─── Tipo ─── */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-sm font-medium text-text-muted">
              Tipo de pergunta
            </label>
            <SegmentedControl
              value={types}
              onChange={setTypes}
              options={[
                { value: 'mixed', label: 'Misto' },
                { value: 'multiple_choice', label: 'Múltipla escolha' },
                { value: 'true_false', label: 'Verdadeiro/Falso' },
              ]}
            />
          </div>

          <Button onClick={handleGenerate} disabled={!canGenerate}>
            Gerar quiz
          </Button>
        </Card>
      </main>

      {/* ─── Loading overlay durante geração ─── */}
      {generation.generating && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/90 backdrop-blur-sm">
          <Card className="w-full max-w-md">
            <div className="text-center">
              <p className="text-3xl">🎯</p>
              <p className="mt-3 font-sans text-base font-semibold text-text">
                Gerando seu quiz
              </p>
              <p className="mt-1 font-sans text-sm text-text-muted">
                Isso pode demorar 15-60 segundos. Não feche o app.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <Progress value={smoothPct} />
              <p className="text-center font-sans text-xs text-text-muted">
                {generation.progress?.status ?? 'Iniciando…'} ·{' '}
                <span className="font-mono">{smoothPct}%</span>
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Componentes locais ────────────────────────────────────────────────────

interface SourceCheckboxProps {
  source: Source;
  checked: boolean;
  onToggle: () => void;
}

function SourceCheckbox({ source, checked, onToggle }: SourceCheckboxProps) {
  return (
    <label
      className={[
        'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2',
        'transition-colors',
        checked
          ? 'border-accent/60 bg-accent/5'
          : 'border-border hover:border-border',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 cursor-pointer accent-accent"
      />
      <span className="text-lg">📄</span>
      <span className="flex-1 truncate font-sans text-sm text-text" title={source.filename}>
        {source.filename}
      </span>
      <span className="font-sans text-xs text-text-subtle">
        {source.chunkCount} chunks
      </span>
    </label>
  );
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 rounded px-3 py-1.5 font-sans text-sm transition-colors',
            value === opt.value
              ? 'bg-accent text-white shadow-sm'
              : 'text-text-muted hover:text-text',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
