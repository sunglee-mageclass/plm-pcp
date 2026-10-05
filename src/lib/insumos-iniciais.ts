// urg R2 T12 — insumos padrão da loja (`tenant_config.insumos_padrao`) na CRIAÇÃO de card interno pelo cliente:
// "+ Novo" (rascunho até o Salvar) e "Criar vários cards". Puro (sem React/Supabase): testado em
// tests/unit/insumos-novo-dialog.test.ts. A regra de leitura espelha o helper do servidor `_insumos_padrao_aplicar`
// (item ruim é IGNORADO, nunca derruba a criação) e a fixture `tests/fixtures/insumos-padrao-casos.ts`.
// ⚠️ Não confundir com `normalizarInsumosPadrao`/`validarInsumosPadrao` da Config da Loja (T11, `src/lib/insumos-padrao.ts`):
// aquelas RECUSAM a lista inteira ao gravar; esta aqui é a leitura TOLERANTE, item a item.
import type {
  EtiquetaInfo,
  ModeloEtiquetaRow,
} from "@/components/desenvolvimento/modelo-detail/types";
import { recomputeEtiqueta } from "@/components/desenvolvimento/modelo-detail/types";

/** = limite do editor de insumos do card e da RPC `salvar_insumos_iniciais` (e da lista da Config). */
export const LIMITE_INSUMOS_INICIAIS = 20;

export type InsumoPadraoLinha = { etiqueta_id: string; cor_id: string | null; consumo: number };
export type PayloadInsumoInicial = InsumoPadraoLinha & { loss_percent: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Número finito com no máximo `casas` casas decimais (conta o VALOR, não a grafia: 1.10 vale). */
function temNoMaximoCasas(n: number, casas: number): boolean {
  return Number(n.toFixed(casas)) === n;
}

/**
 * Lista CRUA da loja → linhas do card. Item a item: não-objeto, insumo fora do formato, consumo que não é número de 0 a 9999
 * com ≤ 4 casas e par (insumo, cor) repetido (fica o 1º) são IGNORADOS em silêncio; insumo que NÃO está no catálogo da loja
 * (apagado/de outra loja) é ÓRFÃO — fica de fora e é contado (aviso âmbar). Cor fora das variantes do insumo vira `null`.
 * No máximo 20 linhas válidas. Valor que não é lista => vazio. Nunca lança.
 */
export function normalizarInsumosPadraoParaCard(
  raw: unknown,
  etiquetaMap: Record<string, Pick<EtiquetaInfo, "variantes">>,
): { linhas: InsumoPadraoLinha[]; orfaos: number } {
  if (!Array.isArray(raw)) return { linhas: [], orfaos: 0 };
  const linhas: InsumoPadraoLinha[] = [];
  const vistos = new Set<string>();
  let orfaos = 0;
  for (const it of raw) {
    if (!ehObjeto(it)) continue;
    const eid =
      typeof it.etiqueta_id === "string" && UUID.test(it.etiqueta_id)
        ? it.etiqueta_id.toLowerCase()
        : null;
    if (!eid) continue;
    const consumo = it.consumo;
    if (
      typeof consumo !== "number" ||
      !Number.isFinite(consumo) ||
      consumo < 0 ||
      consumo > 9999 ||
      !temNoMaximoCasas(consumo, 4)
    )
      continue;
    let cor: string | null;
    if (it.cor_id === undefined || it.cor_id === null || it.cor_id === "") cor = null;
    else if (typeof it.cor_id === "string" && UUID.test(it.cor_id)) cor = it.cor_id.toLowerCase();
    else continue;
    const chave = `${eid}|${cor ?? ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const etq = etiquetaMap[eid];
    if (!etq) {
      orfaos += 1;
      continue;
    }
    if (linhas.length >= LIMITE_INSUMOS_INICIAIS) continue;
    const corValida =
      cor !== null && (etq.variantes ?? []).some((v) => (v.cor_id ?? "").toLowerCase() === cor);
    linhas.push({ etiqueta_id: eid, cor_id: corValida ? cor : null, consumo });
  }
  return { linhas, orfaos };
}

/** Aviso âmbar da seção Insumos do Dialog Novo. Vazio quando não há órfãos. */
export function textoOrfaosInsumosPadrao(n: number): string {
  if (n <= 0) return "";
  return n === 1
    ? "1 insumo padrão não existe mais no cadastro e ficou de fora."
    : `${n} insumos padrão não existem mais no cadastro e ficaram de fora.`;
}

/** Linhas normalizadas → linhas do editor (`ModeloEtiquetaRow`): perda 0 e custo previsto da etiqueta. */
export function linhasParaRascunho(
  linhas: InsumoPadraoLinha[],
  etiquetaMap: Record<string, EtiquetaInfo>,
): ModeloEtiquetaRow[] {
  return linhas.map((l) =>
    recomputeEtiqueta(
      {
        etiqueta_id: l.etiqueta_id,
        cor_id: l.cor_id,
        consumo: l.consumo,
        loss_percent: 0,
        custo_previsto: 0,
      },
      etiquetaMap,
    ),
  );
}

/**
 * Rascunho do editor → `_linhas` da RPC `salvar_insumos_iniciais`. Linha sem insumo escolhido sai; consumo com ≤ 4 casas e perda
 * com ≤ 2 (a RPC RECUSA mais casas — arredondar aqui evita perder o card inteiro por uma digitação longa); no máximo 20.
 */
export function payloadInsumosIniciais(rows: ModeloEtiquetaRow[]): PayloadInsumoInicial[] {
  const out: PayloadInsumoInicial[] = [];
  for (const r of rows) {
    if (!r.etiqueta_id) continue;
    out.push({
      etiqueta_id: r.etiqueta_id,
      cor_id: r.cor_id ?? null,
      consumo: Number((Number(r.consumo) || 0).toFixed(4)),
      loss_percent: Number((Number(r.loss_percent) || 0).toFixed(2)),
    });
    if (out.length >= LIMITE_INSUMOS_INICIAIS) break;
  }
  return out;
}

/** Seção "Insumos" do Dialog "Novo Modelo": só card NOVO e só origem interna; o Salvar espera a lista (P-57, Ruling A12b). */
export function estadoSecaoInsumosNovo(o: {
  isEdit: boolean;
  origem: string | null | undefined;
  carregando: boolean;
  erro: boolean;
  lojaPronta: boolean;
}): { visivel: boolean; bloqueiaSalvar: boolean } {
  const visivel = !o.isEdit && (o.origem ?? "interno") === "interno";
  return { visivel, bloqueiaSalvar: visivel && (o.carregando || o.erro || !o.lojaPronta) };
}

type RpcFn = (nome: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;

/**
 * Passo do Salvar do card NOVO: grava o rascunho de insumos logo após o INSERT real (e depois dos tecidos). Devolve quantas
 * linhas foram enviadas (0 = nada a fazer: lista vazia ou origem comprada). Falha => lança com `etapaFalha = "insumos"` (o card
 * JÁ existe — o `onError` do Salvar avisa sem criar de novo).
 */
export async function gravarInsumosIniciaisDoCard(o: {
  modeloId: string;
  origem: string | null | undefined;
  linhas: ModeloEtiquetaRow[];
  rpc: RpcFn;
}): Promise<number> {
  if ((o.origem ?? "interno") !== "interno") return 0;
  const payload = payloadInsumosIniciais(o.linhas);
  if (payload.length === 0) return 0;
  const { error } = await o.rpc("salvar_insumos_iniciais", {
    _modelo_id: o.modeloId,
    _linhas: payload,
  });
  if (error) {
    const e: any = typeof error === "object" && error ? error : new Error(String(error));
    e.etapaFalha = "insumos";
    throw e;
  }
  return payload.length;
}

/**
 * "Criar vários cards": para cada card criado (todos internos), grava a lista normalizada da loja (perda 0). Sequencial; uma
 * falha (erro da RPC ou exceção de rede) NÃO para as outras — vira entrada em `falhas`.
 */
export async function aplicarInsumosPadraoEmLote(
  ids: string[],
  linhas: InsumoPadraoLinha[],
  rpc: RpcFn,
): Promise<{ aplicados: number; falhas: { id: string; erro: unknown }[] }> {
  const falhas: { id: string; erro: unknown }[] = [];
  if (linhas.length === 0 || ids.length === 0) return { aplicados: 0, falhas };
  const payload: PayloadInsumoInicial[] = linhas
    .slice(0, LIMITE_INSUMOS_INICIAIS)
    .map((l) => ({ ...l, loss_percent: 0 }));
  let aplicados = 0;
  for (const id of ids) {
    try {
      const { error } = await rpc("salvar_insumos_iniciais", { _modelo_id: id, _linhas: payload });
      if (error) falhas.push({ id, erro: error });
      else aplicados += 1;
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { aplicados, falhas };
}

/** Texto do ÚNICO toast do "Criar vários cards". `comInsumos` = havia lista para aplicar. */
export function resumoToastLote(
  criados: number,
  aplicados: number,
  falhas: number,
  comInsumos = false,
): { tipo: "success" | "warning"; texto: string } {
  const base = `${criados} ${criados === 1 ? "card criado" : "cards criados"}`;
  if (falhas > 0) {
    const onde = criados === 1 ? "no card" : falhas === 1 ? "em 1 deles" : `em ${falhas} deles`;
    return {
      tipo: "warning",
      texto: `${base}, mas os insumos padrão não entraram ${onde} — adicione na seção Insumos do card.`,
    };
  }
  if (comInsumos && aplicados > 0)
    return { tipo: "success", texto: `${base}, com os insumos padrão da loja` };
  return { tipo: "success", texto: base };
}

const MOTIVOS_INVALIDOS: [RegExp, string][] = [
  [/insumo nao encontrado/, "o insumo não existe mais no cadastro"],
  [/cor nao encontrada/, "a cor não existe mais no cadastro"],
  [/perda precisa/, "a perda precisa ser um número de 0 a 100"],
  [/perda com no maximo 2/, "a perda aceita no máximo 2 casas decimais"],
  [/consumo com no maximo 4/, "o consumo aceita no máximo 4 casas decimais"],
  [/consumo precisa/, "o consumo precisa ser um número de 0 a 9999"],
  [/no maximo 20/, "são no máximo 20 insumos"],
  [/formato invalido/, "formato inválido"],
];

/** Prefixos ASCII (P0001) da RPC `salvar_insumos_iniciais` → texto PT. null = não é desta RPC. */
export function mensagemInsumosIniciais(code: string, msg: string): string | null {
  if (code !== "P0001") return null;
  if (msg.startsWith("insumos_iniciais_so_interno:"))
    return "Os insumos padrão só entram em produto de fabricação própria (interno).";
  if (msg.startsWith("insumos_iniciais_ja_existem:"))
    return "Este card já tem insumos — os insumos padrão só entram em card sem insumos.";
  if (msg.startsWith("insumos_iniciais_invalidos:")) {
    const linha = /linha (\d+)/.exec(msg)?.[1];
    const motivo = MOTIVOS_INVALIDOS.find(([re]) => re.test(msg))?.[1];
    const onde = linha ? `Linha ${linha}: ` : "";
    return motivo
      ? `${onde}${motivo}. Confira a seção Insumos.`
      : "Os insumos informados são inválidos. Confira a seção Insumos.";
  }
  if (msg.startsWith("funcao_desativada: salvar_insumos_iniciais"))
    return "Os insumos iniciais estão desativados no momento. Adicione-os pela seção Insumos do card.";
  if (msg.startsWith("nao_encontrado: modelo"))
    return "O card não foi encontrado nesta loja. Recarregue a tela.";
  return null;
}
