export const ROUTES = {
  ONBOARDING: '/onboarding',
  HOME: '/',
  SETTINGS: '/settings',
  /** Padrão usado no <Route />. Para navegar, use `subjectViewPath(id)`. */
  SUBJECT_VIEW: '/subjects/:id',
  /** Padrão usado no <Route />. Para navegar, use `topicViewPath(id)`. */
  TOPIC_VIEW: '/topics/:id',
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
