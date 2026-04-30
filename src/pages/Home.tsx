import { Header } from '@/components/layout/Header';

export function Home() {
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="Início" subtitle="Suas matérias de estudo" />
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="font-sans text-4xl">📚</p>
          <p className="mt-4 font-sans text-base font-medium text-text">
            Nenhuma matéria ainda
          </p>
          <p className="mt-2 font-sans text-sm text-text-muted">
            A v0.2.0 vai trazer criação de matérias, tópicos e upload de materiais.
          </p>
        </div>
      </main>
    </div>
  );
}
