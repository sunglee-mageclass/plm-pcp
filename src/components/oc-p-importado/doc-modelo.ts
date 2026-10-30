import type { ReactNode } from "react";
import type { OcDocGrade, OcDocModelo } from "@/components/shared/OcDocumentoPrint";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { fmtMoeda } from "@/lib/moeda";
import { totaisDaOc, totaisDoItem, type ItemOcImp } from "./itens";
import { fmtDate, TAM_ACESSORIO, type CabecalhoImpDraft } from "./shared";

/**
 * Documento imprimível (Pedido de Compra) da OC de Produto Importado COM VÁRIOS produtos (R13): uma matriz cor × tamanho POR PRODUTO
 * (`grades`) + a tabela de valores com o total do pedido. Puro: serve ao botão Imprimir do Sheet (rascunho vivo) e ao ícone da linha da
 * lista (OC relida do servidor). É sempre o PEDIDO (qtd pedida + valores previstos), nunca o recebido.
 *
 * Os valores do pedido saem na MOEDA DA COMPRA (M1) — a moeda em que o fornecedor cobra. O custo landed (BRL) é derivado no servidor
 * (`custo_unitario_landed_real` do cabeçalho) e só aparece como informação, quando já foi calculado: a impressão NUNCA recalcula landed.
 */
export function montarDocModeloOcImp(o: {
  numero: string | null;
  cabecalho: Pick<CabecalhoImpDraft, "data_pedido" | "data_prevista" | "moeda_compra" | "moeda_intermediaria">;
  /** Custo landed unitário médio da OC (BRL), como o servidor gravou; 0/null = ainda não calculado (não aparece). */
  landedUnitarioOc: number | null;
  empresaNome: string | null;
  representanteNome: string | null;
  itens: ReadonlyArray<Pick<ItemOcImp, "nome_produto" | "produtoRef" | "grupo_id" | "variantes" | "grade" | "grade_proporcao" | "qtd_total" | "valor_unitario_m1" | "desconto_pct">>;
  /** Colunas de tamanho da loja (item acessório usa só "UN"). */
  tamanhos: ReadonlyArray<string>;
  grupoNome: (id: string | null) => string | null;
  corNome: (id: string | null) => string | null;
  apelidoNome: (id: string | null) => string | null;
  emitidoEm: string;
}): OcDocModelo {
  const moeda = o.cabecalho.moeda_compra;
  const grades: OcDocGrade[] = o.itens.map((it) => {
    const tams = ehGrupoAcessorio(o.grupoNome(it.grupo_id)) ? [TAM_ACESSORIO] : [...o.tamanhos];
    const linhas = it.variantes.map((v) => {
      const g = it.grade[String(v.ordem)] ?? {};
      const celulas: Record<string, ReactNode> = {};
      let totalLin = 0;
      for (const t of tams) { const ped = Number(g[t]?.pedida ?? 0); celulas[t] = ped || "—"; totalLin += ped; }
      return {
        cor: varianteLabel({ cor: o.corNome(v.cor_id), apelido: o.apelidoNome(v.cor_apelido_id) }) || `Variante ${v.ordem}`,
        celulas, total: totalLin,
      };
    });
    const totalPorTamanho: Record<string, ReactNode> = {};
    let geral = 0;
    for (const t of tams) {
      let s = 0;
      for (const v of it.variantes) s += Number(it.grade[String(v.ordem)]?.[t]?.pedida ?? 0);
      totalPorTamanho[t] = s; geral += s;
    }
    const proporcao: Record<string, ReactNode> = {};
    for (const t of tams) proporcao[t] = it.grade_proporcao[t] ?? "—";
    const tt = totaisDoItem(it);
    return {
      produtoTitulo: `Produto: ${it.nome_produto || "—"}${it.produtoRef ? ` (REF ${it.produtoRef})` : ""}`,
      tamanhos: tams, proporcao, linhas, totalPorTamanho, totalGeral: geral,
      valores: [{ descricao: it.nome_produto || "Produto — todas as cores/tamanhos", qtd: `${geral} pç`, precoUnit: fmtMoeda(tt.unitReal, moeda), subtotal: fmtMoeda(tt.total, moeda) }],
    };
  });
  const c = o.cabecalho;
  const dados: OcDocModelo["dados"] = [
    { k: "Data do pedido", v: c.data_pedido ? fmtDate(c.data_pedido) : "—" },
    { k: "Entrega prevista", v: c.data_prevista ? fmtDate(c.data_prevista) : "—" },
    { k: "Moeda da compra", v: `${moeda}${c.moeda_intermediaria ? ` → ${c.moeda_intermediaria}` : ""}` },
  ];
  if (Number(o.landedUnitarioOc) > 0) dados.push({ k: "Custo landed unit.", v: fmtMoeda(Number(o.landedUnitarioOc), "BRL") });
  return {
    numero: o.numero || "—",
    familiaLabel: "Produto Importado",
    emitidoEm: o.emitidoEm || fmtDate(new Date().toISOString()),
    fornecedor: [{ k: "Empresa", v: o.empresaNome ?? "—" }, { k: "Representante", v: o.representanteNome ?? "—" }],
    dados,
    grades,
    totalPrevisto: fmtMoeda(totaisDaOc(o.itens).total, moeda),
  };
}
