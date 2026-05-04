import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { ChatMessage as ChatMessageType, ChatRagChunk } from '@/types/ipc';
import { ChatSources } from './ChatSources';

interface Props {
  message: ChatMessageType;
  /** Chunks usados pra responder (só faz sentido pra mensagens 'assistant'). */
  chunks?: ChatRagChunk[];
}

/*
  Renderização de mensagens com markdown + LaTeX.

  Plugins:
  - remark-gfm: tabelas, strikethrough, autolinks, listas com checkbox
  - remark-math: parse de $$ e $ pra fórmulas LaTeX
  - rehype-katex: renderiza fórmulas via KaTeX (CSS importado em main.tsx)

  Por que custom `components`? Tailwind v4 sem typography plugin — então
  mapeamos cada elemento HTML do markdown pros nossos estilos do tema dark.
  Mais controle e zero dependência extra.

  💡 Mensagens de 'user' são plain text (não passamos pelo markdown). Isso
  evita que o usuário sem querer escreva `*texto*` e o app interprete como
  itálico em vez de mostrar o que ele digitou.
*/
export function ChatMessage({ message, chunks }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={['flex flex-col', isUser ? 'items-end' : 'items-start'].join(' ')}>
      <div
        className={[
          'max-w-[85%] rounded-[12px] px-4 py-2.5',
          'font-sans text-sm leading-relaxed',
          isUser
            ? 'bg-accent text-white'
            : 'border border-border bg-bg-elevated text-text',
        ].join(' ')}
      >
        {isUser ? (
          // Mensagem do usuário: texto literal, preserva quebras de linha
          message.content.split('\n').map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>

      {/* Citações (só pra assistant messages com chunks) */}
      {!isUser && chunks && chunks.length > 0 && <ChatSources chunks={chunks} />}
    </div>
  );
}

/*
  Mapeamento de elementos HTML gerados pelo markdown → classes Tailwind do
  tema dark. Sem `prose` do typography plugin — controle direto, bundle menor.
*/
const markdownComponents = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mt-3 mb-2 font-sans text-base font-bold first:mt-0" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mt-3 mb-2 font-sans text-sm font-bold first:mt-0" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mt-2 mb-1.5 font-sans text-sm font-semibold first:mt-0" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold" {...props} />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em className="italic" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="my-2 border-l-2 border-accent/40 pl-3 italic text-text-muted"
      {...props}
    />
  ),
  // Inline code: `código`
  code: (props: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) => {
    const { inline, className, children, ...rest } = props;
    if (inline) {
      return (
        <code
          className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-text"
          {...rest}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={['font-mono text-[0.85em]', className ?? ''].join(' ')} {...rest}>
        {children}
      </code>
    );
  },
  // Block code: ```bloco```
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="my-2 overflow-x-auto rounded-md border border-border bg-surface p-3 text-xs"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-border" />,
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      className="text-accent underline hover:text-accent-hover"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="border-b border-border" {...props} />
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-2 py-1 text-left font-semibold" {...props} />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className="border-b border-border/40 px-2 py-1" {...props} />
  ),
};
