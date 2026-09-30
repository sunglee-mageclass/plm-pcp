// Preço anterior e Título por VERSÃO (P-146..P-159; plano .superpowers/sdd/2026-09-30-preco-anterior/plan.md §1.4). PURO.
// A regra de FAMÍLIA (qual é a versão anterior, o preço dela e o título herdado recursivo) mora SÓ no SQL
// (`public._modelo_versao_anterior`, lido pela RPC `modelos_versao_anterior`). Este módulo só COMPÕE o automático a partir
// da linha que o servidor devolve — o MESMO que `public._modelo_automaticos` faz no retrato. Anti-drift: as fixtures de
// tests/fixtures/versao-anterior-casos.ts rodam aqui (tests/unit/versao-anterior.test.ts) e no SQL
// (tests/integration/preco-titulo-versao.test.ts). Mudou a regra? Mude o SQL (migration nova), este arquivo e as fixtures.
import { tituloPaginaCalculado } from "@/lib/titulo-pagina";

/** A versão anterior de um card (null = sem anterior: v1 ou órfã). */
export type VersaoAnteriorInfo = {
  anterior_versao: number;
  /** preco_venda GRAVADO da anterior quando > 0; null = a anterior ainda não tem preço (P-158: "aguardando"). */
  anterior_preco: number | null;
  /** título EFETIVO da anterior (recursivo); null só se nenhum nível tiver nome/título. */
  titulo_herdado: string | null;
  /** de qual versão o texto do título vem (≠ anterior_versao quando a anterior também herdou). */
  titulo_origem_versao: number | null;
} | null;

/** Linha da RPC `modelos_versao_anterior` (numeric chega como número ou texto). */
export type LinhaVersaoAnteriorRpc = {
  modelo_id: string;
  anterior_id: string | null;
  anterior_versao: number | null;
  anterior_preco: number | string | null;
  titulo_herdado: string | null;
  titulo_origem_versao: number | null;
};

const numOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** RB2 (G-plano delta v2): linha com `anterior_id` NULL = SEM anterior ⇒ `null` (regra da v1/órfã: o próprio preço).
 *  Nunca vira um "aguardando" falso num card órfão. */
export function infoDaLinha(l: LinhaVersaoAnteriorRpc | null | undefined): VersaoAnteriorInfo {
  if (!l || !l.anterior_id || l.anterior_versao === null || l.anterior_versao === undefined)
    return null;
  const preco = numOuNull(l.anterior_preco);
  return {
    anterior_versao: Number(l.anterior_versao),
    anterior_preco: preco !== null && preco > 0 ? preco : null,
    titulo_herdado: l.titulo_herdado ?? null,
    titulo_origem_versao: numOuNull(l.titulo_origem_versao),
  };
}
export function mapaVersaoAnterior(
  linhas: readonly LinhaVersaoAnteriorRpc[],
): Map<string, VersaoAnteriorInfo> {
  const m = new Map<string, VersaoAnteriorInfo>();
  for (const l of linhas) m.set(l.modelo_id, infoDaLinha(l));
  return m;
}

export type PrecoAnteriorAuto = {
  /** o valor automático exibido; null = vazio ("aguardando") */
  valor: number | null;
  fonte: "anterior" | "proprio";
  /** a versão de onde vem (só com anterior) */
  versao: number | null;
  /** vazio por falta de preço: da vN (P-158) ou do próprio preço de venda (v1/órfã — M4) */
  aguardando: boolean;
};
/** Preço anterior AUTOMÁTICO (NULL no banco). Com anterior: o preço de venda GRAVADO da anterior (> 0) — senão vazio,
 *  "aguardando preço da vN" (P-158; nunca o sugerido nem o próprio). Sem anterior (v1/órfã): o próprio preço de venda
 *  DIGITADO (> 0) — senão vazio, "aguardando preço de venda" (M4: espelha o retrato, que manda vazio). */
export function precoAnteriorAutomatico(
  info: VersaoAnteriorInfo,
  efetivoProprio: number | null | undefined,
): PrecoAnteriorAuto {
  if (info) {
    const v = info.anterior_preco !== null && info.anterior_preco > 0 ? info.anterior_preco : null;
    return { valor: v, fonte: "anterior", versao: info.anterior_versao, aguardando: v === null };
  }
  const p = Number(efetivoProprio);
  const v = Number.isFinite(p) && p > 0 ? p : null;
  return { valor: v, fonte: "proprio", versao: null, aguardando: v === null };
}

export type TituloAuto = {
  valor: string;
  fonte: "herdado" | "proprio";
  versao: number | null;
  origemVersao: number | null;
};
/** Título AUTOMÁTICO (NULL no banco). v2+: o título EFETIVO da versão anterior (herdado, recursivo — vem pronto do
 *  servidor); v1/órfã: o calculado do Nome (do RASCUNHO, ao vivo) + a loja, como sempre. */
export function tituloAutomatico(
  info: VersaoAnteriorInfo,
  nome: string | null | undefined,
  loja: string | null | undefined,
): TituloAuto {
  if (info) {
    return {
      valor: info.titulo_herdado ?? "",
      fonte: "herdado",
      versao: info.anterior_versao,
      origemVersao: info.titulo_origem_versao,
    };
  }
  return {
    valor: tituloPaginaCalculado(nome, loja),
    fonte: "proprio",
    versao: null,
    origemVersao: null,
  };
}

// ─────────────────────────── textos da tela (Sheet + Integração) ───────────────────────────
export type Selo = { texto: string; tom: "neutral" | "info" | "warning" };
/** Selo do Preço anterior: "editado" (digitado) · "acompanha o preço da versão anterior (vN)" · "aguardando preço da vN"
 *  · "automático" (v1 com preço) · "aguardando preço de venda" (v1 sem preço — M4). */
export function seloPrecoAnterior(
  fixado: number | null | undefined,
  auto: PrecoAnteriorAuto,
): Selo {
  if (fixado !== null && fixado !== undefined) return { texto: "editado", tom: "info" };
  if (auto.fonte === "anterior") {
    return auto.aguardando
      ? { texto: `aguardando preço da v${auto.versao}`, tom: "warning" }
      : { texto: `acompanha o preço da versão anterior (v${auto.versao})`, tom: "neutral" };
  }
  return auto.aguardando
    ? { texto: "aguardando preço de venda", tom: "warning" }
    : { texto: "automático", tom: "neutral" };
}
/** Dica (coluna Obs do Sheet) do Preço anterior automático. */
export function dicaPrecoAnterior(auto: PrecoAnteriorAuto): string {
  if (auto.fonte === "anterior") {
    return auto.aguardando
      ? `fica vazio até a v${auto.versao} ter preço de venda · ou digite um valor`
      : `preço de venda da v${auto.versao} até ser editado · ↺ volta ao automático`;
  }
  return auto.aguardando
    ? "fica vazio até ter um Preço de venda digitado (o sugerido não vai para a loja virtual) · ou digite um valor"
    : "acompanha o preço de venda até ser editado · ↺ volta ao automático";
}
/** Dica do Preço anterior DIGITADO (fixado à mão — não acompanha nada até o ↺). */
export const DICA_PRECO_ANTERIOR_EDITADO = "valor fixado à mão · ↺ volta ao automático";
/** Falha ao carregar a versão anterior (RPC com erro e SEM dado em cache): Título e Preço anterior automáticos ficam
 *  indisponíveis até "Tentar de novo" — nunca um "carregando" eterno (I1 da revisão front). */
export const TEXTO_FALHA_VERSAO_ANTERIOR = "Não foi possível carregar a versão anterior.";
/** Hover "travado pela Integração + automático". */
export function hoverPrecoAnteriorTravado(auto: PrecoAnteriorAuto): string {
  if (auto.fonte === "anterior") {
    return auto.aguardando
      ? `Automático: aguardando o Preço de venda da v${auto.versao} (fica vazio até ela ter preço), mesmo travado pela Integração.`
      : `Automático: acompanha o Preço de venda da v${auto.versao}, mesmo travado pela Integração.`;
  }
  return "Automático: acompanha o Preço de venda, mesmo travado pela Integração.";
}
/** Selo do Título automático: "herdado da vN" (v2+) ou "automático" (v1/órfã). */
export function seloTitulo(auto: TituloAuto): string {
  return auto.fonte === "herdado" ? `herdado da v${auto.versao}` : "automático";
}
/** Hover do selo "herdado": diz de qual versão o TEXTO vem quando a anterior também herdou. */
export function hoverTituloHerdado(auto: TituloAuto): string | null {
  if (auto.fonte !== "herdado") return null;
  if (auto.origemVersao !== null && auto.origemVersao !== auto.versao) {
    return `Segue o Título da v${auto.versao}, que também herdou: o texto vem da v${auto.origemVersao}.`;
  }
  return `Segue o Título da v${auto.versao} enquanto ninguém editar.`;
}
