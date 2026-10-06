import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota LEGADA — a Explosão já morou em Estilo & Engenharia e em Entrada & Saída; hoje é a 1ª página do PCP
// (/pcp/explosao). Mantém links/bookmarks antigos de /criacao/explosao funcionando via redirect.
export const Route = createFileRoute("/_authenticated/criacao/explosao")({
  beforeLoad: () => {
    throw redirect({ to: "/pcp/explosao" });
  },
});
