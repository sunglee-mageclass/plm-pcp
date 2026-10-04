// Integração › Gerar JSON — dependências REAIS (só no servidor/Worker; `.server.ts`: importar o service role no topo é
// seguro — o front só chega aqui por `import()` dinâmico dentro do handler de `gerar-json.functions.ts`).
// ler/confirmar rodam com o cliente do USUÁRIO (JWT — a permissão e a loja são do BANCO: `_integracao_exige(true)` + `_loja`);
// o service role só assina as fotos do bucket "modelos" (a MESMA função da API: `assinarFotosModelos`, em `fotos.server.ts`).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Confirmacao } from "./rota";
import type { RespostaLer } from "./resposta";
import { assinarFotosModelos } from "./fotos.server";
import type { DepsGerarJson } from "./gerar-json";

export function depsGerarJson(supabase: SupabaseClient): DepsGerarJson {
  return {
    ler: async (e) => {
      const { data, error } = await (supabase as any).rpc("integracao_gerar_json_ler", { _modelo_ids: e.modelo_ids, _loja: e.loja });
      if (error) throw error;
      return data as RespostaLer;
    },
    assinarFotos: assinarFotosModelos,
    confirmar: async (acessoId, entrega) => {
      const { data, error } = await (supabase as any).rpc("integracao_gerar_json_confirmar", { _acesso_id: acessoId, _entrega: entrega });
      if (error) throw error;
      return data as Confirmacao;
    },
    agora: () => new Date(),
  };
}
