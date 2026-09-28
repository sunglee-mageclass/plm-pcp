// Integração — API pública da loja (spec §7): GET /api/integracao/v1/produtos, Authorization: Bearer <chave>. Molde:
// src/routes/sitemap[.]xml.ts. Import DINÂMICO do servidor (D30): o bundle do navegador nunca leva o service role.
// Fix round 1 CR-I1: sem um handler HEAD explícito, o TanStack Start reusa o handler GET e só corta o corpo da
// resposta depois (start-server-core/createStartHandler.js: `requestMethod === "HEAD" ? handlers["HEAD"] ??
// handlers["GET"] ...`) — um HEAD com chave válida rodaria a fase 2 (confirmar) e integraria produtos de verdade
// sem entregar o corpo. HEAD e ANY (demais métodos) respondem 405 aqui mesmo, SEM importar rota.server: nenhum dos
// dois pode alcançar o service role.
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const CABECALHOS_405 = {
  "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
  allow: "GET",
} as const;

export const Route = createFileRoute("/api/integracao/v1/produtos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { tratarGet } = await import("@/lib/integracao/api/rota.server");
        return tratarGet(request);
      },
      HEAD: () => new Response(null, { status: 405, headers: CABECALHOS_405 }),
      ANY: () => new Response(JSON.stringify({ erro: "metodo_invalido" }), { status: 405, headers: CABECALHOS_405 }),
    },
  },
});
