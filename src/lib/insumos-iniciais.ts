// urg R2 T12 — insumos padrão da loja (`tenant_config.insumos_padrao`) na CRIAÇÃO de card interno pelo cliente:
// "+ Novo" (rascunho até o Salvar) e "Criar vários cards". Puro (sem React/Supabase): testado em
// tests/unit/insumos-novo-dialog.test.ts. A regra de leitura espelha o helper do servidor `_insumos_padrao_aplicar`
// (item ruim é IGNORADO, nunca derruba a criação) e a fixture `tests/fixtures/insumos-padrao-casos.ts`.
// O normalizador "para card" mora em `src/lib/insumos-padrao-normalizadores.ts` (ao lado do da Config da Loja, T11) e é reexportado aqui.
import type {
  EtiquetaInfo,
  ModeloEtiquetaRow,
} from "@/components/desenvolvimento/modelo-detail/types";
import { recomputeEtiqueta } from "@/components/desenvolvimento/modelo-detail/types";

export {
  LIMITE_INSUMOS_INICIAIS,
  normalizarInsumosPadraoParaCard,
} from "@/lib/insumos-padrao-normalizadores";
import { LIMITE_INSUMOS_INICIAIS, temNoMaximoCasas } from "@/lib/insumos-padrao-normalizadores";
import type { InsumoPadrao } from "@/lib/insumos-padrao";

export type InsumoPadraoLinha = InsumoPadrao;
export type PayloadInsumoInicial = InsumoPadraoLinha & { loss_percent: number };

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

/**
 * M3 (fix round 1) — confere o rascunho de insumos do Dialog "Novo Modelo" ANTES do INSERT, com mensagem por campo (a RPC só recusaria
 * depois de o card existir). Linha totalmente vazia (sem insumo, consumo 0, perda 0) é descartada; sem insumo mas com valor pede para
 * escolher o insumo. Devolve as linhas do payload (quando não há problema) e a lista de problemas em PT-BR.
 */
export function validarInsumosRascunho(rows: ModeloEtiquetaRow[]): {
  linhas: PayloadInsumoInicial[];
  problemas: string[];
} {
  const problemas: string[] = [];
  const linhas: PayloadInsumoInicial[] = [];
  let n = 0;
  rows.forEach((r, i) => {
    const consumo = Number(r.consumo) || 0;
    const perda = Number(r.loss_percent) || 0;
    const nome = `Insumo ${i + 1}`;
    if (!r.etiqueta_id) {
      if (consumo !== 0 || perda !== 0)
        problemas.push(`${nome}: escolha o insumo (ou remova a linha).`);
      return;
    }
    n += 1;
    const c = Number(r.consumo);
    if (!Number.isFinite(c) || c < 0 || c > 9999)
      problemas.push(`${nome}: o consumo precisa ficar entre 0 e 9999.`);
    else if (!temNoMaximoCasas(c, 4))
      problemas.push(`${nome}: o consumo aceita no máximo 4 casas decimais.`);
    const l = Number(r.loss_percent);
    if (!Number.isFinite(l) || l < 0 || l > 100)
      problemas.push(`${nome}: a perda precisa ficar entre 0 e 100.`);
    else if (!temNoMaximoCasas(l, 2))
      problemas.push(`${nome}: a perda aceita no máximo 2 casas decimais.`);
  });
  if (n > LIMITE_INSUMOS_INICIAIS)
    problemas.push(`No máximo ${LIMITE_INSUMOS_INICIAIS} insumos por card.`);
  if (problemas.length === 0) linhas.push(...payloadInsumosIniciais(rows));
  return { linhas, problemas };
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

/**
 * Texto do ÚNICO toast do "Criar vários cards". `comInsumos` = havia lista para aplicar; `orfaos` = itens da lista da loja que
 * ficaram de fora porque o insumo não existe mais (L1: não somem em silêncio).
 */
export function resumoToastLote(
  criados: number,
  aplicados: number,
  falhas: number,
  comInsumos = false,
  orfaos = 0,
): { tipo: "success" | "warning"; texto: string } {
  const base = `${criados} ${criados === 1 ? "card criado" : "cards criados"}`;
  const aviso = textoOrfaosInsumosPadrao(orfaos);
  if (falhas > 0) {
    const onde = criados === 1 ? "no card" : falhas === 1 ? "em 1 deles" : `em ${falhas} deles`;
    return {
      tipo: "warning",
      texto: `${base}, mas os insumos padrão não entraram ${onde} — adicione na seção Insumos do card.${aviso ? ` ${aviso}` : ""}`,
    };
  }
  if (comInsumos && aplicados > 0) {
    return aviso
      ? { tipo: "warning", texto: `${base}, com os insumos padrão da loja — ${aviso}` }
      : { tipo: "success", texto: `${base}, com os insumos padrão da loja` };
  }
  return aviso
    ? { tipo: "warning", texto: `${base} — ${aviso}` }
    : { tipo: "success", texto: base };
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
    return motivo ? `${onde}${motivo}.` : "Os insumos informados são inválidos.";
  }
  if (msg.startsWith("funcao_desativada: salvar_insumos_iniciais"))
    return "Os insumos iniciais estão desativados no momento. Adicione-os pela seção Insumos do card.";
  if (msg.startsWith("nao_encontrado: modelo"))
    return "O card não foi encontrado nesta loja. Recarregue a tela.";
  return null;
}
