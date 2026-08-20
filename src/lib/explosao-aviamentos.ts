// Agregação (pura) do bloco "Aviamentos necessários" da Explosão.
//
// A Explosão é POR MODELO. Este helper pega as linhas de `modelo_aviamentos` (BOM) de um
// modelo — com o aviamento e a variante embedados — e agrega por AVIAMENTO × VARIANTE
// (`variante_aviamento_id`), somando o consumo por peça e derivando:
//   • quantidade NECESSÁRIA = Σ consumo × grade total do modelo — a MESMA fórmula que o
//     `_enviar_modelo_para_cad_core` usa ao copiar o BOM p/ o CAD (`ROUND(consumo*grade,4)`).
//   • quantidade a SEPARAR/ENVIAR = espelha o passo de separação do TECIDO. No tecido é a
//     coluna editável `cad_tecido_variantes.metragem_enviada`; no aviamento o equivalente é
//     `cad_aviamentos.quantidade_separar` (a "Qtd a Enviar" da tela CAD / Ficha Técnica),
//     inicializada = necessária no envio ao CAD e ajustável no PCP > CAD. Como o
//     `cad_aviamentos` NÃO é destrinchado por variante (a coluna `variante_aviamento_id`
//     dele ainda não é preenchida — item 2 pendente), atribuímos o valor por ENTRADA do
//     BOM via o par 1:1 (aviamento_id, numero) — que o envio ao CAD preserva — e somamos por
//     (aviamento, variante). Sem entrada no CAD (aviamento adicionado ao BOM após o envio) o
//     "a separar" cai no default do fluxo = a necessária daquela linha.
//
// ⚠️ LACUNA CONHECIDA (reportada): não existe hoje um registro de separação POR VARIANTE de
// aviamento — a régua vigente rastreia "a separar" por entrada de aviamento no CAD. A coluna
// aqui é a MELHOR derivação possível sobre o dado existente, sem inventar persistência nova.
//
// Fonte da variante/consumo = `modelo_aviamentos` (é onde a variante é preenchida, itens 1/2).
// Aviamento legado SEM variante vira uma linha "Sem variante" (chave "__sem__") — nunca some.
// Puro e sem React → testável isoladamente (tests/unit/explosao-aviamentos).

import { varianteLabel } from "@/lib/variante";

export type ModeloAviamentoEmbedRow = {
  aviamento_id: string | null;
  variante_aviamento_id: string | null;
  numero?: number | null;
  consumo: number | string | null;
  aviamentos?: { codigo_nome?: string | null } | null;
  variantes_aviamento?: {
    nome_variante?: string | null;
    codigo_variante?: string | null;
    cor?: { nome: string | null } | null;
    apelido?: { nome: string | null } | null;
  } | null;
};

export type AviVarLinha = {
  key: string;
  variante_aviamento_id: string | null;
  /** Rótulo pronto via src/lib/variante (cor - apelido) ou "Sem variante" (legado). */
  label: string;
  /** Nome da cor base, só p/ o swatch (o banco não guarda hex). */
  cor?: string | null;
  /** Σ do consumo por peça das linhas do BOM com este aviamento×variante. */
  consumo: number;
  /** consumo × grade total do modelo (qtd necessária p/ toda a grade). */
  quantidade: number;
  /** Qtd a separar/enviar (do `cad_aviamentos.quantidade_separar`, atribuída por entrada). */
  aSeparar: number;
};

export type AviGrupo = {
  aviamento_id: string;
  aviamento_nome: string;
  linhas: AviVarLinha[];
  totalQtd: number;
  totalSeparar: number;
};

const SEM_VARIANTE = "Sem variante";

/** Chave do par BOM↔CAD por entrada de aviamento: `${aviamento_id}:${numero}`. */
export function chaveEntradaAviamento(aviamentoId: string | null, numero: number | null | undefined): string {
  return `${aviamentoId ?? ""}:${numero ?? ""}`;
}

export function agruparAviamentosExplosao(
  rows: ModeloAviamentoEmbedRow[],
  gradeTotalGeral: number,
  /** Map `${aviamento_id}:${numero}` → cad_aviamentos.quantidade_separar. Ausente ⇒ default. */
  separarPorEntrada?: Map<string, number>,
): AviGrupo[] {
  const byAvi = new Map<string, { nome: string; vars: Map<string, AviVarLinha> }>();

  for (const r of rows) {
    const aviId = r.aviamento_id;
    if (!aviId) continue;
    const grupo = byAvi.get(aviId) ?? { nome: r.aviamentos?.codigo_nome ?? "—", vars: new Map() };
    const vid = r.variante_aviamento_id ?? null;
    const vkey = vid ?? "__sem__";
    const v = r.variantes_aviamento;
    const linha =
      grupo.vars.get(vkey) ??
      ({
        key: vkey,
        variante_aviamento_id: vid,
        label: vid
          ? varianteLabel({ nome: v?.nome_variante, cor: v?.cor?.nome, apelido: v?.apelido?.nome })
          : SEM_VARIANTE,
        cor: v?.cor?.nome ?? null,
        consumo: 0,
        quantidade: 0,
        aSeparar: 0,
      } as AviVarLinha);
    const consumoLinha = Number(r.consumo ?? 0);
    linha.consumo += consumoLinha;
    // "A separar" por ENTRADA (aviamento_id, numero); default = necessária daquela linha.
    const sep = separarPorEntrada?.get(chaveEntradaAviamento(aviId, r.numero ?? null));
    linha.aSeparar += sep ?? consumoLinha * gradeTotalGeral;
    grupo.vars.set(vkey, linha);
    byAvi.set(aviId, grupo);
  }

  const grupos: AviGrupo[] = [];
  byAvi.forEach((g, aviId) => {
    const linhas = [...g.vars.values()].map((l) => ({ ...l, quantidade: l.consumo * gradeTotalGeral }));
    // Com variante primeiro (rótulo pt-BR); "Sem variante" (legado) por último.
    linhas.sort((a, b) => {
      const aSem = a.variante_aviamento_id == null;
      const bSem = b.variante_aviamento_id == null;
      if (aSem !== bSem) return aSem ? 1 : -1;
      return a.label.localeCompare(b.label, "pt-BR");
    });
    grupos.push({
      aviamento_id: aviId,
      aviamento_nome: g.nome,
      linhas,
      totalQtd: linhas.reduce((s, l) => s + l.quantidade, 0),
      totalSeparar: linhas.reduce((s, l) => s + l.aSeparar, 0),
    });
  });
  // Grupos por nome do aviamento (pt-BR).
  grupos.sort((a, b) => a.aviamento_nome.localeCompare(b.aviamento_nome, "pt-BR"));
  return grupos;
}
