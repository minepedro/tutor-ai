export const ROUTES = {
  ONBOARDING: '/onboarding',
  HOME: '/',
  /** Chat fullscreen (v0.8.0+). Escopo default: global (todos os PDFs). */
  CHAT: '/chat',
  SETTINGS: '/settings',
  /** Padrão usado no <Route />. Para navegar, use `subjectViewPath(id)`. */
  SUBJECT_VIEW: '/subjects/:id',
  /** Padrão usado no <Route />. Para navegar, use `topicViewPath(id)`. */
  TOPIC_VIEW: '/topics/:id',
  /** Padrão usado no <Route />. Para navegar, use `quizSetupPath(topicId)`. */
  QUIZ_SETUP: '/topics/:topicId/quiz/new',
  /** Padrão usado no <Route />. Para navegar, use `quizPlayPath(quizId)`. */
  QUIZ_PLAY: '/quizzes/:id/play',
  /** Padrão usado no <Route />. Para navegar, use `quizResultsPath(quizId)`. */
  QUIZ_RESULTS: '/quizzes/:id/results',
} as const;

/*
  💡 `as const` congela o objeto: os valores viram tipos literais em vez de `string`.
  Sem `as const`: ROUTES.HOME teria tipo `string`.
  Com `as const`:  ROUTES.HOME teria tipo `"/"` — o TS pode verificar rotas inválidas.
*/

/** Resolve a URL real para visualizar uma matéria específica. */
export function subjectViewPath(id: string): string {
  return `/subjects/${id}`;
}

/** Resolve a URL real para visualizar um tópico específico. */
export function topicViewPath(id: string): string {
  return `/topics/${id}`;
}

/** URL para configurar e gerar novo quiz do tópico. */
export function quizSetupPath(topicId: string): string {
  return `/topics/${topicId}/quiz/new`;
}

/** URL para jogar o quiz. */
export function quizPlayPath(quizId: string): string {
  return `/quizzes/${quizId}/play`;
}

/** URL para ver resultado/revisão do quiz. */
export function quizResultsPath(quizId: string): string {
  return `/quizzes/${quizId}/results`;
}
