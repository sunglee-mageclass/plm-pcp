// Integração — API `GET /api/integracao/v1/produtos` (spec §7, R7). Handler PURO com dependências injetadas (a rota real
// injeta Supabase service role + Workers — Task 20). Fluxo: teto por IP (binding) → chave (Bearer; ausente = hash de vazio,
// que registra a tentativa) → parâmetros → _integracao_ler (fase 1) → fotos: prefixo da loja (inv. #2) + links assinados
// (validade_foto_dias) → _integracao_confirmar (fase 2) → responde SÓ os confirmados → limpeza de 90 dias FORA do caminho
// (n4/D20). Erros: corpo ASCII mínimo; nunca a chave, nunca texto interno (nem em 500).
import { lerParametros } from "./parametros";
import { CAMINHO_FOTO_EXEMPLO, caminhosFoto, montarResposta, type RespostaLer } from "./resposta";

export type Confirmacao = { status: string; confirmados: { modelo_id: string; integrado_em: string }[] };
export type DepsRota = {
  hashChave: (chave: string) => Promise<string>;
  ler: (a: { hash: string; incluir: boolean; cursor: string | null; limite: number | null; modo: "normal" | "teste"; ip: string }) => Promise<RespostaLer>;
  assinarFotos: (caminhos: string[], validadeSegundos: number) => Promise<Map<string, string | null>>;
  confirmar: (chaveId: string, acessoId: string, entrega: { produtos: { modelo_id: string; assinatura: string | null }[]; fotos_descartadas: number; fotos_ausentes: number }) => Promise<Confirmacao>;
  limpar: (tenantId: string | null) => Promise<void>;
  depois: (p: Promise<unknown>) => void;
  tetoIp: (ip: string) => Promise<boolean>;
  agora: () => Date;
  origem: string;
};
export const CABECALHOS_JSON = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } as const;

export function respostaErro(status: number, erro: string, retryAfter?: number | null): Response {
  const h: Record<string, string> = { ...CABECALHOS_JSON };
  if (retryAfter != null) h["retry-after"] = String(Math.max(1, Math.ceil(retryAfter)));
  return new Response(JSON.stringify({ erro }), { status, headers: h });
}
const HTTP: Record<string, number> = {
  parametro_invalido: 400, chave_invalida: 401, loja_inativa: 403, ip_bloqueado: 429, limite_excedido: 429,
};

export async function tratarRequisicao(req: Request, deps: DepsRota): Promise<Response> {
  try {
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "desconhecido").trim().slice(0, 64);
    if (!(await deps.tetoIp(ip))) return respostaErro(429, "limite_excedido", 60);
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    const chave = m ? m[1] : "";
    const p = lerParametros(new URL(req.url));
    if (!p) return respostaErro(400, "parametro_invalido");
    const r = await deps.ler({ hash: await deps.hashChave(chave), incluir: p.incluir, cursor: p.cursor, limite: p.limite, modo: p.modo, ip });
    if (r.status !== "ok") {
      deps.depois(deps.limpar(r.tenant_id ?? null));
      return respostaErro(HTTP[r.status] ?? 500, HTTP[r.status] ? r.status : "erro_interno", r.retry_after ?? null);
    }
    const geradoEm = deps.agora().toISOString();
    if (r.modo === "teste") {
      const corpo = montarResposta(r, { geradoEm, foto: (c) => c.map(() => `${deps.origem}${CAMINHO_FOTO_EXEMPLO}`) });
      deps.depois(deps.limpar(r.tenant_id ?? null));
      return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
    }
    // Fase 1½ — fotos: só caminhos da PRÓPRIA loja (inv. #2); o resto é descartado e contado.
    const idxFoto = (r.chaves_colunas ?? []).indexOf("foto");
    const prefixo = `${r.tenant_id}/`;
    let descartadas = 0;
    const validos: string[] = [];
    if (idxFoto >= 0) {
      for (const pr of r.produtos ?? []) {
        for (const l of pr.linhas) {
          if (l.tipo !== "produto") continue;
          for (const c of caminhosFoto(l.valores, idxFoto)) {
            if (c.startsWith(prefixo)) validos.push(c);
            else descartadas += 1;
          }
        }
      }
    }
    const unicos = [...new Set(validos)];
    const links = unicos.length > 0 ? await deps.assinarFotos(unicos, (r.validade_foto_dias ?? 7) * 86400) : new Map<string, string | null>();
    const ausentes = unicos.filter((c) => !links.get(c)).length;
    // Fase 2 — confirmar: marca integrado SÓ o que ainda está integrável com a MESMA assinatura.
    const conf = await deps.confirmar(r.chave_id ?? "", r.acesso_id ?? "", {
      produtos: (r.produtos ?? []).map((pr) => ({ modelo_id: pr.modelo_id, assinatura: pr.assinatura })),
      fotos_descartadas: descartadas, fotos_ausentes: ausentes,
    });
    if (conf.status !== "ok") return respostaErro(HTTP[conf.status] ?? 500, HTTP[conf.status] ? conf.status : "erro_interno");
    const ok = new Map(conf.confirmados.map((c) => [c.modelo_id, c.integrado_em]));
    const corpo = montarResposta(r, {
      geradoEm,
      foto: (c) => c.map((x) => (x.startsWith(prefixo) ? (links.get(x) ?? null) : null)),
      incluir: (id) => ok.has(id),
      integradoEm: (id) => ok.get(id) ?? null,
    });
    deps.depois(deps.limpar(r.tenant_id ?? null));
    return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
  } catch {
    return respostaErro(500, "erro_interno");
  }
}
