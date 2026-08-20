// Agregação (pura) do bloco "Aviamentos necessários" da Explosão.
//
// A Explosão é POR MODELO. Este helper pega as linhas de `modelo_aviamentos` (BOM) de um
// modelo — com o aviamento e a variante embedados — e agrega por AVIAMENTO × VARIANTE
// (`variante_aviamento_id`), somando o consumo por peça e derivando:
//   • quantidade NECESSÁRIA = Σ consumo × grade total do modelo — a MESMA fórmula que o
//     `_enviar_modelo_para_cad_core` usa ao copiar o BOM p/ o CAD (`ROUND(consumo*grade,4)`).
//   • quantidade a SEPARAR/ENVIAR = espelha o passo de separação do TECIDO. No tecido é a
//     coluna editável `cad_tecido_variantes.metragem_enviada`; no aviamento o equivalente é
//     `cad_aviamentos.quantidade_separar` — que AGORA é POR aviamento×variante (o
//     `_enviar_modelo_para_cad_core` passou a copiar `variante_aviamento_id`, + backfill;
//     migration 20260820160000). Por isso a "a separar" é atribuída DIRETO por
//     (aviamento_id, variante_aviamento_id): o mapa `separarPorVariante` traz a SOMA do
//     `quantidade_separar` das entradas do CAD daquele grupo (várias entradas do mesmo
//     aviamento×variante somam). A chave PRESENTE no mapa (mesmo com valor 0) é o valor
//     salvo; a chave AUSENTE (grupo sem entrada no CAD) cai no default = necessária do grupo.
//     A gravação (RPC `salvar_explosao_aviamento_separar`) é o espelho editável dessa coluna.
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
  /** Qtd a separar/enviar (Σ `cad_aviamentos.quantidade_separar` do grupo aviamento×variante;
   *  default = necessária quando o grupo não tem entrada no CAD). Editável na Explosão. */
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

/** Chave do grupo por aviamento×variante: `${aviamento_id}:${variante_aviamento_id|"__sem__"}`. */
export function chaveVarianteAviamento(aviamentoId: string | null, varId: string | null | undefined): string {
  return `${aviamentoId ?? ""}:${varId ?? "__sem__"}`;
}

export function agruparAviamentosExplosao(
  rows: ModeloAviamentoEmbedRow[],
  gradeTotalGeral: number,
  /** Map `${aviamento_id}:${variante_aviamento_id|"__sem__"}` → Σ cad_aviamentos.quantidade_separar.
   *  Chave PRESENTE (mesmo 0) ⇒ valor salvo; AUSENTE ⇒ default = necessária do grupo. */
  separarPorVariante?: Map<string, number>,
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
    linha.consumo += Number(r.consumo ?? 0);
    grupo.vars.set(vkey, linha);
    byAvi.set(aviId, grupo);
  }

  const grupos: AviGrupo[] = [];
  byAvi.forEach((g, aviId) => {
    // "A separar" por GRUPO (aviamento×variante): valor salvo (chave presente, mesmo 0) ou
    // default = necessária. Mapa vazio ⇒ tudo cai no default (espelha o metragem do tecido).
    const linhas = [...g.vars.values()].map((l) => {
      const quantidade = l.consumo * gradeTotalGeral;
      const salvo = separarPorVariante?.get(chaveVarianteAviamento(aviId, l.variante_aviamento_id));
      return { ...l, quantidade, aSeparar: salvo ?? quantidade };
    });
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
