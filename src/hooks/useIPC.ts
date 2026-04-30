/*
  Wrapper fino em volta de `window.api`.

  Por que existe? Dois motivos:
  1. Centraliza o acesso ao IPC — se a interface mudar, muda aqui só.
  2. Garante que o hook só seja usado dentro do Electron (onde window.api existe).
     Fora do Electron (ex: testes unitários rodando no Node) window.api não existe
     e o hook lança um erro claro em vez de um cryptic "cannot read property of undefined".
*/
export function useIPC() {
  if (!window.api) {
    throw new Error(
      'window.api não encontrado. useIPC só pode ser usado dentro do Electron.',
    );
  }
  return window.api;
}
