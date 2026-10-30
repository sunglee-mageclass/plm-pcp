import type { ReactNode } from "react";
import type { OcDocGrade, OcDocModelo } from "@/components/shared/OcDocumentoPrint";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { totaisDaOc, totaisDoItem, type ItemOcPa } from "./itens";
import { fmtDate, fmtMoney, TAM_ACESSORIO, type CabecalhoDraft } from "./shared";

/**
 * Documento imprimível (Pedido de Compra) da OC de Produto Acabado COM VÁRIOS produtos (R13): uma matriz cor × tamanho POR PRODUTO
 * (`grades`) + a tabela de valores com o total do pedido. Puro: serve ao botão Imprimir do Sheet (rascunho vivo) e ao ícone da linha da
 * lista (OC relida do servidor). É sempre o PEDIDO (qtd pedida + valores previstos), nunca o recebido.
 */
export function montarDocModeloOcPa(o: {
  numero: string | null;
  cabecalho: Pick<CabecalhoDraft, "data_pedido" | "data_prevista" | "prazo_pagamento" | "parcelas_entrega">;
  empresaNome: string | null;
  representanteNome: string | null;
  itens: ReadonlyArray<Pick<ItemOcPa, "nome_produto" | "produtoRef" | "grupo_id" | "variantes" | "grade" | "grade_proporcao" | "qtd_total" | "valor_unitario" | "desconto_pct">>;
  /** Colunas de tamanho da loja (item acessório usa só "UN"). */
  tamanhos: ReadonlyArray<string>;
  grupoNome: (id: string | null) => string | null;
  corNome: (id: string | null) => string | null;
  apelidoNome: (id: string | null) => string | null;
  emitidoEm: string;
}): OcDocModelo {
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
      valores: [{ descricao: it.nome_produto || "Produto — todas as cores/tamanhos", qtd: `${geral} pç`, precoUnit: fmtMoney(tt.unitReal), subtotal: fmtMoney(tt.total) }],
    };
  });
  const c = o.cabecalho;
  return {
    numero: o.numero || "—",
    familiaLabel: "Produto Acabado (Revenda)",
    emitidoEm: o.emitidoEm || fmtDate(new Date().toISOString()),
    fornecedor: [{ k: "Empresa", v: o.empresaNome ?? "—" }, { k: "Representante", v: o.representanteNome ?? "—" }],
    dados: [
      { k: "Data do pedido", v: c.data_pedido ? fmtDate(c.data_pedido) : "—" },
      { k: "Entrega prevista", v: c.data_prevista ? fmtDate(c.data_prevista) : "—" },
      { k: "Pagamento", v: c.prazo_pagamento ? `${c.prazo_pagamento}${c.parcelas_entrega ? ` · ${c.parcelas_entrega} parcela(s)` : ""}` : "—" },
    ],
    grades,
    totalPrevisto: fmtMoney(totaisDaOc(o.itens).total),
  };
}
