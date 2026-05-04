import { useState } from 'react';
import type { ChatRagChunk } from '@/types/ipc';

interface Props {
  chunks: ChatRagChunk[];
}

/*
  Mostra as fontes (chunks) usadas pra montar a resposta.

  Comportamento:
  - Por padrão mostra só os filenames (um chip por chunk único).
  - Click em "ver trechos" expande pra mostrar conteúdo de cada chunk.
  - Mesmo source aparece 1x no header mesmo que tenha múltiplos chunks dele.
*/
export function ChatSources({ chunks }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (chunks.length === 0) return null;

  // Lista única de filenames (preserva ordem da primeira aparição)
  const filenames = Array.from(new Set(chunks.map((c) => c.sourceFilename)));

  return (
    <div className="mt-2 max-w-[85%]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-sans text-xs text-text-subtle">Fontes:</span>
        {filenames.map((name) => (
          <span
            key={name}
            className="rounded-full border border-border bg-surface px-2 py-0.5 font-sans text-xs text-text-muted"
            title={name}
          >
            📄 {truncate(name, 30)}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="font-sans text-xs text-accent hover:underline"
        >
          {expanded ? 'ocultar trechos' : `ver ${chunks.length} ${chunks.length === 1 ? 'trecho' : 'trechos'}`}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {chunks.map((c) => (
            <div
              key={c.chunkId}
              className="rounded-md border border-border bg-surface px-3 py-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="font-sans text-xs text-text-subtle">
                  📄 {c.sourceFilename} ·{' '}
                  {c.pageNumber !== null ? (
                    <>página {c.pageNumber}</>
                  ) : (
                    <>chunk {c.chunkIndex}</>
                  )}
                </span>
                {c.structuralLabel && (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-sans text-[10px] font-medium uppercase tracking-wide text-accent">
                    {c.structuralLabel}
                  </span>
                )}
                <span className="font-sans text-xs text-text-subtle">
                  · similaridade {((1 - c.distance) * 100).toFixed(0)}%
                </span>
              </div>
              <p className="font-sans text-xs leading-relaxed text-text-muted">
                {c.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
