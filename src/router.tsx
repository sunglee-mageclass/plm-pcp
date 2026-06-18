import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // staleTime padrão: evita o refetch-storm em CADA montagem/foco de janela
  // (antes era 0 = tudo sempre "stale" -> refazia toda query ao navegar e ao
  // trocar de loja). Mutações continuam chamando invalidateQueries/setQueryData
  // nas suas chaves, então dados editados NÃO ficam velhos; só reusa o cache por
  // até 30s em navegação normal. (rec. #3c do diagnóstico.)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
