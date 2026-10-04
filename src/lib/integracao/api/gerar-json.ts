// Integração › Produtos › "Gerar JSON" — orquestração PURA (dependências injetadas; o Worker injeta o supabase COM o JWT
// do usuário para as 2 RPCs e o service role SÓ para assinar fotos — `gerar-json.server.ts`). Fonte ÚNICA com a API:
// as fases 1½ (fotos da própria loja + links assinados), 2 (confirmar) e a montagem da resposta são `entregar()` de
// `rota.ts` — a mesma da rota `GET /api/integracao/v1/produtos` (modo normal). Aqui o modo é "manual" (P-249 B: gerar =
// entregar = integrar). Nunca lança para o cliente: o TanStack Start serializa um `Error` sem garantir `code`, e o
// `mensagemErro` precisa dele — tudo vira `{ ok: false, erro: { code, message } }`.
// Notas do revisor G-migration (OBRIGATÓRIAS): (1) o teto é do BANCO = min(100, máx. por página da loja) — nenhuma
// constante fixa decide aqui; (2) o `fora` NUNCA entra no arquivo (só no resultado, para a tela); (3) confirmar sem
// reserva válida volta `parametro_invalido` com HTTP 200 — é FALHA, não sucesso.
import { entregar, type Confirmacao, type DepsEntrega, type Entrega } from "./rota";
import type { ForaGerarJson, RespostaApi, RespostaLer } from "./resposta";

/** Teto ABSOLUTO por arquivo (o do banco é `least(100, max_por_pagina da loja)`; a loja pode ter menos). */
export const MAX_GERAR_JSON = 100;
export type EntradaGerarJson = { modelo_ids: string[]; loja: string };
export type ResultadoGerarJson =
  | { ok: true; vazio: true; fora: ForaGerarJson[] }
  | { ok: true; vazio: false; json: RespostaApi; novos: number; relidos: number; fora: ForaGerarJson[]; validadeFotoDias: number }
  | { ok: false; erro: { code: string; message: string } };
export type DepsGerarJson = {
  /** rpc integracao_gerar_json_ler (JWT do usuário) */
  ler: (e: EntradaGerarJson) => Promise<RespostaLer>;
  /** service role, SÓ storage */
  assinarFotos: DepsEntrega["assinarFotos"];
  /** rpc integracao_gerar_json_confirmar (JWT do usuário) */
  confirmar: (acessoId: string, entrega: Entrega) => Promise<Confirmacao>;
  agora: () => Date;
};

const FALHOU = { code: "ERRO_INTERNO", message: "gerar_json_falhou" } as const;

/** PostgrestError (objeto com `code`/`message` texto) → `{code, message}`; qualquer outra coisa → falha genérica (nunca vaza). */
function erroDe(e: unknown): { code: string; message: string } {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    if (typeof o.code === "string" && o.code !== "" && typeof o.message === "string") return { code: o.code, message: o.message };
  }
  return { ...FALHOU };
}

export async function gerarJson(e: EntradaGerarJson, deps: DepsGerarJson): Promise<ResultadoGerarJson> {
  try {
    const r = await deps.ler(e);
    // falha FECHADA: só o status ok do MODO manual segue (um drift de contrato nunca confirma por engano)
    if (!r || r.status !== "ok" || r.modo !== "manual") return { ok: false, erro: { ...FALHOU } };
    // cinto extra (o banco já garante `_loja` = loja ativa e devolve `tenant_id = v_tenant`): o service role assina fotos pelo
    // prefixo de `r.tenant_id`, então a fronteira fica fechada mesmo se o contrato mudar um dia
    if (r.tenant_id !== e.loja) return { ok: false, erro: { ...FALHOU } };
    const lidos = r.produtos ?? [];
    const foraBanco = Array.isArray(r.fora) ? r.fora : [];
    if (lidos.length === 0) return { ok: true, vazio: true, fora: foraBanco };
    const acessoId = r.acesso_id;
    if (typeof acessoId !== "string" || acessoId === "") return { ok: false, erro: { ...FALHOU } };
    const geradoEm = deps.agora().toISOString();
    const { conf, corpo } = await entregar(
      r, { assinarFotos: deps.assinarFotos, confirmar: (en) => deps.confirmar(acessoId, en) }, geradoEm,
    );
    // `parametro_invalido` (reserva inexistente/velha/de outro usuário) chega com HTTP 200 — é falha, nada foi entregue
    if (conf.status !== "ok" || !corpo) return { ok: false, erro: { code: "P0001", message: "gerar_json_falhou: confirmacao" } };
    // corrida "todos mudaram" (voltaram/foram desfeitos entre a leitura e a confirmação): nada foi integrado nem há o que
    // baixar — cai no "nenhum produto entrou" da tela, nunca num arquivo vazio com o texto "já constam como Integrado"
    const confirmados = new Set(conf.confirmados.map((c) => c.modelo_id));
    const chaves = r.chaves_colunas ?? [];
    const iNome = chaves.indexOf("nome");
    const iRef = chaves.indexOf("ref_sku");
    const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
    const mudou: ForaGerarJson[] = lidos
      .filter((p) => !confirmados.has(p.modelo_id))
      .map((p) => {
        const linha = p.linhas.find((l) => l.tipo === "produto");
        return {
          modelo_id: p.modelo_id,
          nome: iNome >= 0 ? texto(linha?.valores[iNome]) : null,
          ref: iRef >= 0 ? texto(linha?.valores[iRef]) : null,
          motivo: "mudou" as const,
        };
      });
    if (confirmados.size === 0) return { ok: true, vazio: true, fora: [...foraBanco, ...mudou] };
    return {
      ok: true, vazio: false, json: corpo, novos: conf.novos ?? 0, relidos: conf.relidos ?? 0,
      fora: [...foraBanco, ...mudou], validadeFotoDias: r.validade_foto_dias ?? 7,
    };
  } catch (err) {
    return { ok: false, erro: erroDe(err) };
  }
}

/** O que atravessa a rede (server function → tela). O tipo do `json` (campos dinâmicos `[campo: string]: unknown`) não passa
 *  pela checagem de serialização do TanStack Start, então o Worker manda o TEXTO já formatado (o MESMO que o diálogo
 *  mostra, baixa e copia — `JSON.stringify(json, null, 2)` uma única vez) + `gerado_em` (nome do arquivo). Sem `fora` no texto. */
export type ResultadoGerarJsonRede =
  | { ok: true; vazio: true; fora: ForaGerarJson[] }
  | { ok: true; vazio: false; texto: string; geradoEm: string; novos: number; relidos: number; fora: ForaGerarJson[]; validadeFotoDias: number }
  | { ok: false; erro: { code: string; message: string } };
export function resultadoParaRede(r: ResultadoGerarJson): ResultadoGerarJsonRede {
  if (!r.ok || r.vazio) return r;
  return {
    ok: true, vazio: false, texto: JSON.stringify(r.json, null, 2), geradoEm: r.json.gerado_em, novos: r.novos, relidos: r.relidos,
    fora: r.fora, validadeFotoDias: r.validadeFotoDias,
  };
}
