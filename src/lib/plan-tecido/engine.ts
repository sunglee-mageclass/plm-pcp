import type { PtArvore, PtSub, PtLinha, PtSlot, PtMaterial, PtVariante } from "./types";
import { varKey } from "./calc";
import { ehTecido1, atendimentoDoBloco } from "./atendimento";

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
  // cor_id (cor base) alimenta o "atende a" automático; complementa_variante_ids = casamento do BOM (casar variantes).
  // cor_apelido_id (Lote A fix1 · I3): junto de cor_id, monta a MESMA chave `cor|apelido` que a distribuição salva usa
  // pra re-casar a cor PLANEJADA → real (`varKey`/`resolverChaveT1`); sem ele a chave viva ficava `cor_id|""` e nunca
  // batia com a salva `cor_id|apelido_id`.
  variantes: { variante_tecido_id: string; ordem: number; multiplicador: number; cor_nome?: string | null; label?: string | null; cor_id?: string | null; cor_apelido_id?: string | null; complementa_variante_ids?: string[] | null }[];
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
  // "Tamanho em" do modelo (modelos.tamanho_tipo) — semeado no slot com card; editável no card (frente Tamanho em).
  tamanho_tipo?: "letra" | "numero" | null;
  // grade por variante_numero (=ordem da variante): { grades, grade_total }
  grade: Record<number, { grades: Record<string, number>; grade_total: number }>;
};

// id client-side estável desde a criação: o save PRESERVA esse id (não regenera), então o slot.id em
// memória bate com o do banco após salvar → aplicar_ao_modelo/set_slot_oc não recebem id defasado.
const slotVazio = (i: number): PtSlot => ({ id: crypto.randomUUID(), modelo_id: null, slot_index: i, nome: null, custos_adicionais: [], materiais: [] });

// PR11 (G-plano R2): o casamento do BOM (complementa_variante_ids) vira o "atende a" do plano. IGUAL ao automático —
// toda cor casada do Tecido 1 tem a MESMA cor base da cor do bloco — volta NULL (automático): senão, depois do 1º aplicar,
// uma cor NOVA do T1 com a mesma cor base deixaria de ser atendida sozinha (P-17). Outra cor base = lista à mão.
// Lote A fix2 · N2/N3: devolve NULL (automático) em 2 casos — (a) os ids são EXATAMENTE o automático PURO deste
// bloco (`automaticoIds`, OBRIGATÓRIO — o resultado de `atendimentoDoBloco` calculado pelo chamador com o BLOCO
// INTEIRO, sem nenhuma amarração manual, NA MESMA ORDEM da exibição — N1); OU (b) TODOS os ids amarrados têm a
// MESMA cor base da cor do bloco E nenhuma OUTRA cor do bloco (`semAmbiguidade`) tem essa `cor_id` — preserva o
// PR11/P-17 (cor NOVA do T1 com a mesma cor base é atendida sozinha) mesmo quando o BOM do Sheet não atualizou os
// `complementa_variante_ids` (o automático PURO calculado com o T1 do MOMENT0 da carga não inclui a cor nova, mas
// a regra (b) não depende do T1 — só da cor base do bloco e da ausência de ambiguidade nele). Um bloco com 2 cores
// da MESMA cor base (Preto·Fosco→vtA, Preto·Brilho→vtB) tem `semAmbiguidade=false` pras duas → (b) não se aplica;
// (a) só bate se a amarração for EXATA. M6: os ids são filtrados pelos que AINDA estão em `corDoT1` (id velho de
// cor removida do T1 não bloqueia o automático).
export function atendeDoBom(
  v: { cor_id?: string | null; complementa_variante_ids?: string[] | null },
  corDoT1: Map<string, string | null>,
  automaticoIds: string[],
  semAmbiguidade: boolean,
): string[] | null {
  const ids = (Array.isArray(v.complementa_variante_ids) ? v.complementa_variante_ids.filter(Boolean) : []).filter((id) => corDoT1.has(id));
  if (ids.length === 0) return null;
  const a = new Set(automaticoIds);
  const b = new Set(ids);
  if (a.size === b.size && [...a].every((id) => b.has(id))) return null;
  if (semAmbiguidade && v.cor_id && ids.every((id) => corDoT1.get(id) === v.cor_id)) return null;
  return [...ids];
}

/** Converte um modelo real (BOM + grade) num slot pré-preenchido do Plan. Tecido. */
export function slotDeModeloReal(mr: ModeloReal, slotIndex: number): PtSlot {
  // SUBSTITUTOS EM CARD REAL (set/2026): a partição por artigo (PlanTecidoSheet.modelosReais) emite
  // 2+ materiais do MESMO tipo+numero do bloco quando um bloco tem variantes de artigos diferentes
  // (principal + substituto). Aqui AGRUPAMOS esses por `(tipo, numero)` num ÚNICO PtMaterial: o 1º
  // artigo do grupo é o PRINCIPAL; os demais entram em `artigo_ids_extra` (substitutos). As variantes
  // de TODOS os artigos do grupo convivem no material, cada uma marcada com `variante_artigo_id` (=
  // artigo real da variante) — o `MaterialBlock` agrupa por fornecedor e reconstrói os badges. Assim
  // o substituto aparece como alternativa DO MESMO Tecido N (não como "Tecido 2"/"Forro 2" separado).
  // A grade do Dev (`mr.grade`, por variante_numero do TECIDO 1) só vale p/ o Tecido 1; o grupo do
  // Tecido 1 é o de menor `numero` de bloco entre os tecidos. numero exibido = sequencial por tipo
  // (Tecido 1..n / Forro 1..n) na ordem de aparição dos GRUPOS.
  const grupos = new Map<string, { tipo: PtMaterial["tipo"]; mats: typeof mr.materiais }>();
  for (const mat of mr.materiais) {
    const k = `${mat.tipo}|${mat.numero}`;
    const g = grupos.get(k);
    if (g) g.mats.push(mat);
    else grupos.set(k, { tipo: mat.tipo, mats: [mat] });
  }
  // PR11: cor base de cada variante do Tecido 1 do BOM — o 1º grupo de tecido (o mesmo que puxa a grade do Dev), com os
  // substitutos — p/ reconhecer o casamento igual ao automático.
  const gT1 = Array.from(grupos.values()).find((x) => x.tipo === "tecido");
  const t1Mats = gT1?.mats ?? [];
  const corDoT1 = new Map(
    t1Mats.flatMap((m) => m.variantes.map((x) => [x.variante_tecido_id, x.cor_id ?? null] as const)),
  );
  // Lote A fix1 · I4: stub do T1 no formato que `atendimentoDoBloco`/`varKey` leem (variante_tecido_id/cor_id/
  // cor_apelido_id) — usado abaixo p/ calcular o automático PURO (sem nenhuma amarração manual) de cada bloco.
  const t1Stub: PtVariante[] = t1Mats.flatMap((m) => m.variantes).map((v) => ({
    variante_tecido_id: v.variante_tecido_id, cor_id: v.cor_id ?? null, cor_apelido_id: null,
    ordem: v.ordem, multiplicador: 1, grades: {}, grade_total: 0,
  }));
  const seqPorTipo: Partial<Record<PtMaterial["tipo"], number>> = {};
  const materiais: PtMaterial[] = Array.from(grupos.values()).map((g, mi) => {
    const numero = (seqPorTipo[g.tipo] = (seqPorTipo[g.tipo] ?? 0) + 1);
    const principal = g.mats[0]; // 1º artigo do grupo = principal (ordem estável da partição)
    const extras = g.mats.slice(1).map((m) => m.artigo_id).filter((id): id is string => !!id);
    // Só o TECIDO 1 (1º grupo de tecido na ordem de aparição = numero exibido 1) puxa a grade do Dev
    // (chaveada por variante_numero do bloco do Tecido 1; o grupo do Tecido 1 sempre é o 1º tecido).
    const puxaGradeDev = g.tipo === "tecido" && numero === 1;
    const ehT1 = g.tipo === "tecido" && numero === 1;
    // Lote A fix2 · N1: a lista ordenada por `ordem` (a MESMA que produz `variantes` abaixo) — o `blocoStub` do
    // automático PURO precisa iterar NA MESMA ORDEM que a normalização/exibição, senão a regra "1ª candidata livre
    // vence" do `atendimentoDoBloco` pode escolher um "1º" diferente entre o stub (ordem dos artigos do grupo) e o
    // real (ordem por `ordem`) — ex.: substituto (artigo 2) com `ordem` menor que o principal (artigo 1).
    const ordenados = g.mats
      .flatMap((m) => m.variantes.map((v) => ({ v, artigo_id: m.artigo_id })))
      .sort((a, b) => (a.v.ordem ?? 0) - (b.v.ordem ?? 0));
    // Lote A fix1 · I4: automático PURO deste bloco (sem amarração manual nenhuma) — mesma função do automático
    // da T2 (`atendimentoDoBloco`), calculada com o BLOCO INTEIRO, na ordem de exibição; usado abaixo p/ decidir,
    // variante a variante, se a amarração do BOM bate EXATAMENTE com o que o automático daria (2 cores da mesma
    // cor base no bloco fazem o automático entregar as duas à 1ª — uma amarração parcial não é igual, fica à mão).
    const blocoStub: PtVariante[] = ehT1 ? [] : ordenados.map(({ v }) => ({
      variante_tecido_id: v.variante_tecido_id, cor_id: v.cor_id ?? null, cor_apelido_id: null,
      ordem: v.ordem, multiplicador: 1, grades: {}, grade_total: 0,
    }));
    const autoDoBloco = ehT1 ? null : atendimentoDoBloco(t1Stub, blocoStub);
    // Lote A fix2 · N2: nenhuma OUTRA cor do bloco (forro/T2) com a MESMA cor_id — guarda contra o casamento
    // "automático" virar NULL quando há ambiguidade real (2 cores do bloco disputando a mesma cor base).
    const corIdUnicaNoBloco = ehT1 ? null : (() => {
      const cont = new Map<string, number>();
      for (const { v } of ordenados) if (v.cor_id) cont.set(v.cor_id, (cont.get(v.cor_id) ?? 0) + 1);
      return cont;
    })();
    // Variantes de TODOS os artigos do grupo, marcadas com o artigo real (p/ agrupar por fornecedor).
    const variantes: PtVariante[] = ordenados
      .map(({ v, artigo_id }, vi) => {
        const g2 = puxaGradeDev ? mr.grade[v.ordem] : undefined;
        return {
          variante_tecido_id: v.variante_tecido_id,
          variante_artigo_id: artigo_id ?? null, // artigo real da variante (principal ou substituto)
          ordem: vi + 1, // renumera 1..n (uq_plan_var em material_id, ordem)
          multiplicador: Number(v.multiplicador) || 1,
          grades: g2?.grades ?? {},
          grade_total: Number(g2?.grade_total) || 0,
          cor_nome: v.cor_nome ?? null,
          label: v.label ?? undefined,
          cor_id: v.cor_id ?? null,
          cor_apelido_id: v.cor_apelido_id ?? null,
          // Distribuição por produto (R3/R7): o casamento do BOM é o "atende a" fora do Tecido 1 (NULL = automático);
          // igual ao automático (EXATO — I4) OU mesma cor base sem ambiguidade no bloco (N2) volta NULL — PR11.
          ...(ehT1 ? {} : {
            atende: atendeDoBom(v, corDoT1, autoDoBloco?.porCor.get(v.variante_tecido_id) ?? [], (corIdUnicaNoBloco?.get(v.cor_id ?? "") ?? 0) <= 1),
          }),
        };
      });
    return {
      artigo_id: principal.artigo_id,
      artigo_ids_extra: extras.length > 0 ? extras : undefined,
      artigo_nome: principal.artigo_nome ?? null,
      unidade_medida: principal.artigo_unidade_medida ?? null,
      rendimento: principal.artigo_rendimento ?? null,
      preco_por_metro: principal.preco_por_metro ?? null,
      tipo: g.tipo,
      numero,
      consumo: Number(principal.consumo) || 0,
      consumo_cad: principal.consumo_cad ?? null, // marcador de exibição (item 3c)
      loss_percent: Number(principal.loss_percent) || 0,
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
    tamanho_tipo: mr.tamanho_tipo ?? null,
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
// NÃO deve sobrescrever o modelo semeado. "Tamanho em" (P-119 A, frente Tamanho em — G-plano ressalva #2): a vaga sem
// card GUARDA a escolha (`plan_tecido_slots.tamanho_tipo`); uma vaga cujo único dado é essa escolha também conta —
// senão o merge devolvia o slot semeado ao reabrir e o próximo Salvar gravava NULL (a escolha sumia).
export const savedTemDados = (s?: PtSlot): s is PtSlot =>
  !!s && (!!s.modelo_id || (s.materiais?.length ?? 0) > 0 || !!s.categoria_tecido_id || !!s.categoria_id || (s.referencia_paths?.length ?? 0) > 0 || !!s.tamanho_tipo);

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

// Distribuição por produto (spec R7) — mesmo princípio "Dev vence só se preenchido": o BOM vivo nunca tem distribuição;
// ela mora SÓ no plano. Leva a distribuição salva para a cor viva do Tecido 1 pela chave (`varKey`); a cor PLANEJADA
// salva que virou variante real no Dev é casada por cor + apelido. Sem nada a levar ⇒ o MESMO array.
export function comDistribuicaoDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  const sT1 = salvos.find(ehTecido1);
  const salvasT1 = sT1?.variantes ?? [];
  const comDist = salvasT1.filter((v) => Object.keys(v.distribuicao ?? {}).length > 0);
  if (comDist.length === 0) return vivos;
  const porKey = new Map(comDist.map((v) => [varKey(v), v.distribuicao!] as const));
  // Lote A fix1 · C2: o fallback por combo (cor PLANEJADA→real, R16) só pode usar variantes SALVAS PLANEJADAS
  // (variante_tecido_id null — nunca uma irmã de cor real já materializada, senão uma cor viva sem distribuição
  // herdava a da irmã de mesma cor base); só vale para uma chave viva que NÃO existe entre as salvas (senão a
  // própria já teria distribuição própria, mesmo vazia); e só quando há UM ÚNICO candidato daquela combinação
  // cor+apelido (2+ candidatos = ambíguo, não escolhe nenhum).
  const chavesSalvas = new Set(salvasT1.map(varKey));
  const porComboContagem = new Map<string, number>();
  for (const v of comDist) {
    if (v.variante_tecido_id != null || !v.cor_id) continue;
    const c = `${v.cor_id}|${v.cor_apelido_id ?? ""}`;
    porComboContagem.set(c, (porComboContagem.get(c) ?? 0) + 1);
  }
  const porCombo = new Map<string, PtVariante["distribuicao"]>(
    comDist
      .filter((v) => v.variante_tecido_id == null && !!v.cor_id && porComboContagem.get(`${v.cor_id}|${v.cor_apelido_id ?? ""}`) === 1)
      .map((v) => [`${v.cor_id}|${v.cor_apelido_id ?? ""}`, v.distribuicao!]),
  );
  let mudouAlgum = false;
  const out = vivos.map((m) => {
    if (!ehTecido1(m)) return m;
    let mudou = false;
    // Lote A fix2 · N4: uma combo planejada (cor+apelido) que casa com 2+ variantes VIVAS iguais (ex.: principal +
    // substituto, mesma cor·apelido) é herdada SÓ pela 1ª em `ordem` — nunca conta a mesma distribuição 2×; as
    // demais ficam sem (o Salvar do dialog é que decide se elas ganham distribuição própria).
    const combosConsumidos = new Set<string>();
    const porOrdem = [...m.variantes].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    const distDe = new Map<PtVariante, PtVariante["distribuicao"]>();
    for (const v of porOrdem) {
      if (Object.keys(v.distribuicao ?? {}).length > 0) continue;
      const chave = varKey(v);
      const porChave = porKey.get(chave);
      if (porChave) { distDe.set(v, porChave); continue; }
      if (chavesSalvas.has(chave) || !v.cor_id) continue;
      const combo = `${v.cor_id}|${v.cor_apelido_id ?? ""}`;
      if (combosConsumidos.has(combo)) continue;
      const d = porCombo.get(combo);
      if (!d) continue;
      combosConsumidos.add(combo);
      distDe.set(v, d);
    }
    const variantes = m.variantes.map((v) => {
      const d = distDe.get(v);
      if (!d) return v;
      mudou = true;
      return { ...v, distribuicao: d };
    });
    if (!mudou) return m;
    mudouAlgum = true;
    return { ...m, variantes };
  });
  return mudouAlgum ? out : vivos;
}

// "Atende a" (spec R7): o casamento do BOM vivo (complementa_variante_ids) VENCE; cor sem casamento no BOM (NULL) usa a
// lista salva no plano (mesmo bloco: tipo + número + artigo). O Tecido 1 nunca casa.
export function comAtendeDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  let mudouAlgum = false;
  const out = vivos.map((m) => {
    if (ehTecido1(m)) return m;
    const s = salvos.find((x) => x.tipo === m.tipo && Number(x.numero) === Number(m.numero) && (x.artigo_id ?? null) === (m.artigo_id ?? null));
    const porKey = new Map((s?.variantes ?? []).filter((v) => Array.isArray(v.atende)).map((v) => [varKey(v), v.atende!] as const));
    if (porKey.size === 0) return m;
    let mudou = false;
    const variantes = m.variantes.map((v) => {
      if (Array.isArray(v.atende)) return v;
      const a = porKey.get(varKey(v));
      if (!a) return v;
      mudou = true;
      return { ...v, atende: [...a] };
    });
    if (!mudou) return m;
    mudouAlgum = true;
    return { ...m, variantes };
  });
  return mudouAlgum ? out : vivos;
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
            // "Tamanho em" (frente Tamanho em, Tarefa 4): com card, a fonte é o MODELO (`slot` = seed = modelos.tamanho_tipo)
            // — igual ao markup_editado; o salvo só cobre o card cujo seed não trouxe o valor (modelo excluído). Sem card, é
            // dado PRÓPRIO da vaga (P-119 A, `plan_tecido_slots.tamanho_tipo`) → o salvo vence.
            tamanho_tipo: effModeloId ? (slot.tamanho_tipo ?? saved.tamanho_tipo ?? null) : (saved.tamanho_tipo ?? null),
            // Consistência (a.1): modelo REAL usa o BOM VIVO do Desenvolvimento (por modelo_id, não
            // pela posição), não o snapshot salvo — assim que o card avança/muda o BOM, o plano
            // reflete. Slot de planejamento (sem modelo) mantém o rascunho salvo.
            // Ordem dos fallbacks (todos "Dev vence só se preenchido"): consumo → variantes → pç.
            // comGradeDoPlano por ÚLTIMO porque depende das variantes já resolvidas (as que vieram do
            // plano via comVariantesDoPlano já trazem a pç; as que vieram do Dev sem grade — forro/
            // Tecido 2 ou variante nova do Tecido 1 — recebem a pç do plano aqui).
            // … → pç → distribuição (Tecido 1) → "atende a" (demais blocos) — Distribuição por produto, spec R7.
            materiais: effModeloId
              ? (live?.materiais?.length
                  ? comAtendeDoPlano(
                      comDistribuicaoDoPlano(
                        comGradeDoPlano(comVariantesDoPlano(comConsumoDoPlano(live.materiais, saved.materiais), saved.materiais), saved.materiais),
                        saved.materiais,
                      ),
                      saved.materiais,
                    )
                  : (saved.materiais ?? []))
              : (saved.materiais?.length ? saved.materiais : slot.materiais),
          };
        }) };
      }) };
    }),
  };
}
