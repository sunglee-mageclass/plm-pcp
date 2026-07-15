import { describe, it, expect } from "vitest";
import { hasDb, withTx, um } from "./db";

// Hardening de RPC (audit de saúde jul/2026) — invariante #9: funções SECURITY DEFINER NÃO
// podem ficar executáveis por anon (o default ACL concede a PUBLIC, e anon herda). Duas destas
// ESCREVEM (otb_salvar_colecao, set_empresa_categorias) e o null-check por tenant não barra anon
// (get_user_tenant_id devolve sentinela, não NULL). Trava: anon=false, authenticated=true.
const RPCS: Array<[string, string]> = [
  ["otb_salvar_colecao", "jsonb"],
  ["set_empresa_categorias", "jsonb, uuid[]"],
  ["servico_aprovacao_por_modelo", "uuid[]"],
  ["avaliar_condicoes_kanban", "uuid[]"],
];

describe.skipIf(!hasDb)("RPCs DEFINER não executáveis por anon (invariante #9)", () => {
  it.each(RPCS)("%s: anon bloqueado, authenticated permitido", async (fn, args) => {
    await withTx(async (c) => {
      const sig = `public.${fn}(${args})`;
      const row = await um<{ anon_x: boolean; auth_x: boolean }>(
        c,
        `select has_function_privilege('anon', $1, 'EXECUTE') anon_x,
                has_function_privilege('authenticated', $1, 'EXECUTE') auth_x`,
        [sig],
      );
      expect(row.anon_x).toBe(false);
      expect(row.auth_x).toBe(true);
    });
  });
});
