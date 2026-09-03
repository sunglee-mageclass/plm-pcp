import type { PtArvore, PtSub, PtLinha, PtSlot, PtMaterial, PtVariante } from "./types";

export type SeedInput = {
  colecao_id: string;
  tipo: "orcamento" | "poder_venda";
  buckets: { subcolecao_id: string | null; linha_id: string | null; categoria_id: string | null; qtd: number }[];
  // TODAS as subcoleções da coleção (em ordem) — garante que subcoleção sem modelo/bucket (ex.: R3
  // recém-criada) ainda apareça no plano. Opcional p/ compatibilidade com chamadas antigas.
  subcolecoes?: { subcolecao_id: string | null; ordem: number }[];
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
  // consumo confirmado no CAD (cad_tecidos.consumo_cad), quando > 0 — só MARCADOR de exibição
  // (item 3c): o `consumo` efetivo já traz o CAD quando ele vence; este campo alimenta o tooltip.
  consumo_cad?: number | null;
  loss_percent: number;
  // variantes do BOM: variante_tecido_id + ordem (=variante_numero na grade) + multiplicador + cor_nome
  variantes: { variante_tecido_id: string; ordem: number; multiplicador: number; cor_nome?: string | null; label?: string | null }[];
};
export type ModeloReal = {
  id: string;
  ref: string | null;
  nome: string | null;
  thumb_path?: string | null;     // 1ª foto do modelo (fotos_modelo[0]) p/ a miniatura
  subcolecao: string | null;      // nome da subcoleção (modelos.subcolecao é texto)
  subcolecao_id: string | null;   // resolvido pelo chamador (nome → id do plano), se possível
  linha_id: string | null;
  // markup próprio do modelo (congelado, `modelos.markup_editado`) — sobrepõe o markup da
  // linha (que no slot vem da COLOCAÇÃO, não do modelo) na formação de preço.
  markup_editado?: number | null;
  categoria_id: string | null;
  // categoria de TECIDO derivada do Tecido 1 (artigo.categoria_tecido_id) — categoriza o card no
  // canvas AUTOMATICAMENTE (o dono não quer clicar "Agrupar por tecido"; é o default).
  categoria_tecido_id?: string | null;
  // fotos de referência do MODELO REAL (`modelos.fotos_referencia`, G4) — fonte de exibição do
  // slot quando ele já tem modelo_id (o rascunho usa `plan_tecido_slots.referencia_paths` direto).
  fotos_referencia?: string[] | null;
  proporcoes: Record<string, number> | null;
  materiais: ModeloRealMaterial[];
  // custo de materiais (Σ aviamentos/insumos do BOM) — pré-preenche custo_simulado.materiais (editável)
  materiais_custo?: number;
  // grade por variante_numero (=ordem da variante): { grades, grade_total }
  grade: Record<number, { grades: Record<string, number>; grade_total: number }>;
};

// id client-side estável desde a criação: o save PRESERVA esse id (não regenera), então o slot.id em
// memória bate com o do banco após salvar → aplicar_ao_modelo/set_slot_oc não recebem id defasado.
const slotVazio = (i: number): PtSlot => ({ id: crypto.randomUUID(), modelo_id: null, slot_index: i, nome: null, custos_adicionais: [], materiais: [] });

/** Converte um modelo real (BOM + grade) num slot pré-preenchido do Plan. Tecido. */
export function slotDeModeloReal(mr: ModeloReal, slotIndex: number): PtSlot {
  // numero POR TIPO 1..n na montagem: a partição por artigo (PlanTecidoSheet.modelosReais) pode
  // emitir 2+ materiais do MESMO tipo com o MESMO `numero` do bloco — ex.: um bloco de forro com
  // variantes de DOIS artigos (principal + substituto) vira dois materiais (forro, numero=1). Dois
  // `(forro, numero=1)` colidem em uq_plan_mat(slot_id,tipo,numero) → 23505 ao salvar a coleção
  // inteira (estado-completo, delete+reinsert). Renumeramos sequencial por tipo (tecido 1..n,
  // forro 1..n) NA ORDEM ESTÁVEL dos materiais (= ordem de aparição na partição) — mesmo padrão do
  // `renumMateriais`/variantes 1..n. Efeito UX: o substituto (2º artigo do bloco) passa a APARECER
  // como "Forro 2" no card. numero é semântico ("Tecido N") — renumerado só aqui no front, NÃO no
  // servidor. `numero=1` do Tecido 1 é preservado (1º tecido na ordem) → auto-categorização intacta.
  const seqPorTipo: Partial<Record<PtMaterial["tipo"], number>> = {};
  const materiais: PtMaterial[] = mr.materiais.map((mat, mi) => {
    const numero = (seqPorTipo[mat.tipo] = (seqPorTipo[mat.tipo] ?? 0) + 1);
    // A grade planejada do Dev (`mr.grade` = modelo_grades, chaveada por variante_numero = ordem da
    // variante do TECIDO 1) só descreve o Tecido 1. Aplicá-la por `ordem` a FORRO/Tecido 2 é
    // casamento errado: lê a grade do Tecido 1 na MESMA posição (cross-read) e ignora a identidade da
    // variante (variante_tecido_id). Só o Tecido 1 puxa a grade do Dev; forro/Tecido 2 nascem SEM
    // grade e recebem a pç do PLANO salvo (comGradeDoPlano no merge) — "Dev vence só se preenchido;
    // forro tem grade própria (do plano)". `mat.numero` aqui é o número do BLOCO (Tecido 1 = 1).
    const puxaGradeDev = mat.tipo === "tecido" && Number(mat.numero) === 1;
    const variantes: PtVariante[] = mat.variantes
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((v, vi) => {
        const g = puxaGradeDev ? mr.grade[v.ordem] : undefined;
        return {
          variante_tecido_id: v.variante_tecido_id,
          ordem: vi + 1, // renumera 1..n (uq_plan_var em material_id, ordem)
          multiplicador: Number(v.multiplicador) || 1,
          grades: g?.grades ?? {},
          grade_total: Number(g?.grade_total) || 0,
          cor_nome: v.cor_nome ?? null,
          label: v.label ?? undefined,
        };
      });
    return {
      artigo_id: mat.artigo_id,
      artigo_nome: mat.artigo_nome ?? null,
      unidade_medida: mat.artigo_unidade_medida ?? null,
      rendimento: mat.artigo_rendimento ?? null,
      preco_por_metro: mat.preco_por_metro ?? null,
      tipo: mat.tipo,
      numero,
      consumo: Number(mat.consumo) || 0,
      consumo_cad: mat.consumo_cad ?? null, // marcador de exibição (item 3c)
      loss_percent: Number(mat.loss_percent) || 0,
      ordem: mi,
      variantes,
    };
  });
  return {
    id: crypto.randomUUID(), // id client-side estável (o save preserva) — ver slotVazio
    modelo_id: mr.id,
    slot_index: slotIndex,
    ref: mr.ref ?? null,
    nome: mr.nome ?? null,
    thumb_path: mr.thumb_path ?? null,
    proporcoes: mr.proporcoes ?? null,
    custos_adicionais: [],
    categoria_id: mr.categoria_id ?? null,
    // categoriza AUTOMATICAMENTE pela categoria de tecido do Tecido 1 (sem clicar "Agrupar")
    categoria_tecido_id: mr.categoria_tecido_id ?? null,
    linha_id: mr.linha_id ?? null,
    markup_editado: mr.markup_editado ?? null,
    // materiais (aviamentos/insumos) do desenvolvimento — editável em Custo & Preço
    custo_simulado: mr.materiais_custo ? { materiais: mr.materiais_custo } : undefined,
    // referência (G4): slot COM modelo exibe direto de modelos.fotos_referencia (fonte real);
    // o merge (abaixo) preserva o rascunho salvo (plan_tecido_slots.referencia_paths) só enquanto
    // o slot ainda não tem modelo — aqui é sempre o BOM VIVO (mesmo princípio do resto do seed).
    referencia_paths: mr.fotos_referencia ?? [],
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

  // 0) Garante TODAS as subcoleções da coleção (em ordem), MESMO vazias — senão uma subcoleção sem
  //    modelo nem bucket (ex.: R3 recém-criada) não aparecia no plano.
  for (const sc of [...(input.subcolecoes ?? [])].sort((a, b) => a.ordem - b.ordem)) getSub(sc.subcolecao_id);

  // 1) Coloca cada modelo real no seu bucket (subcoleção + linha/categoria conforme o tipo).
  for (const mr of input.modelos) {
    const sub = getSub(mr.subcolecao_id);
    const ln = input.tipo === "poder_venda"
      ? getLinha(sub, mr.linha_id, null)
      : getLinha(sub, null, mr.categoria_id);
    ln.slots.push(slotDeModeloReal(mr, ln.slots.length));
  }

  // 2) Garante os buckets do plano (mesmo sem modelo) e completa com slots VAZIOS até a qtd.
  // No fluxo ORÇAMENTO, um modelo real cuja categoria NÃO tem bucket próprio consome o bucket
  // RESTANTE (categoria=null, o catch-all) — senão ele fica na sua lane de categoria E o restante
  // gera vaga sobrando (ex.: OTB planeja 1 "sem categoria", mas o card tem categoria "Vestido" →
  // antes: 1 modelo + 1 vaga fantasma; agora: o Vestido abate o restante → 0 vaga). O split por
  // categoria fica intacto: um modelo de categoria X que TEM bucket X consome o bucket X.
  const catsComBucketPorSub = new Map<string, Set<string>>(); // subcolecao_id → categorias com bucket próprio
  if (input.tipo !== "poder_venda") {
    for (const b of input.buckets) {
      if (b.categoria_id == null) continue;
      const key = b.subcolecao_id ?? "__none__";
      let s = catsComBucketPorSub.get(key);
      if (!s) { s = new Set(); catsComBucketPorSub.set(key, s); }
      s.add(b.categoria_id);
    }
  }
  const orfaosPorSub = (subcolecao_id: string | null): number => {
    // modelos reais da sub cuja categoria NÃO tem bucket próprio (categoria null OU categoria sem split).
    const comBucket = catsComBucketPorSub.get(subcolecao_id ?? "__none__") ?? new Set<string>();
    return input.modelos.filter((mr) =>
      (mr.subcolecao_id ?? null) === (subcolecao_id ?? null) && !(mr.categoria_id && comBucket.has(mr.categoria_id)),
    ).length;
  };
  for (const b of input.buckets) {
    const sub = getSub(b.subcolecao_id);
    const ln = input.tipo === "poder_venda"
      ? getLinha(sub, b.linha_id, null)
      : getLinha(sub, null, b.categoria_id);
    // Bucket RESTANTE (categoria=null) no orçamento: desconta os órfãos-de-bucket da subcoleção
    // (que estão em OUTRAS lanes). Buckets COM categoria própria e PV: comportamento de sempre.
    const jaContados = (input.tipo !== "poder_venda" && b.categoria_id == null)
      ? orfaosPorSub(b.subcolecao_id)
      : ln.slots.length;
    const faltam = Math.max(0, b.qtd) - jaContados;
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

// Um slot salvo só tem "dados do usuário" se estiver ligado a um modelo, tiver material,
// tiver uma categoria de tecido atribuída (lane), uma categoria de PRODUTO (fix 4.1: um card
// vazio com SÓ a categoria de produto escolhida — sem tecido/modelo — era descartado aqui e a
// categoria sumia ao salvar/reabrir; a materialização em `podeCriarCard`/ModelCard.tsx já
// aceitava categoria-only, mas o SAVE do plano em si não), OU tiver referência anexada (G4: um
// slot rascunho com só uma foto de referência, sem tecido/modelo, não pode ser descartado no
// merge — senão a referência some ao reabrir). Slot salvo VAZIO (plano antigo pré-semeadura)
// NÃO deve sobrescrever o modelo semeado.
const savedTemDados = (s?: PtSlot): s is PtSlot =>
  !!s && (!!s.modelo_id || (s.materiais?.length ?? 0) > 0 || !!s.categoria_tecido_id || !!s.categoria_id || (s.referencia_paths?.length ?? 0) > 0);

// Consumo EFETIVO de card real (auditoria jul/2026, decisão do dono): o BOM VIVO do Dev vence,
// mas consumo VAZIO (0) no Dev cai no consumo digitado no PLANO salvo (mesmo artigo+tipo).
// Sem isso, modelo com BOM incompleto zerava reserva/comprometido/a comprar em silêncio
// (Ave Rara: SAMIRA+CALÇA ELARA = −285,6 m/cor no ANGELIM; CALÇA foi à explosão contando 0).
export function comConsumoDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  return vivos.map((m) => {
    if ((Number(m.consumo) || 0) > 0) return m;
    const s = salvos.find((x) => x.tipo === m.tipo && !!x.artigo_id && x.artigo_id === m.artigo_id && (Number(x.consumo) || 0) > 0);
    return s ? { ...m, consumo: s.consumo } : m;
  });
}

// Variantes EFETIVAS de card real (mesmo princípio do consumo acima — "Dev vence só se preenchido,
// senão vale o plano"). O merge usa SEMPRE o BOM VIVO (materiais) do Desenvolvimento; mas quem digita
// cores DIRETO no card do Plan. Tecido e Salva (sem "Aplicar ao modelo") grava variantes no PLANO, não
// no BOM — e perdia tudo ao recarregar, porque o BOM vivo (0 variantes) sobrescrevia o salvo. Por
// material (casado por artigo+tipo): se o vivo tem 0 variantes E o salvo (mesmo artigo+tipo) tem
// variantes, usa as do plano (com grades/pç). Se o BOM tem variantes, o BOM VENCE (comportamento
// atual — Dev é a fonte). `ordem` renumerada 1..n e cor (variante_tecido_id) não duplicada.
export function comVariantesDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  return vivos.map((m) => {
    if ((m.variantes?.length ?? 0) > 0) return m; // BOM tem variantes → BOM vence
    const s = salvos.find((x) => x.tipo === m.tipo && !!x.artigo_id && x.artigo_id === m.artigo_id && (x.variantes?.length ?? 0) > 0);
    if (!s) return m;
    const seen = new Set<string>();
    const variantes: PtVariante[] = s.variantes
      .filter((v) => {
        // dedup por cor real (variante_tecido_id); cor PLANEJADA (id null) casa por cor+apelido
        const k = v.variante_tecido_id ?? `plan:${v.cor_id ?? ""}:${v.cor_apelido_id ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((v, i) => ({ ...v, ordem: i + 1 }));
    return { ...m, variantes };
  });
}

// pç (grade por variante) EFETIVA — mesmo princípio do consumo/variantes ("Dev vence só se
// preenchido, senão vale o plano"). A grade do Dev (`modelo_grades`) só existe pro TECIDO 1 (ver
// slotDeModeloReal): forro e Tecido 2 nascem SEM grade, e a pç deles é DIGITADA no card → mora só no
// PLANO. Também um Tecido 1 pode ter variante nova ainda SEM grade no Dev, com a pç já no plano.
// Por variante casada (variante_tecido_id, ou cor planejada por cor_id+apelido — mesma chave do
// comVariantesDoPlano/calc.varKey): se a do VIVO está VAZIA (grade_total 0 E grades {}) e o plano tem
// pç pra mesma variante, usa a do plano. Se o vivo tem pç, o vivo VENCE (Dev é a fonte do Tecido 1).
export function comGradeDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  const keyV = (v: PtVariante) => v.variante_tecido_id ?? `plan:${v.cor_id ?? ""}:${v.cor_apelido_id ?? ""}`;
  const temGrade = (v: { grade_total?: number; grades?: Record<string, number> }) =>
    (Number(v.grade_total) || 0) > 0 || Object.keys(v.grades ?? {}).length > 0;
  return vivos.map((m) => {
    if (!m.variantes?.length) return m;
    const s = salvos.find((x) => x.tipo === m.tipo && (x.artigo_id ?? null) === (m.artigo_id ?? null) && (x.variantes?.length ?? 0) > 0);
    if (!s) return m;
    const salvaPorKey = new Map<string, PtVariante>(s.variantes.map((v) => [keyV(v), v]));
    let mudou = false;
    const variantes = m.variantes.map((v) => {
      if (temGrade(v)) return v; // vivo já tem pç → vivo vence
      const sv = salvaPorKey.get(keyV(v));
      if (!sv || !temGrade(sv)) return v;
      mudou = true;
      return { ...v, grades: sv.grades ?? {}, grade_total: Number(sv.grade_total) || 0 };
    });
    return mudou ? { ...m, variantes } : m;
  });
}

// artigo_id do Tecido 1 (tipo==='tecido' && numero===1) de um slot — SSOT usado por
// moverParaFamiliaDoTecido (G2) E normalizarCategoriasAuto (bug lane congelada, ago/2026): a
// "categoria auto" de um card é SEMPRE derivada deste mesmo artigo, nunca de forro/Tecido 2+.
export const artigoTecido1Do = (s: PtSlot): string | null =>
  s.materiais.find((m) => m.tipo === "tecido" && Number(m.numero) === 1)?.artigo_id ?? null;

/** G2: trocar o ARTIGO do Tecido 1 (tipo==='tecido' && numero===1) move o card p/ a
 *  família (categoria de tecido) do artigo. Forro/Tecido 2+/bloco complementar NUNCA.
 *  Artigo sem família → não move. Fonte = artigos.categoria_tecido_id (a mesma da auto-cat do seed). */
export function moverParaFamiliaDoTecido(
  prev: PtSlot, next: PtSlot, familiaDoArtigo: (artigoId: string) => string | null,
): { slot: PtSlot; lane: string } | null {
  const a0 = artigoTecido1Do(prev), a1 = artigoTecido1Do(next);
  if (!a1 || a1 === a0) return null;                        // sem tecido novo / mesmo artigo
  const fam = familiaDoArtigo(a1);
  if (!fam || (next.categoria_tecido_id ?? null) === fam) return null; // sem família / já lá
  return { slot: { ...next, categoria_tecido_id: fam }, lane: fam };
}

/**
 * Bug "lane congelada" (ago/2026): `categoria_tecido_id` do slot é PERSISTIDA e o merge faz o
 * SALVO vencer o vivo do cadastro (linha 357 acima) — se o cadastro do artigo é corrigido DEPOIS
 * de salvar (ex.: Malha Begônia FORRO→MALHA), o card fica preso na categoria antiga pra sempre
 * (o "manual salvo vence" do merge não distingue "usuário arrastou de propósito" de "isso era só
 * o auto do seed quando salvou"). Fix: ANTES de enviar o payload do save, normaliza pra NULL a
 * categoria de todo slot COM Tecido 1 resolvível cuja `categoria_tecido_id` bate com a categoria
 * AUTO desse mesmo Tecido 1 (mesma fonte de `moverParaFamiliaDoTecido`/artigoTecido1Do) — um
 * slot com NULL auto-preenche do vivo no merge (comportamento já existente), então a lane volta
 * a SEGUIR o cadastro; só um arraste manual pra uma lane DIFERENTE da auto persiste de verdade.
 * Slot sem Tecido 1 resolvível (sem modelo/sem tecido/artigo sem família) não tem "auto" — não
 * mexe. PURA: não muta a árvore recebida, retorna uma cópia; usada só no payload do save, nunca
 * no estado local (o usuário não deve ver a lane "piscar" pra null na tela).
 */
export function normalizarCategoriasAuto(arvore: PtArvore, categoriaAutoDoArtigo: (artigoId: string) => string | null): PtArvore {
  return {
    ...arvore,
    subcolecoes: arvore.subcolecoes.map((sub) => ({
      ...sub,
      linhas: sub.linhas.map((ln) => ({
        ...ln,
        slots: ln.slots.map((slot) => {
          const artigoId = artigoTecido1Do(slot);
          if (!artigoId) return slot; // sem Tecido 1 resolvível → sem "auto", não mexe
          const auto = categoriaAutoDoArtigo(artigoId);
          if (!auto || (slot.categoria_tecido_id ?? null) !== auto) return slot; // sem família / já diverge (manual de verdade)
          return { ...slot, categoria_tecido_id: null };
        }),
      })),
    })),
  };
}

export function mergeArvore(seed: PtArvore, salvo: PtArvore | null): PtArvore {
  if (!salvo) return seed;
  // BOM VIVO por modelo_id: cada slot de modelo do seed carrega o BOM atual do Desenvolvimento.
  // Indexar o BOM vivo por modelo_id garante fidelidade INDEPENDENTE da posição na grade (bug
  // real: card com tecido do Dev = Angelim aparecia no plano como Renda Delicate, um snapshot
  // antigo salvo).
  const liveByModelo = new Map<string, PtSlot>();
  for (const sub of seed.subcolecoes)
    for (const ln of sub.linhas)
      for (const slot of ln.slots)
        if (slot.modelo_id) liveByModelo.set(slot.modelo_id, slot);
  // Slot SALVO por modelo_id: o dado salvo SEGUE o modelo quando ele muda de subcoleção/bucket.
  // (Bug Ave Rara: Plan. Produto/OTB movem `modelos.subcolecao` — o merge posicional antigo
  // pregava o modelo na subcoleção do plano salvo E o duplicava na subcoleção nova.)
  const savedByModelo = new Map<string, PtSlot>();
  for (const sub of salvo.subcolecoes)
    for (const ln of sub.linhas)
      for (const s of ln.slots)
        if (s.modelo_id) savedByModelo.set(s.modelo_id, s);
  return {
    ...seed,
    plan_id: salvo.plan_id,
    subcolecoes: seed.subcolecoes.map((s) => {
      const ss = salvo.subcolecoes.find((x) => (x.subcolecao_id ?? "__none__") === (s.subcolecao_id ?? "__none__"));
      if (!ss) return s;
      // preserva as categorias (lanes) da subcoleção salva — o seed não as tem
      return { ...s, id: ss.id, categorias_tecido: ss.categorias_tecido ?? s.categorias_tecido, linhas: s.linhas.map((l) => {
        const sl = ss.linhas.find((x) => lnKeyOf(x) === lnKeyOf(l));
        if (!sl) return l;
        // Pareamento em 2 trilhas:
        //  • slot do seed COM modelo casa pelo MODELO_ID (onde quer que o salvo estivesse — a
        //    colocação VIVA vence; o dado de plano salvo segue o modelo);
        //  • slot do seed VAZIO casa POSICIONALMENTE entre os salvos "restantes" — excluindo os
        //    de modelo VIVO (esses pertencem ao bucket atual do modelo, não a este). Slot salvo
        //    de modelo EXCLUÍDO continua entrando (comportamento antigo: o Sheet limpa via validIds).
        const restantes = sl.slots.filter((x) => !(x.modelo_id && liveByModelo.has(x.modelo_id)));
        let k = 0;
        return { ...l, id: sl.id, slots: l.slots.map((slot) => {
          const saved = slot.modelo_id ? savedByModelo.get(slot.modelo_id) : restantes[k++];
          if (!savedTemDados(saved)) return slot; // não deixa slot salvo vazio apagar o modelo semeado
          // modelo_id EFETIVO: o do seed (colocação viva); num vazio posicional, o do salvo
          // (modelo excluído — limpo depois pelo Sheet).
          const effModeloId = slot.modelo_id ?? saved.modelo_id;
          // BOM vivo do modelo efetivo (por id, não por posição) — pode não existir se o modelo
          // foi excluído do Desenvolvimento; aí cai no snapshot salvo.
          const live = effModeloId ? liveByModelo.get(effModeloId) : undefined;
          // salvo tem dados do usuário: usa o salvo, mas preserva a identidade do seed onde o salvo não tem
          return {
            ...slot, ...saved,
            modelo_id: effModeloId,
            ref: saved.ref ?? slot.ref,
            nome: saved.nome ?? slot.nome,
            thumb_path: saved.thumb_path ?? slot.thumb_path,
            categoria_id: saved.categoria_id ?? slot.categoria_id,
            // categoria de TECIDO (lane): manual salvo VENCE; se o slot salvo está sem categoria,
            // usa a AUTO do seed (Tecido 1). Assim planos antigos "sem categoria" auto-preenchem ao
            // reabrir, e uma categorização manual do usuário é preservada.
            categoria_tecido_id: saved.categoria_tecido_id ?? slot.categoria_tecido_id,
            linha_id: saved.linha_id ?? slot.linha_id,
            // markup_editado é congelado NO MODELO (modelos.markup_editado, invariante do banco) —
            // o seed (`slot`, sempre o modelo vivo) VENCE sempre, nunca o snapshot salvo do plano
            // (senão editar o markup aplicado no Planejamento não refletiria aqui até o dono limpar
            // o plano salvo). Espelha o tratamento de `materiais`/BOM vivo, não o de `linha_id`.
            markup_editado: effModeloId ? slot.markup_editado : (saved.markup_editado ?? slot.markup_editado),
            // proporção: "Dev vence se preenchido" (mesmo princípio do consumo). A proporção do
            // MODELO (`slot` = seed = modelos.proporcoes) vence quando tem tamanhos; senão cai no
            // plano salvo. Sem isso, um plano salvo com proporção VAZIA ({}) apagava a proporção do
            // modelo no dado do slot — o display se salvava pela busca própria do GradeSection, mas o
            // cálculo de distribuição por tamanho (distribuirGrade) ficava sem proporção (grade por
            // tamanho vazia na hora de gerar a OC).
            proporcoes: (slot.proporcoes && Object.keys(slot.proporcoes).length)
              ? slot.proporcoes
              : (saved.proporcoes ?? slot.proporcoes),
            // custo de materiais (aviamentos/insumos) pré-preenchido do BOM não é apagado por save
            // antigo (null). NÃO forçamos o vivo aqui: o editor "Custo & Preço" do plano pode ter
            // ajustado esse custo (o salvo vence); só o BOM de TECIDO (materiais) puxa o vivo.
            custo_simulado: saved.custo_simulado ?? slot.custo_simulado,
            // referência (G4): slot COM modelo tem a referência REAL em modelos.fotos_referencia —
            // o seed (`slot`, sempre o modelo vivo) VENCE sempre, IGUAL markup_editado (nunca o
            // snapshot salvo do plano, que só reflete o rascunho pré-materialização e pode estar
            // desatualizado/vazio). Slot SEM modelo (rascunho) é dado PRÓPRIO do plano → o salvo vence.
            referencia_paths: effModeloId ? slot.referencia_paths : (saved.referencia_paths ?? slot.referencia_paths),
            // Consistência (a.1): modelo REAL usa o BOM VIVO do Desenvolvimento (por modelo_id, não
            // pela posição), não o snapshot salvo — assim que o card avança/muda o BOM, o plano
            // reflete. Slot de planejamento (sem modelo) mantém o rascunho salvo.
            // Ordem dos fallbacks (todos "Dev vence só se preenchido"): consumo → variantes → pç.
            // comGradeDoPlano por ÚLTIMO porque depende das variantes já resolvidas (as que vieram do
            // plano via comVariantesDoPlano já trazem a pç; as que vieram do Dev sem grade — forro/
            // Tecido 2 ou variante nova do Tecido 1 — recebem a pç do plano aqui).
            materiais: effModeloId
              ? (live?.materiais?.length ? comGradeDoPlano(comVariantesDoPlano(comConsumoDoPlano(live.materiais, saved.materiais), saved.materiais), saved.materiais) : (saved.materiais ?? []))
              : (saved.materiais?.length ? saved.materiais : slot.materiais),
          };
        }) };
      }) };
    }),
  };
}
