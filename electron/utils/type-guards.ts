/*
  Type guards genéricos usados em vários lugares.

  💡 Type guard = função que retorna `value is T`. O TS usa esse retorno
  pra estreitar o tipo de `value` no escopo seguinte. Sem isso, você tem
  que usar `as Record<...>` em todo lugar e perde a checagem em tempo
  de compilação.
*/
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
