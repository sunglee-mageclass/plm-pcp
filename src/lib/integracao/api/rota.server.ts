// Integração — dependências REAIS da rota da API (só no servidor/Worker). Service role SÓ para as 3 funções `_integracao_*`
// (EXECUTE só de service_role — Task 6) e para assinar as fotos do bucket "modelos". O teto por IP é o binding `ratelimits`
// do Workers (INTEGRACAO_TETO_IP, 600/60 s — D23); vite.config.ts carrega @cloudflare/vite-plugin tanto em dev quanto
// em build, então tanto o dev local quanto a produção rodam dentro de workerd/Miniflare (CR-M4) — a única forma
// legítima de "sem teto" é o binding em si estar ausente do wrangler.jsonc daquele ambiente (ex.: o wrangler do
// app-teste da Task 20b, que não declara `ratelimits`), não a falha do import do módulo builtin.
// A limpeza de 90 dias roda com waitUntil quando o runtime oferece (fora do caminho da resposta — n4/D20).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RespostaLer } from "./resposta";
import { chaveTetoIp, respostaErro, tratarRequisicao, type Confirmacao, type DepsRota } from "./rota";

type Workers = {
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
};
type Teto = { limit: (o: { key: string }) => Promise<{ success: boolean }> };

// Opus-I1 (fix round 1): import LITERAL (sem variável, sem a pragma de ignorar o vite) — o plugin do Cloudflare
// externaliza `cloudflare:*` e o build valida o especificador. Fora do Workers (Node/vitest) este import lança de
// propósito; quem chama decide o que fazer com o throw (aqui: falhar fechado, nunca voltar `null` silenciosamente).
// Sem @cloudflare/workers-types (nenhuma dependência nova) o TS não conhece o builtin "cloudflare:workers" — o
// cast mínimo local abaixo (não uma declaração de módulo global) tipa só o resultado, sem mudar o especificador.
async function runtimeWorkers(): Promise<Workers> {
  // @ts-expect-error TS2307: builtin "cloudflare:workers" (sem @cloudflare/workers-types instalado — Opus-I1
  // pede especificador literal, não uma dependência nova). Resolvido de verdade pelo runtime (workerd/Miniflare).
  return (await import("cloudflare:workers")) as Workers;
}
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function tratarGet(request: Request): Promise<Response> {
  // Opus-I1: se o runtime "cloudflare:workers" falhar em resolver (nunca deveria, dentro do Worker — ver
  // comentário do topo), falha FECHADO com o mesmo 500 JSON ASCII do handler puro, em vez de deixar o throw
  // escapar para o error middleware genérico do Start (HTML, fora do contrato da API). Isolado do try/catch de
  // tratarRequisicao porque roda ANTES dele (monta as deps que tratarRequisicao recebe prontas).
  let cf: Workers;
  try {
    cf = await runtimeWorkers();
  } catch {
    return respostaErro(500, "erro_interno");
  }
  const teto = cf.env?.INTEGRACAO_TETO_IP as Teto | undefined;
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
      if (typeof cf.waitUntil === "function") cf.waitUntil(seguro);
    },
    // M1 (ruling FAIL OPEN): um throw do binding de rate limit (transitório, ex. indisponibilidade momentânea)
    // não pode derrubar a API inteira — o banco continua sendo o limitador de verdade (limite por CHAVE +
    // bloqueio por IP de chave errada, ambos em _integracao_ler). Sem binding (ambiente sem `ratelimits`) também
    // é "sem teto" (D23). A chave do bucket usa chaveTetoIp (M3): agrupa IPv6 por /64, o IP INTEIRO continua indo
    // pro banco em `ler`.
    tetoIp: async (ip) => {
      if (!teto) return true;
      try {
        return (await teto.limit({ key: chaveTetoIp(ip) })).success;
      } catch {
        return true;
      }
    },
    agora: () => new Date(),
    origem: new URL(request.url).origin,
  };
  return tratarRequisicao(request, deps);
}
