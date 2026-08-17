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

/** Colapsa variantes duplicadas de UM material — mantém a de MAIOR grade_total (empate → a 1ª),
 *  renumerando `ordem` 1..n. Rede de proteção do FRONT que ESPELHA o dedup do servidor em
 *  `_salvar_plan_tecido_core` (migração 20260817130000): o auto-upgrade de cor planejada→real do
 *  MaterialBlock pode remapear 2 linhas distintas pra MESMA variante_tecido_id — sem colapsar, o card
 *  exibia/contava a cor 2× (inflava a Demanda dos painéis). Colapsa por identidade (mesma chave do
 *  `varKey`): cor real → variante_tecido_id; cor planejada → cor_id+cor_apelido_id. Linha SEM
 *  identidade (variante E cor ambos nulos) NUNCA colapsa — mantém linhas em branco sendo editadas.
 *  NUNCA soma grade_total (somar recriaria a inflação: a duplicata é uma anomalia "mesma cor 2×"). */
export function dedupVariantes(vs: PtVariante[]): PtVariante[] {
  const byKey = new Map<string, PtVariante>();
  const ordem: string[] = [];
  vs.forEach((v, i) => {
    const temIdentidade = !!v.variante_tecido_id || !!v.cor_id || !!v.cor_apelido_id;
    const k = temIdentidade ? varKey(v) : `__blank__:${i}`;
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, v);
      ordem.push(k);
    } else if ((Number(v.grade_total) || 0) > (Number(prev.grade_total) || 0)) {
      byKey.set(k, v);
    }
  });
  return ordem.map((k, i) => ({ ...byKey.get(k)!, ordem: i + 1 }));
}

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
 *  (então a cor é vermelha "baixa real"; senão é âmbar "comprometido").
 *  SOBRA = ENTREGUE − Demanda (jul/2026, decisão do dono): o físico que sobra do que REALMENTE chegou
 *  (não da metragem pedida). Fica NEGATIVA quando o entregue ainda não cobre a demanda (déficit físico)
 *  — comportamento desejado. (Antes era `pedida − Demanda` = "sobra prevista", otimista.) */
export type ContabOc = { reservadaLivre: number; usada: number; sobra: number; baixaDomina: boolean };
export function contabilizarOc(total: number, comprometido: number, baixa: number, entregue: number): ContabOc {
  const t = Number(total) || 0, c = Number(comprometido) || 0, b = Number(baixa) || 0, e = Number(entregue) || 0;
  const usada = Math.max(c, b);
  return { reservadaLivre: Math.max(0, t - usada), usada, sobra: e - Math.max(t, usada), baixaDomina: b > 0 && b >= c };
}

/** Reservada/comprometida por OC — FONTE ÚNICA consumida pelo Resumo (por OC) e pelo Drawer
 *  (por OC×variante). "Comprometido" = demanda dos cards já ENVIADOS À EXPLOSÃO (enviado_cad); o
 *  comprometido SAI da reservada (ver contabilizarOc). OC efetiva do slot: o vínculo real do Dev
 *  (vinculoOcMap por modelo) vence o hint do plano (slotOcMap por slot).
 *  ⚠️ O total por-OC (reservPorOc, via slotMetros) e a soma por-variante (reservPorOcVar) NÃO são
 *  garantidamente iguais: (a) variante sem variante_tecido_id conta no total mas não no por-variante;
 *  (b) um slot vinculado a 2+ OCs soma inteiro em cada OC. São casos raros; por isso o Drawer NÃO
 *  exibe total por-OC (só itens).
 *  (O split "do estoque" — parcela de cards "usar estoque existente" — foi REMOVIDO com a
 *  aposentadoria do flag usar_estoque, decisão do dono 17/ago/2026: régua única = vínculo abate a
 *  Sobra, sem vínculo é compra; não há mais um 3º estado "consome físico sem comprar" separado do
 *  vínculo.) */
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
  /** OC → set de artigo_id dos ITENS dela (da RPC de situação). Com o mapa, cada OC reserva SÓ os
   *  metros dos materiais cujo artigo pertence a ela — antes o card INTEIRO (forro + outros tecidos)
   *  era reservado em cada OC vinculada, inflando a reserva e deflacionando a Sobra (auditoria
   *  jul/2026, decisão do dono). Sem o mapa (compat), comportamento antigo. */
  ocArtigos?: Map<string, Set<string>>,
  /** OC → set de variante_tecido_id dos ITENS dela. Refina o filtro acima: parcela COM variante só
   *  conta na OC se a COR existe nos itens dela (a OC não pode servir uma cor que não tem — o total
   *  por OC dizia 576 e a soma por variante 567,04 na mesma tela). Parcela SEM variante (cor ainda
   *  não escolhida) segue contando pelo artigo. Sem o mapa (compat), só o filtro por artigo. */
  ocVariantes?: Map<string, Set<string>>,
): DetalheOc {
  const reservPorOc = new Map<string, number>();
  const comprometidoPorOc = new Map<string, number>();
  const nPorOc = new Map<string, number>();
  const reservPorOcVar = new Map<string, number>();
  const comprometidoPorOcVar = new Map<string, number>();
  const pertence = (ocId: string, artigoId: string | null | undefined): boolean => {
    const s = ocArtigos?.get(ocId);
    return !s ? true : (!!artigoId && s.has(artigoId));
  };
  const varPertence = (ocId: string, vid: string): boolean => {
    const s = ocVariantes?.get(ocId);
    return !s ? true : s.has(vid);
  };
  for (const sub of arvore.subcolecoes ?? []) for (const ln of sub.linhas ?? []) for (const slot of ln.slots ?? []) {
    if (!slot.id) continue;
    const devOc = slot.modelo_id ? (vinculoOcMap[slot.modelo_id] ?? []) : [];
    const ocIds = devOc.length ? devOc : (slotOcMap[slot.id] ?? []);
    if (!ocIds.length) continue;
    const enviado = !!slot.modelo_id && !!enviadoCadSet?.has(slot.modelo_id);
    // metros por parcela: COM variante (perVar) e SEM variante (por artigo) — a atribuição por OC
    // filtra pelo artigo da OC e, quando há o mapa, pela COR da OC (parcela com variante).
    const semVarPorArtigo = new Map<string, number>();
    const perVar = new Map<string, { artigoId: string | null; metros: number }>();
    for (const mat of slot.materiais ?? []) for (const v of mat.variantes ?? []) {
      const metros = necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
      if (metros <= 0) continue;
      if (v.variante_tecido_id) {
        const cur = perVar.get(v.variante_tecido_id) ?? { artigoId: mat.artigo_id ?? null, metros: 0 };
        cur.metros += metros;
        perVar.set(v.variante_tecido_id, cur);
      } else if (mat.artigo_id) {
        semVarPorArtigo.set(mat.artigo_id, (semVarPorArtigo.get(mat.artigo_id) ?? 0) + metros);
      }
    }
    for (const ocId of ocIds) {
      let mOc = 0;
      for (const [aid, metros] of semVarPorArtigo) if (pertence(ocId, aid)) mOc += metros;
      for (const [vid, pv] of perVar) if (pv.artigoId && pertence(ocId, pv.artigoId) && varPertence(ocId, vid)) mOc += pv.metros;
      reservPorOc.set(ocId, (reservPorOc.get(ocId) ?? 0) + mOc);
      nPorOc.set(ocId, (nPorOc.get(ocId) ?? 0) + 1);
      if (enviado) comprometidoPorOc.set(ocId, (comprometidoPorOc.get(ocId) ?? 0) + mOc);
      for (const [vid, pv] of perVar) {
        if (!pertence(ocId, pv.artigoId) || !varPertence(ocId, vid)) continue;
        const k = `${ocId}|${vid}`;
        reservPorOcVar.set(k, (reservPorOcVar.get(k) ?? 0) + pv.metros);
        if (enviado) comprometidoPorOcVar.set(k, (comprometidoPorOcVar.get(k) ?? 0) + pv.metros);
      }
    }
  }
  return { reservPorOc, comprometidoPorOc, nPorOc, reservPorOcVar, comprometidoPorOcVar };
}

// ─── "A comprar" AO VIVO (real-time) ──────────────────────────────────────────────────────────────
// O painel "A comprar" (Resumo) e o drawer 'comprar' mostravam o déficit do plano SALVO (prévia do
// servidor). O dono quer que MUDAR A QUANTIDADE no card mova o "a comprar" NA HORA, sem salvar.
// Desenho híbrido: necessidade AO VIVO do rascunho (front) − COBERTURA do servidor (estável entre
// saves, muda só com vínculos/OC/estoque, que já invalidam a prévia). Fonte ÚNICA p/ Resumo E drawer.

/** Linha de cobertura por variante vinda da prévia do servidor (chave `cobertura` de
 *  plan_tecido_previa_pedido) — TODAS as variantes reais da coleção, inclusive déficit 0. */
export type CoberturaVarRow = {
  artigo_id: string;
  variante_tecido_id: string | null;
  nec_m: number;
  deficit_m: number;
};

/** Cobertura ESTÁVEL de UMA variante, derivada da prévia do servidor: `max(0, nec_servidor −
 *  deficit_servidor)`. Como `deficit = max(0, nec − supply − rolo)`, isto é `min(nec_salvo, supply+rolo)`
 *  — depende só de OC/rolo/estoque (muda quando a prévia é invalidada), NÃO do rascunho de grade. */
export const coberturaVar = (necServidor: number, deficitServidor: number): number =>
  Math.max(0, (Number(necServidor) || 0) - (Number(deficitServidor) || 0));

/** "A comprar" AO VIVO de UMA variante: `max(0, nec_vivo − cobertura)`. Clampa em ≥0 POR VARIANTE
 *  (antes de qualquer soma — `Σ max(0,·) ≠ max(0,Σ)`). Quando `nec_vivo == nec_servidor` (rascunho ==
 *  salvo) devolve EXATAMENTE o `deficit_servidor` (paridade provada no teste). Unidade = METROS nos
 *  dois lados (o servidor mantém nec/deficit em metros; kg→m só entra no `qtd` do pedido). */
export const aComprarVivoVar = (necVivo: number, necServidor: number, deficitServidor: number): number =>
  Math.max(0, (Number(necVivo) || 0) - coberturaVar(necServidor, deficitServidor));

/** Necessidade VIVA do rascunho por `variante_tecido_id` (só cor REAL — cor planejada sem id fica de
 *  fora, igual à prévia do servidor, que não a cobre). Chave = a mesma do `varKey` p/ cor real. */
export function necVivoPorVariante(arvore: PtArvore): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of necessidadePorTecido(arvore))
    for (const v of t.variantes)
      if (v.variante_tecido_id) m.set(v.variante_tecido_id, (m.get(v.variante_tecido_id) ?? 0) + v.metros);
  return m;
}

/** "A comprar" AO VIVO agregado por ARTIGO: soma, POR VARIANTE (clamp antes de somar), o
 *  `aComprarVivoVar` de cada linha de cobertura do servidor, usando a necessidade viva do rascunho.
 *  Variante planejada por cor (sem `variante_tecido_id`) fica de fora — paridade com o servidor.
 *  Quando o rascunho == salvo, cada linha rende o próprio `deficit_m` ⇒ o total por artigo == o
 *  déficit do servidor por artigo (teste `paridade`). */
export function aComprarVivoPorArtigo(
  cobertura: CoberturaVarRow[],
  necVivoPorVar: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cobertura) {
    if (!c.variante_tecido_id) continue;
    const ac = aComprarVivoVar(necVivoPorVar.get(c.variante_tecido_id) ?? 0, c.nec_m, c.deficit_m);
    if (ac <= 0) continue;
    out.set(c.artigo_id, (out.get(c.artigo_id) ?? 0) + ac);
  }
  return out;
}

/** Rateio do déficit da COLEÇÃO para uma SUBCOLEÇÃO, por artigo: parte proporcional à necessidade
 *  da sub sobre a da coleção, limitada à necessidade da sub. nec 0 ⇒ 0 (a sub não deve nada);
 *  Σ dos rateios das subs = déficit da coleção. (Auditoria jul/2026: "nec 0 · a comprar 1.591,68"
 *  era o déficit da coleção inteira exibido no painel da subcoleção.) */
export function rateioDeficitSub(deficitColecao: number, necSub: number, necColecao: number): number {
  const d = Number(deficitColecao) || 0, ns = Number(necSub) || 0, nc = Number(necColecao) || 0;
  if (d <= 0 || ns <= 0) return 0;
  if (nc <= 0) return Math.min(ns, d);
  return Math.min(ns, (d * ns) / nc);
}

/** Monta o payload `_materiais` das RPCs que gravam o BOM do modelo a partir de um slot do plano
 *  (`plan_tecido_aplicar_ao_modelo` / `plan_tecido_criar_card`): tecido/forro + variantes +
 *  consumo + grade, com a grade distribuída por PROPORÇÃO quando a variante não tem grade própria
 *  (mesma regra do `distribuirGrade`). FONTE ÚNICA usada pelo card ("Aplicar ao modelo"/"Criar
 *  card") e pelo AUTO-APLICAR do save da coleção no Plan. Tecido — não duplicar a montagem. */
export function buildMateriaisAplicar(slot: PtSlot) {
  return (slot.materiais ?? []).map((m) => ({
    tipo: m.tipo,
    numero: m.numero,
    artigo_id: m.artigo_id,
    consumo: m.consumo,
    loss_percent: m.loss_percent,
    variantes: (m.variantes ?? []).map((v) => ({
      variante_tecido_id: v.variante_tecido_id,
      ordem: v.ordem,
      multiplicador: v.multiplicador,
      grades: v.grades && Object.keys(v.grades).length ? v.grades : distribuirGrade(v.grade_total, slot.proporcoes),
      grade_total: v.grade_total,
    })),
  }));
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
