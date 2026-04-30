export const ROUTES = {
  ONBOARDING: '/onboarding',
  HOME: '/',
  SETTINGS: '/settings',
} as const;

/*
  💡 `as const` congela o objeto: os valores viram tipos literais em vez de `string`.
  Sem `as const`: ROUTES.HOME teria tipo `string`.
  Com `as const`:  ROUTES.HOME teria tipo `"/"` — o TS pode verificar rotas inválidas.
*/
