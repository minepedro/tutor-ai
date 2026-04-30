import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { ROUTES } from '@/lib/constants';
import { useIPC } from '@/hooks/useIPC';

interface Props {
  onComplete: () => void;
}

/*
  Estados do fluxo:
  - 'form'        → mostrando o input da API key
  - 'saving'      → salvando a chave (rápido, só feedback de loading no botão)
  - 'downloading' → baixando o modelo ONNX, com barra de progresso
*/
type Phase = 'form' | 'saving' | 'downloading';

export function Onboarding({ onComplete }: Props) {
  const api = useIPC();
  const navigate = useNavigate();

  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Iniciando download…');

  /*
    💡 useEffect com função de cleanup. `api.setup.onProgress` retorna uma
    função que desregistra o listener; chamamos no return para evitar leak
    quando o componente desmontar (e duplicação se rerenderizar).
  */
  useEffect(() => {
    const unsubscribe = api.setup.onProgress((pct, status) => {
      setProgress(pct);
      setProgressLabel(status);
    });
    return unsubscribe;
  }, [api]);

  async function handleSaveKey() {
    setError('');

    if (!apiKey.startsWith('sk-ant-')) {
      setError('A API key da Anthropic começa com "sk-ant-". Verifique e tente novamente.');
      return;
    }

    setPhase('saving');
    try {
      await api.settings.saveApiKey(apiKey);

      // Se o modelo já foi baixado antes (npm run setup-models, ou sessão anterior
      // que falhou só na navegação), pula direto para Home.
      const ready = await api.setup.isModelReady();
      if (!ready) {
        setPhase('downloading');
        await api.setup.downloadModel();
      }

      onComplete();
      navigate(ROUTES.HOME);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('form');
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <Card className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-3xl">🎓</p>
          <h1 className="mt-3 font-sans text-xl font-semibold text-text">
            Bem-vindo ao tutor<span className="text-accent">.ai</span>
          </h1>
          <p className="mt-1 font-sans text-sm text-text-muted">
            {phase === 'downloading'
              ? 'Preparando o modelo de busca semântica…'
              : 'Conecte sua conta Anthropic para começar'}
          </p>
        </div>

        {phase === 'downloading' ? (
          <div className="flex flex-col gap-3">
            <Progress value={progress} />
            <p className="text-center font-sans text-xs text-text-muted">
              {progressLabel}
            </p>
            <p className="text-center font-sans text-xs text-text-subtle">
              ~30 MB. Acontece só uma vez — depois fica salvo no seu computador.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Input
              label="API Key da Anthropic"
              type="password"
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              error={error}
              hint='Acesse console.anthropic.com → "API Keys" para gerar a sua'
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
              disabled={phase === 'saving'}
            />
            <Button
              onClick={handleSaveKey}
              loading={phase === 'saving'}
              className="w-full"
            >
              Salvar e continuar
            </Button>
            <p className="text-center font-sans text-xs text-text-subtle">
              A chave é armazenada encriptada no seu computador e nunca sai dele.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
