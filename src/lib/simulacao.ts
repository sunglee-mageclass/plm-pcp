// Cálculo puro do Simulador de Uso de OC (sem I/O; testável).
// Espelha a distribuição do editor PV (splitEven) e a metragem de consumo_por_oc.

/** Reparte um inteiro igualmente em n baldes; o resto vai pros primeiros. */
export const splitEven = (total: number, n: number): number[] => {
  if (n <= 0) return [];
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
};

/** Metragem do item de OC: kg converte por rendimento; unidade em metro é direto. */
export const metragemDisponivel = (unidadeMedida: string | null, quantidade: number, rendimento: number | null): number =>
  (unidadeMedida === "kg" ? (quantidade || 0) * (rendimento || 0) : (quantidade || 0));

/** Peças de uma linha = profundidade × cores (Orçamento: cores = 1). */
export const pecasLinha = (profCor: number, cores: number): number => (profCor || 0) * (cores || 0);

/** Demanda (m) de uma linha = Σ dos modelos (peças × consumo). Sem perda. */
export const demandaLinha = (profCor: number, cores: number, consumos: number[]): number => {
  const p = pecasLinha(profCor, cores);
  return consumos.reduce((s, c) => s + p * (c || 0), 0);
};

/** Saldo = disponível − demanda (≥0 sobra, <0 estoura). */
export const saldo = (disponivel: number, demanda: number): number => (disponivel || 0) - (demanda || 0);

/** Distribui `num` nas semanas dadas (chaves string), via splitEven. */
export const distribuirNasSemanas = (num: number, semanas: number[]): Record<string, number> => {
  const shares = splitEven(num, semanas.length);
  const out: Record<string, number> = {};
  semanas.forEach((w, i) => { out[String(w)] = shares[i] ?? 0; });
  return out;
};

// ── Agregação de uso de OC entre subcoleções (para o resumo fixo do Simulador) ──
// A demanda de uma unidade (subcoleção) é a MESMA para toda cor escolhida (Σ prof×consumo
// por linha). Quando a mesma OC+cor é usada em várias subcoleções, o uso da cor é a SOMA
// das demandas dessas unidades — para saber se a metragem daquela cor (item da OC) dá conta
// do total. Função pura (sem labels/I/O); o componente resolve o rótulo da cor pelo ocItemId.

export type UnidadeUsoInput = {
  ocId: string | null;
  variantes: { ocItemId: string }[];
  linhas: { profCor: number; modelos: { consumo: number; profPorCor?: Record<string, number>; profModelo?: number; gradePorCor?: Record<string, number> }[] }[];
};

/** Retorna a profundidade efetiva para a cor `ocItemId`:
 *  1) override manual por cor (profPorCor)
 *  2) grade real da cor pelo variante_tecido_id (gradePorCor)
 *  3) grade geral do modelo (profModelo)
 *  4) base da linha (baseProfCor) */
export const effProf = (
  modelo: { profPorCor?: Record<string, number>; profModelo?: number; gradePorCor?: Record<string, number> },
  baseProfCor: number,
  ocItemId: string,
  ocVarTecId?: string | null,
): number =>
  modelo.profPorCor?.[ocItemId] ??
  (ocVarTecId ? modelo.gradePorCor?.[ocVarTecId] : undefined) ??
  modelo.profModelo ??
  baseProfCor;
export type OcUsoInput = {
  id: string;
  numero_pedido: string | null;
  itens: { id: string; quantidade_pedida: number | null; variante_tecido_id?: string | null; artigo: { unidade_medida: string | null; rendimento: number | null } | null }[];
};
export type CorUso = { ocItemId: string; disp: number; dem: number; saldo: number };
export type OcUso = { ocId: string; numero: string | null; cores: CorUso[]; totalDisp: number; totalDem: number; totalSaldo: number; ok: boolean };

/** Demanda de uma unidade (mesma p/ toda cor) = Σ linhas prof×Σconsumos. */
export const demandaUnidade = (u: UnidadeUsoInput): number =>
  u.linhas.reduce((s, l) => s + demandaLinha(l.profCor, 1, l.modelos.map((m) => m.consumo || 0)), 0);

/** Agrega o uso por OC e por cor (item), somando a demanda entre subcoleções.
 *  Cada cor pode ter profundidade diferente via `effProf` (override por linha×cor). */
export function agregarUsoOC(unidades: UnidadeUsoInput[], ocs: OcUsoInput[]): OcUso[] {
  const ocMap = new Map(ocs.map((o) => [o.id, o]));
  const demByKey = new Map<string, number>(); // `${ocId}|${ocItemId}` -> demanda somada
  const coresByOc = new Map<string, string[]>(); // ocId -> ocItemIds (ordem de 1º uso)

  for (const u of unidades) {
    if (!u.ocId) continue;
    for (const v of u.variantes) {
      const ocVarTecId = ocMap.get(u.ocId!)?.itens.find((it) => it.id === v.ocItemId)?.variante_tecido_id ?? null;
      const demCor = u.linhas.reduce(
        (s, l) => s + l.modelos.reduce((sm, mo) => sm + effProf(mo, l.profCor, v.ocItemId, ocVarTecId) * (mo.consumo || 0), 0),
        0
      );
      const key = `${u.ocId}|${v.ocItemId}`;
      demByKey.set(key, (demByKey.get(key) ?? 0) + demCor);
      const list = coresByOc.get(u.ocId) ?? [];
      if (!list.includes(v.ocItemId)) { list.push(v.ocItemId); coresByOc.set(u.ocId, list); }
    }
  }

  const out: OcUso[] = [];
  for (const [ocId, ocItemIds] of coresByOc) {
    const oc = ocMap.get(ocId);
    if (!oc) continue;
    let totalDisp = 0, totalDem = 0;
    const cores: CorUso[] = ocItemIds.map((ocItemId) => {
      const item = oc.itens.find((it) => it.id === ocItemId);
      const disp = item
        ? metragemDisponivel(item.artigo?.unidade_medida ?? null, Number(item.quantidade_pedida) || 0, Number(item.artigo?.rendimento) || 0)
        : 0;
      const dem = demByKey.get(`${ocId}|${ocItemId}`) ?? 0;
      totalDisp += disp; totalDem += dem;
      return { ocItemId, disp, dem, saldo: disp - dem };
    });
    out.push({ ocId, numero: oc.numero_pedido ?? null, cores, totalDisp, totalDem, totalSaldo: totalDisp - totalDem, ok: cores.every((c) => c.saldo >= 0) });
  }
  return out;
}
