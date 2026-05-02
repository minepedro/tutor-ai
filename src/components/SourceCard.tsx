import type { EmbeddingProgress, Source } from '@/types/ipc';

interface Props {
  source: Source;
  /** Se a source está sendo ingerida agora, passa o progresso atual. */
  progress?: EmbeddingProgress;
  onDelete?: () => void;
}

const FILE_TYPE_ICON: Record<Source['fileType'], string> = {
  pdf: '📄',
  txt: '📝',
  url: '🔗',
  paste: '📋',
};

export function SourceCard({ source, progress, onDelete }: Props) {
  const isProcessing = progress !== undefined;
  // "Pendente" = upload feito mas ingestão ainda não rodou (sem rawText e sem progresso ativo)
  const isPending = !isProcessing && source.rawText === null;

  return (
    <div className="group flex flex-col gap-2 rounded-[10px] border border-border bg-bg-elevated px-4 py-3 transition-colors hover:border-accent/40">
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{FILE_TYPE_ICON[source.fileType] ?? '📄'}</span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-sm font-medium text-text" title={source.filename}>
            {source.filename}
          </p>
          <p className="font-sans text-xs text-text-subtle">
            {source.fileType.toUpperCase()} · {formatDate(source.createdAt)} ·{' '}
            <SourceStatus source={source} progress={progress} />
          </p>
        </div>

        {onDelete && !isProcessing && (
          <button
            type="button"
            aria-label="Remover material"
            onClick={onDelete}
            className={[
              'flex size-7 items-center justify-center rounded-md text-xs',
              'text-text-muted opacity-0 transition-all duration-150',
              'group-hover:opacity-100 hover:bg-surface hover:text-text',
            ].join(' ')}
          >
            🗑️
          </button>
        )}
      </div>

      {isProcessing && (
        <div className="flex flex-col gap-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Pequeno hint quando está pendente (raríssimo: ingestão falhou ou foi cancelada) */}
      {isPending && (
        <p className="font-sans text-xs text-warning">
          Processamento pendente — exclua e re-suba o arquivo para reindexar.
        </p>
      )}
    </div>
  );
}

interface StatusProps {
  source: Source;
  progress?: EmbeddingProgress;
}

function SourceStatus({ source, progress }: StatusProps) {
  if (progress) {
    return (
      <span className="text-accent">
        {progress.pct}% · {progress.status}
      </span>
    );
  }
  if (source.rawText === null) {
    return <span className="text-warning">processamento pendente</span>;
  }
  if (source.chunkCount === 0) {
    return <span className="text-text-muted">sem chunks</span>;
  }
  return (
    <span className="text-text-muted">
      {source.chunkCount} {source.chunkCount === 1 ? 'chunk' : 'chunks'} indexados
    </span>
  );
}

function formatDate(sqliteTimestamp: string): string {
  const datePart = sqliteTimestamp.split(' ')[0];
  if (!datePart) return sqliteTimestamp;
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return datePart;
  return `${day}/${month}/${year}`;
}
