import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

  // staleTime fica em 0 (padrão): VÁRIOS editores hidratam o formulário via
  // side-effect no queryFn (setDraft/setItems dentro do queryFn). Com staleTime>0,
  // reabrir o mesmo registro dentro da janela servia cache SEM rodar o queryFn,
  // deixando o form no estado vazio e o Salvar sobrescrevia com vazio (perda de
  // dados — Planejamento, OCs, etc.). Não reintroduzir staleTime global sem antes
  // migrar essas hidratações de queryFn->useEffect.
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
