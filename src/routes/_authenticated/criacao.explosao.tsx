import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota LEGADA — a Explosão foi realocada para Entrada & Saída (/entrada-saida/explosao).
// Mantém links/bookmarks antigos de /criacao/explosao funcionando via redirect.
export const Route = createFileRoute("/_authenticated/criacao/explosao")({
  beforeLoad: () => {
    throw redirect({ to: "/entrada-saida/explosao" });
  },
});
