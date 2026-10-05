import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // staleTime fica em 0 (padrão). Historicamente VÁRIOS editores hidratavam o formulário via
  // side-effect no queryFn (setDraft/setItems dentro do queryFn) e, com staleTime>0, reabrir o mesmo
  // registro servia cache SEM rodar o queryFn (form vazio + Salvar sobrescrevendo = perda de dados).
  // Hoje NENHUM queryFn faz setState (a hidratação roda em useEffect/`hydrated`, ver CLAUDE.md), mas
  // não reintroduzir staleTime global sem uma revisão de cada tela: a re-hidratação só pode mesclar.
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
