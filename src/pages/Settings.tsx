import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ROUTES } from '@/lib/constants';
import { useIPC } from '@/hooks/useIPC';
import type { EncryptionStatus } from '@/types/ipc';

export function Settings() {
  const api = useIPC();
  const navigate = useNavigate();

  const [newKey, setNewKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const [encryptionStatus, setEncryptionStatus] = useState<EncryptionStatus | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api.settings.getEncryptionStatus().then(setEncryptionStatus);
  }, [api]);

  async function handleSaveKey() {
    setKeyError('');
    setKeySaved(false);

    if (!newKey.startsWith('sk-ant-')) {
      setKeyError('A API key da Anthropic começa com "sk-ant-".');
      return;
    }

    setSavingKey(true);
    try {
      await api.settings.saveApiKey(newKey);
      setNewKey('');
      setKeySaved(true);
    } catch (err: unknown) {
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      await api.settings.clearAll();
      navigate(ROUTES.ONBOARDING);
    } catch {
      setClearing(false);
      setShowClearModal(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="Configurações" />

      <main className="flex flex-col gap-6 p-6">
        {/* API Key */}
        <Card>
          <h2 className="font-sans text-sm font-semibold text-text">API Key da Anthropic</h2>
          <p className="mt-1 font-sans text-xs text-text-muted">
            Para alterar, cole a nova chave abaixo e salve.
            {encryptionStatus === 'os-backed' && (
              <span className="ml-1 text-success">🔒 Armazenada encriptada pelo SO.</span>
            )}
            {encryptionStatus === 'unavailable' && (
              <span className="ml-1 text-warning">⚠️ Encriptação do SO indisponível neste sistema.</span>
            )}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Input
              type="password"
              placeholder="sk-ant-api03-..."
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              error={keyError}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
            />
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveKey} loading={savingKey} size="sm">
                Salvar nova chave
              </Button>
              {keySaved && (
                <span className="font-sans text-xs text-success">✓ Salvo</span>
              )}
            </div>
          </div>
        </Card>

        {/* Dados */}
        <Card>
          <h2 className="font-sans text-sm font-semibold text-text">Dados locais</h2>
          <p className="mt-1 font-sans text-xs text-text-muted">
            Todos os dados (banco de dados, materiais, modelo de IA, histórico) ficam
            salvos localmente em <code className="font-mono">%APPDATA%\tutor-ai\</code>.
          </p>
          <div className="mt-4">
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowClearModal(true)}
            >
              Limpar todos os dados
            </Button>
          </div>
        </Card>
      </main>

      <Modal
        open={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Limpar todos os dados?"
        confirmLabel="Sim, limpar tudo"
        confirmVariant="danger"
        onConfirm={handleClearAll}
        confirmLoading={clearing}
      >
        <p>
          Esta ação vai apagar permanentemente todos os seus materiais, quizzes,
          flashcards, histórico de conversas e o modelo de busca semântica.
        </p>
        <p className="mt-2 font-medium text-text">
          Não é possível desfazer esta ação.
        </p>
      </Modal>
    </div>
  );
}
