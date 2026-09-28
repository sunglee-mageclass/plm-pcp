// Integração — API pública da loja (spec §7): GET /api/integracao/v1/produtos, Authorization: Bearer <chave>. Molde:
// src/routes/sitemap[.]xml.ts. Import DINÂMICO do servidor (D30): o bundle do navegador nunca leva o service role.
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/integracao/v1/produtos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { tratarGet } = await import("@/lib/integracao/api/rota.server");
        return tratarGet(request);
      },
    },
  },
});
