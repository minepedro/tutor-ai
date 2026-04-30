import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

/*
  AppLayout é o "shell" do app: sidebar fixa à esquerda + área de conteúdo à direita.
  O <Outlet /> é onde o React Router renderiza a página atual (Home, Settings, etc.).
  Quando a rota mudar, só o Outlet re-renderiza — a Sidebar permanece estável.
*/
export function AppLayout() {
  return (
    <div className="flex h-full bg-bg">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
