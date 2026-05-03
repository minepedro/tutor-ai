import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Home } from '@/pages/Home';
import { Onboarding } from '@/pages/Onboarding';
import { Settings } from '@/pages/Settings';
import { SubjectView } from '@/pages/SubjectView';
import { TopicView } from '@/pages/TopicView';
import { QuizSetup } from '@/pages/QuizSetup';
import { QuizPlay } from '@/pages/QuizPlay';
import { QuizResults } from '@/pages/QuizResults';
import { ROUTES } from '@/lib/constants';

export function App() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    window.api.settings.hasApiKey().then(setHasKey);
  }, []);

  // Ainda verificando — mostra tela em branco (evita flash de rota errada)
  if (hasKey === null) {
    return <div className="h-full bg-bg" />;
  }

  return (
    <HashRouter>
      <Routes>
        {/* Onboarding: acessível sempre, mas se já tem chave redireciona para Home */}
        <Route
          path={ROUTES.ONBOARDING}
          element={
            hasKey ? (
              <Navigate to={ROUTES.HOME} replace />
            ) : (
              <Onboarding onComplete={() => setHasKey(true)} />
            )
          }
        />

        {/* App principal: exige API key — sem ela, volta para onboarding */}
        <Route
          element={hasKey ? <AppLayout /> : <Navigate to={ROUTES.ONBOARDING} replace />}
        >
          <Route path={ROUTES.HOME} element={<Home />} />
          <Route path={ROUTES.SUBJECT_VIEW} element={<SubjectView />} />
          <Route path={ROUTES.TOPIC_VIEW} element={<TopicView />} />
          <Route path={ROUTES.QUIZ_SETUP} element={<QuizSetup />} />
          <Route path={ROUTES.QUIZ_PLAY} element={<QuizPlay />} />
          <Route path={ROUTES.QUIZ_RESULTS} element={<QuizResults />} />
          <Route path={ROUTES.SETTINGS} element={<Settings />} />
        </Route>

        {/* Rota não encontrada → raiz */}
        <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
      </Routes>
    </HashRouter>
  );
}
