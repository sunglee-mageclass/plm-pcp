import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota ANTIGA — a Explosão agora é a 1ª página do PCP (urgentes R9). Mantém links/bookmarks antigos funcionando.
export const Route = createFileRoute("/_authenticated/entrada-saida/explosao")({
  beforeLoad: () => {
    throw redirect({ to: "/pcp/explosao" });
  },
});
