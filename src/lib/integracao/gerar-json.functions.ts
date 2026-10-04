// Integração › Gerar JSON — server function (molde `tenant-admin.functions.ts`). Roda no Worker com o JWT do usuário
// (`requireSupabaseAuth` → `context.supabase`); a permissão (editar Integração) e a loja ativa são do BANCO, não do Worker:
// o Worker só valida o formato (zod) e o JWT. Import DINÂMICO do `.server`: o service role nunca vai ao bundle do navegador.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_GERAR_JSON, type ResultadoGerarJsonRede } from "@/lib/integracao/api/gerar-json";

export const gerarJsonIntegracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // `MAX_GERAR_JSON` é só o teto ABSOLUTO (formato); o teto real da loja (min(100, máx./página)) é conferido no banco
  .validator(z.object({ modelo_ids: z.array(z.string().uuid()).min(1).max(MAX_GERAR_JSON), loja: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<ResultadoGerarJsonRede> => {
    const { depsGerarJson } = await import("@/lib/integracao/api/gerar-json.server");
    const { gerarJson, resultadoParaRede } = await import("@/lib/integracao/api/gerar-json");
    return resultadoParaRede(await gerarJson(data, depsGerarJson(context.supabase)));
  });
