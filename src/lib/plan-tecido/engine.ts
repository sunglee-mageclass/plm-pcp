import type { PtArvore, PtSub, PtLinha, PtSlot, PtMaterial, PtVariante } from "./types";

export type SeedInput = {
  colecao_id: string;
  tipo: "orcamento" | "poder_venda";
  buckets: { subcolecao_id: string | null; linha_id: string | null; categoria_id: string | null; qtd: number }[];
};

// Modelo real mapeado do banco (BOM + grade + classificação), pronto p/ virar slot.
export type ModeloRealMaterial = {
  tipo: "tecido" | "forro";
  numero: number;
  artigo_id: string | null;
  artigo_nome?: string | null;
  artigo_unidade_medida?: string | null;
  artigo_rendimento?: number | null;
  preco_por_metro?: number | null;
  consumo: number;
  loss_percent: number;
  // variantes do BOM: variante_tecido_id + ordem (=variante_numero na grade) + multiplicador + cor_nome
  variantes: { variante_tecido_id: string; ordem: number; multiplicador: number; cor_nome?: string | null }[];
};
export type ModeloReal = {
  id: string;
  ref: string | null;
  nome: string | null;
  thumb_path?: string | null;     // 1ª foto do modelo (fotos_modelo[0]) p/ a miniatura
  subcolecao: string | null;      // nome da subcoleção (modelos.subcolecao é texto)
  subcolecao_id: string | null;   // resolvido pelo chamador (nome → id do plano), se possível
  linha_id: string | null;
  categoria_id: string | null;
  proporcoes: Record<string, number> | null;
  materiais: ModeloRealMaterial[];
  // custo de materiais (Σ aviamentos/insumos do BOM) — pré-preenche custo_simulado.materiais (editável)
  materiais_custo?: number;
  // grade por variante_numero (=ordem da variante): { grades, grade_total }
  grade: Record<number, { grades: Record<string, number>; grade_total: number }>;
};

const slotVazio = (i: number): PtSlot => ({ modelo_id: null, slot_index: i, nome: null, custos_adicionais: [], materiais: [] });

/** Converte um modelo real (BOM + grade) num slot pré-preenchido do Plan. Tecido. */
export function slotDeModeloReal(mr: ModeloReal, slotIndex: number): PtSlot {
  const materiais: PtMaterial[] = mr.materiais.map((mat, mi) => {
    const variantes: PtVariante[] = mat.variantes
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((v, vi) => {
        const g = mr.grade[v.ordem];
        return {
          variante_tecido_id: v.variante_tecido_id,
          ordem: vi + 1, // renumera 1..n (uq_plan_var em material_id, ordem)
          multiplicador: Number(v.multiplicador) || 1,
          grades: g?.grades ?? {},
          grade_total: Number(g?.grade_total) || 0,
          cor_nome: v.cor_nome ?? null,
        };
      });
    return {
      artigo_id: mat.artigo_id,
      artigo_nome: mat.artigo_nome ?? null,
      unidade_medida: mat.artigo_unidade_medida ?? null,
      rendimento: mat.artigo_rendimento ?? null,
      preco_por_metro: mat.preco_por_metro ?? null,
      tipo: mat.tipo,
      numero: mat.numero,
      consumo: Number(mat.consumo) || 0,
      loss_percent: Number(mat.loss_percent) || 0,
      ordem: mi,
      variantes,
    };
  });
  return {
    modelo_id: mr.id,
    slot_index: slotIndex,
    ref: mr.ref ?? null,
    nome: mr.nome ?? null,
    thumb_path: mr.thumb_path ?? null,
    proporcoes: mr.proporcoes ?? null,
    custos_adicionais: [],
    categoria_id: mr.categoria_id ?? null,
    linha_id: mr.linha_id ?? null,
    // materiais (aviamentos/insumos) do desenvolvimento — editável em Custo & Preço
    custo_simulado: mr.materiais_custo ? { materiais: mr.materiais_custo } : undefined,
    materiais,
  };
}

export type SeedComModelosInput = SeedInput & { modelos: ModeloReal[] };

/**
 * Semeia a árvore trazendo os MODELOS REAIS da coleção pré-preenchidos com o BOM,
 * agrupados por subcoleção→linha (PV) ou subcoleção→categoria (Orçamento). Cada bucket
 * do plano é completado com slots VAZIOS até atingir a `qtd` planejada.
 */
export function semearComModelos(input: SeedComModelosInput): PtArvore {
  const subs = new Map<string, PtSub>();

  const getSub = (subcolecao_id: string | null): PtSub => {
    const key = subcolecao_id ?? "__none__";
    let sub = subs.get(key);
    if (!sub) { sub = { subcolecao_id, ordem: subs.size, linhas: [] }; subs.set(key, sub); }
    return sub;
  };
  const getLinha = (sub: PtSub, linha_id: string | null, categoria_id: string | null): PtLinha => {
    const key = `${linha_id ?? ""}|${categoria_id ?? ""}`;
    let ln = sub.linhas.find((l) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}` === key);
    if (!ln) { ln = { linha_id, categoria_id, ordem: sub.linhas.length, slots: [] }; sub.linhas.push(ln); }
    return ln;
  };

  // 1) Coloca cada modelo real no seu bucket (subcoleção + linha/categoria conforme o tipo).
  for (const mr of input.modelos) {
    const sub = getSub(mr.subcolecao_id);
    const ln = input.tipo === "poder_venda"
      ? getLinha(sub, mr.linha_id, null)
      : getLinha(sub, null, mr.categoria_id);
    ln.slots.push(slotDeModeloReal(mr, ln.slots.length));
  }

  // 2) Garante os buckets do plano (mesmo sem modelo) e completa com slots VAZIOS até a qtd.
  for (const b of input.buckets) {
    const sub = getSub(b.subcolecao_id);
    const ln = input.tipo === "poder_venda"
      ? getLinha(sub, b.linha_id, null)
      : getLinha(sub, null, b.categoria_id);
    const faltam = Math.max(0, b.qtd) - ln.slots.length;
    for (let i = 0; i < faltam; i++) ln.slots.push(slotVazio(ln.slots.length));
  }

  // 3) Markup vem da LINHA em que o card está (colocação = fonte do markup). Propaga a
  //    linha do grupo p/ TODO slot (inclui os vazios), senão os vazios ficam sem markup.
  for (const sub of subs.values())
    for (const ln of sub.linhas)
      if (ln.linha_id) for (const slot of ln.slots) slot.linha_id = ln.linha_id;

  return { colecao_id: input.colecao_id, subcolecoes: [...subs.values()] };
}

export function semearArvore(input: SeedInput): PtArvore {
  const subs = new Map<string, PtSub>();
  input.buckets.forEach((b, bi) => {
    const subKey = b.subcolecao_id ?? "__none__";
    let sub = subs.get(subKey);
    if (!sub) { sub = { subcolecao_id: b.subcolecao_id, ordem: subs.size, linhas: [] }; subs.set(subKey, sub); }
    const lnKey = `${b.linha_id ?? ""}|${b.categoria_id ?? ""}`;
    let ln = sub.linhas.find((l) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}` === lnKey);
    if (!ln) { ln = { linha_id: b.linha_id, categoria_id: b.categoria_id, ordem: sub.linhas.length, slots: [] } as PtLinha; sub.linhas.push(ln); }
    for (let i = 0; i < Math.max(0, b.qtd); i++) ln.slots.push(slotVazio(ln.slots.length));
    void bi;
  });
  return { colecao_id: input.colecao_id, subcolecoes: [...subs.values()] };
}

const lnKeyOf = (l: { linha_id: string | null; categoria_id: string | null }) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}`;

// Um slot salvo só tem "dados do usuário" se estiver ligado a um modelo OU tiver material.
// Slot salvo VAZIO (plano antigo pré-semeadura) NÃO deve sobrescrever o modelo semeado.
const savedTemDados = (s?: PtSlot): boolean => !!s && (!!s.modelo_id || (s.materiais?.length ?? 0) > 0);

export function mergeArvore(seed: PtArvore, salvo: PtArvore | null): PtArvore {
  if (!salvo) return seed;
  return {
    ...seed,
    plan_id: salvo.plan_id,
    subcolecoes: seed.subcolecoes.map((s) => {
      const ss = salvo.subcolecoes.find((x) => (x.subcolecao_id ?? "__none__") === (s.subcolecao_id ?? "__none__"));
      if (!ss) return s;
      return { ...s, id: ss.id, linhas: s.linhas.map((l) => {
        const sl = ss.linhas.find((x) => lnKeyOf(x) === lnKeyOf(l));
        if (!sl) return l;
        return { ...l, id: sl.id, slots: l.slots.map((slot, i) => {
          const saved = sl.slots[i];
          if (!savedTemDados(saved)) return slot; // não deixa slot salvo vazio apagar o modelo semeado
          // salvo tem dados do usuário: usa o salvo, mas preserva a identidade do seed onde o salvo não tem
          return {
            ...slot, ...saved,
            modelo_id: saved.modelo_id ?? slot.modelo_id,
            ref: saved.ref ?? slot.ref,
            nome: saved.nome ?? slot.nome,
            thumb_path: saved.thumb_path ?? slot.thumb_path,
            categoria_id: saved.categoria_id ?? slot.categoria_id,
            linha_id: saved.linha_id ?? slot.linha_id,
            proporcoes: saved.proporcoes ?? slot.proporcoes,
            // custo de materiais pré-preenchido do BOM não é apagado por save antigo (null)
            custo_simulado: saved.custo_simulado ?? slot.custo_simulado,
            materiais: (saved.materiais?.length ? saved.materiais : slot.materiais),
          };
        }) };
      }) };
    }),
  };
}
