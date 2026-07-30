import type { PtArvore, PtSlot, PtVariante } from "./types";

/** Tecidos/forros já usados pelos cards da coleção (distinct artigo_id + papel), p/ a paleta. */
export function tecidosDaArvore(arvore: PtArvore): { artigo_id: string; papel: string }[] {
  const seen = new Set<string>();
  const out: { artigo_id: string; papel: string }[] = [];
  for (const sub of arvore.subcolecoes ?? [])
    for (const ln of sub.linhas ?? [])
      for (const slot of ln.slots ?? [])
        for (const m of slot.materiais ?? []) {
          if (!m.artigo_id) continue;
          const papel = m.tipo === "forro" ? "forro" : "tecido";
          const k = `${m.artigo_id}|${papel}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ artigo_id: m.artigo_id, papel });
        }
  return out;
}

export function custoMateriaisPrevisto(slot: PtSlot): number {
  // Σ (material.consumo × material.preco_por_metro) — ignores material without preco
  return (slot.materiais ?? []).reduce((sum, mat) => {
    if (!mat.preco_por_metro) return sum;
    return sum + (Number(mat.consumo) || 0) * Number(mat.preco_por_metro);
  }, 0);
}

/** Metragem para exibição — pt-BR, DECIMAL (até 2 casas), nunca arredonda pra inteiro (a metragem
 *  de tecido é fracionária: consumo m/pç × grade). Ex.: 126.8 → "126,8"; 900 → "900". */
export const fmtMetros = (n: number): string =>
  (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const necessidadeVariante = (consumo: number, gradeTotal: number, mult: number): number =>
  (Number(consumo) || 0) * (Number(gradeTotal) || 0) * (Number(mult) || 0);

/** Metros de necessidade de UM slot, filtrando os materiais por papel (tecido/forro/qualquer). */
export function slotMetros(slot: PtSlot, papel?: "tecido" | "forro"): number {
  let m = 0;
  for (const mat of slot.materiais ?? []) {
    if (papel === "tecido" && mat.tipo === "forro") continue;
    if (papel === "forro" && mat.tipo !== "forro") continue;
    for (const v of mat.variantes ?? []) m += necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
  }
  return m;
}

export const metrosParaKg = (metros: number, rendimento: number | null): number =>
  rendimento && rendimento > 0 ? (Number(metros) || 0) / rendimento : 0;

export const abaterEstoque = (necessidadeMetros: number, estoqueMetros: number): number =>
  Math.max(0, (Number(necessidadeMetros) || 0) - (Number(estoqueMetros) || 0));

/** Chave estável da variante — usa variante_tecido_id real ou, se cor só-planejada, cor+apelido. */
export const varKey = (v: PtVariante): string =>
  v.variante_tecido_id ?? `plan:${v.cor_id ?? ""}|${v.cor_apelido_id ?? ""}`;

export type NecTecido = {
  artigo_id: string;
  artigo_nome: string;
  unidade_medida: string | null;
  rendimento: number | null;
  variantes: { key: string; variante_tecido_id: string | null; label: string; cor_nome: string | null; metros: number }[];
  totalMetros: number;
};

export function necessidadePorTecido(arvore: PtArvore, filtroSlot?: (slot: PtSlot) => boolean): NecTecido[] {
  const byArtigo = new Map<string, NecTecido>();
  for (const sub of arvore.subcolecoes ?? []) {
    for (const ln of sub.linhas ?? []) {
      for (const slot of ln.slots ?? []) {
        if (filtroSlot && !filtroSlot(slot)) continue;
        for (const mat of slot.materiais ?? []) {
          if (!mat.artigo_id) continue;
          let t = byArtigo.get(mat.artigo_id);
          if (!t) {
            t = { artigo_id: mat.artigo_id, artigo_nome: mat.artigo_nome ?? "", unidade_medida: mat.unidade_medida ?? null, rendimento: mat.rendimento ?? null, variantes: [], totalMetros: 0 };
            byArtigo.set(mat.artigo_id, t);
          }
          for (const v of mat.variantes ?? []) {
            const gradeBase = v.grade_total; // forro tem grade PRÓPRIA por variante (não mais multiplicador do Tecido 1)
            const metros = necessidadeVariante(mat.consumo, gradeBase, v.multiplicador);
            if (metros <= 0) continue;
            const k = varKey(v);
            let vr = t.variantes.find((x) => x.key === k);
            if (!vr) { vr = { key: k, variante_tecido_id: v.variante_tecido_id, label: (v.label || v.cor_nome) ?? "", cor_nome: v.cor_nome ?? null, metros: 0 }; t.variantes.push(vr); }
            vr.metros += metros;
            t.totalMetros += metros;
          }
        }
      }
    }
  }
  return [...byArtigo.values()];
}

/** Contabilidade de UMA linha de OC (por OC no Resumo, por variante no Drawer) — FONTE ÚNICA da conta
 *  pra Resumo e Drawer decidirem IGUAL. Regra: o que foi USADO (comprometido enviado à explosão OU
 *  baixa real, o que for MAIOR) sai da reservada. `baixaDomina` = a baixa real é ≥ o comprometido
 *  (então a cor é vermelha "baixa real"; senão é âmbar "comprometido"). */
export type ContabOc = { reservadaLivre: number; usada: number; sobra: number; baixaDomina: boolean };
export function contabilizarOc(total: number, comprometido: number, baixa: number, pedida: number): ContabOc {
  const t = Number(total) || 0, c = Number(comprometido) || 0, b = Number(baixa) || 0, p = Number(pedida) || 0;
  const usada = Math.max(c, b);
  return { reservadaLivre: Math.max(0, t - usada), usada, sobra: p - Math.max(t, usada), baixaDomina: b > 0 && b >= c };
}

/** Reservada/comprometida por OC — FONTE ÚNICA consumida pelo Resumo (por OC) e pelo Drawer
 *  (por OC×variante). "Comprometido" = demanda dos cards já ENVIADOS À EXPLOSÃO (enviado_cad); o
 *  comprometido SAI da reservada (ver contabilizarOc). OC efetiva do slot: o vínculo real do Dev
 *  (vinculoOcMap por modelo) vence o hint do plano (slotOcMap por slot).
 *  ⚠️ O total por-OC (reservPorOc, via slotMetros) e a soma por-variante (reservPorOcVar) NÃO são
 *  garantidamente iguais: (a) variante sem variante_tecido_id conta no total mas não no por-variante;
 *  (b) um slot vinculado a 2+ OCs soma inteiro em cada OC; (c) usar_estoque NÃO é filtrado (igual ao
 *  Resumo antigo). São casos raros; por isso o Drawer NÃO exibe total por-OC (só itens). */
export type DetalheOc = {
  reservPorOc: Map<string, number>;
  comprometidoPorOc: Map<string, number>;
  nPorOc: Map<string, number>;
  /** key = `${ocId}|${variante_tecido_id}` */
  reservPorOcVar: Map<string, number>;
  comprometidoPorOcVar: Map<string, number>;
};

export function detalheOc(
  arvore: PtArvore,
  vinculoOcMap: Record<string, string[]>,
  slotOcMap: Record<string, string[]>,
  enviadoCadSet?: Set<string>,
): DetalheOc {
  const reservPorOc = new Map<string, number>();
  const comprometidoPorOc = new Map<string, number>();
  const nPorOc = new Map<string, number>();
  const reservPorOcVar = new Map<string, number>();
  const comprometidoPorOcVar = new Map<string, number>();
  for (const sub of arvore.subcolecoes ?? []) for (const ln of sub.linhas ?? []) for (const slot of ln.slots ?? []) {
    if (!slot.id) continue;
    const devOc = slot.modelo_id ? (vinculoOcMap[slot.modelo_id] ?? []) : [];
    const ocIds = devOc.length ? devOc : (slotOcMap[slot.id] ?? []);
    if (!ocIds.length) continue;
    const enviado = !!slot.modelo_id && !!enviadoCadSet?.has(slot.modelo_id);
    const mTotal = slotMetros(slot); // total do slot (bate com o Resumo antigo)
    const perVar = new Map<string, number>(); // metros por variante_tecido_id (só reais)
    for (const mat of slot.materiais ?? []) for (const v of mat.variantes ?? []) {
      const metros = necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
      if (metros <= 0 || !v.variante_tecido_id) continue;
      perVar.set(v.variante_tecido_id, (perVar.get(v.variante_tecido_id) ?? 0) + metros);
    }
    for (const ocId of ocIds) {
      reservPorOc.set(ocId, (reservPorOc.get(ocId) ?? 0) + mTotal);
      nPorOc.set(ocId, (nPorOc.get(ocId) ?? 0) + 1);
      if (enviado) comprometidoPorOc.set(ocId, (comprometidoPorOc.get(ocId) ?? 0) + mTotal);
      for (const [vid, metros] of perVar) {
        const k = `${ocId}|${vid}`;
        reservPorOcVar.set(k, (reservPorOcVar.get(k) ?? 0) + metros);
        if (enviado) comprometidoPorOcVar.set(k, (comprometidoPorOcVar.get(k) ?? 0) + metros);
      }
    }
  }
  return { reservPorOc, comprometidoPorOc, nPorOc, reservPorOcVar, comprometidoPorOcVar };
}

/**
 * Distribui gradeTotal pelos tamanhos de proporcoes, proporcional ao peso.
 * Resto de arredondamento vai pro tamanho de maior peso.
 * proporcoes null/undefined/vazio → retorna {}.
 */
export function distribuirGrade(
  gradeTotal: number,
  proporcoes: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!proporcoes) return {};
  const entradas = Object.entries(proporcoes);
  if (entradas.length === 0) return {};
  const soma = entradas.reduce((s, [, p]) => s + (Number(p) || 0), 0);
  if (soma <= 0 || gradeTotal <= 0) {
    return Object.fromEntries(entradas.map(([tam]) => [tam, 0]));
  }
  // distribuição base (floor)
  const resultado: Record<string, number> = {};
  let distribuido = 0;
  for (const [tam, peso] of entradas) {
    const val = Math.floor((gradeTotal * (Number(peso) || 0)) / soma);
    resultado[tam] = val;
    distribuido += val;
  }
  // resto vai pro maior peso
  const resto = gradeTotal - distribuido;
  if (resto > 0) {
    const [tamMaior] = entradas.reduce(([bestTam, bestP], [tam, p]) =>
      (Number(p) || 0) > (Number(bestP) || 0) ? [tam, p] : [bestTam, bestP],
    );
    resultado[tamMaior] = (resultado[tamMaior] ?? 0) + resto;
  }
  return resultado;
}
