// Integração — dependências REAIS da rota da API (só no servidor/Worker). Service role SÓ para as 3 funções `_integracao_*`
// (EXECUTE só de service_role — Task 6) e para assinar as fotos do bucket "modelos". O teto por IP é o binding `ratelimits`
// do Workers (INTEGRACAO_TETO_IP, 600/60 s — D23); fora do Workers (dev local, :5188) não há binding = sem teto.
// A limpeza de 90 dias roda com waitUntil quando o runtime oferece (fora do caminho da resposta — n4/D20).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RespostaLer } from "./resposta";
import { tratarRequisicao, type Confirmacao, type DepsRota } from "./rota";

type Workers = {
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
};
type Teto = { limit: (o: { key: string }) => Promise<{ success: boolean }> };

async function runtimeWorkers(): Promise<Workers | null> {
  try {
    const nome = "cloudflare:workers";
    return (await import(/* @vite-ignore */ nome)) as Workers;
  } catch {
    return null;
  }
}
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function tratarGet(request: Request): Promise<Response> {
  const cf = await runtimeWorkers();
  const teto = cf?.env?.INTEGRACAO_TETO_IP as Teto | undefined;
  const deps: DepsRota = {
    hashChave: async (chave) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chave))),
    ler: async (a) => {
      const { data, error } = await supabaseAdmin.rpc("_integracao_ler" as any, {
        _chave_hash: a.hash, _incluir_integrados: a.incluir, _cursor: a.cursor, _limite: a.limite, _modo: a.modo, _ip: a.ip,
      });
      if (error) throw error;
      return data as RespostaLer;
    },
    assinarFotos: async (caminhos, validade) => {
      const { data, error } = await supabaseAdmin.storage.from("modelos").createSignedUrls(caminhos, validade);
      if (error) throw error;
      return new Map((data ?? []).map((d) => [d.path ?? "", d.error ? null : (d.signedUrl ?? null)]));
    },
    confirmar: async (chaveId, acessoId, entrega) => {
      const { data, error } = await supabaseAdmin.rpc("_integracao_confirmar" as any, {
        _chave_id: chaveId, _acesso_id: acessoId, _entrega: entrega,
      });
      if (error) throw error;
      return data as Confirmacao;
    },
    limpar: async (tenant) => {
      await supabaseAdmin.rpc("_integracao_limpar" as any, { _tenant: tenant });
    },
    depois: (p) => {
      const seguro = p.catch(() => undefined);
      if (typeof cf?.waitUntil === "function") cf.waitUntil(seguro);
    },
    tetoIp: async (ip) => (teto ? (await teto.limit({ key: ip })).success : true),
    agora: () => new Date(),
    origem: new URL(request.url).origin,
  };
  return tratarRequisicao(request, deps);
}
