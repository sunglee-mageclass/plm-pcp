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

/** D-1 (R9) — SOBRA de UMA OC como o Drawer a calcula: Σ POR COR (artigo × variante) de `contabilizarOc`
 *  (reservada/comprometida da `detalheOc` por OC×variante; entregue/baixa da Situação). Antes o Resumo aplicava
 *  `contabilizarOc` ao total da OC e o `max`/clamp por cor sumia — Resumo e Drawer discordavam quando uma cor
 *  estoura e outra sobra. O Resumo usa ESTE helper; o Drawer mostra as mesmas parcelas, cor a cor. */
export type SobraOcLinha = { oc_tecido_id: string; artigo_id: string; variante_tecido_id: string | null; entregue_m: number; usada_m: number };
export function sobraOc(
  ocId: string,
  linhas: readonly SobraOcLinha[],
  det: { reservPorOcVar: Map<string, number>; comprometidoPorOcVar: Map<string, number> },
): number {
  const cores = new Map<string, { vid: string | null; entregue: number; usada: number }>();
  for (const r of linhas) {
    if (r.oc_tecido_id !== ocId) continue;
    const k = `${r.artigo_id}|${r.variante_tecido_id}`;
    const cur = cores.get(k) ?? { vid: r.variante_tecido_id, entregue: 0, usada: 0 };
    cur.entregue += Number(r.entregue_m) || 0;
    cur.usada += Number(r.usada_m) || 0;
    cores.set(k, cur);
  }
  let total = 0;
  for (const c of cores.values()) {
    const chave = `${ocId}|${c.vid}`;
    total += contabilizarOc(det.reservPorOcVar.get(chave) ?? 0, det.comprometidoPorOcVar.get(chave) ?? 0, c.usada, c.entregue).sobra;
  }
  return total;
}

/** Vínculo OC↔modelo com prioridade e quantidade (RPC `plan_tecido_vinculos_detalhe`, 1 linha por
 *  vínculo modelo×tipo×numero×variante×item da OC). */
export type VinculoDetalhe = {
  modelo_id: string;
  tipo: string;
  numero: number;
  ordem?: number | null;
  variante_tecido_id: string | null;
  oc_tecido_item_id: string;
  oc_tecido_id: string;
  artigo_id: string | null;
  prioridade: number | null;
  quantidade_m: number | null;
};

/** Reparte `metros` entre candidatos EM SEQUÊNCIA (igual ao corte, P-168 A): cada um leva
 *  `min(restante, livre, quantidade_m se > 0)`; a SOBRA vai para o ÚLTIMO. Σ das partes = metros
 *  (nunca N×). `capacidade` (chave → metros) menos `usado` (mutado) dá o `livre`; chave ausente =
 *  sem limite. Devolve as partes na ordem dos candidatos. */
export function repartirDemanda(
  metros: number,
  candidatos: { chave: string; quantidade_m?: number | null }[],
  capacidade: Map<string, number> | undefined,
  usado: Map<string, number>,
): number[] {
  const out = new Array<number>(candidatos.length).fill(0);
  let restante = Number(metros) || 0;
  if (!candidatos.length || restante <= 0) return out;
  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    let parte: number;
    if (i === candidatos.length - 1) parte = restante;
    else {
      const cap = capacidade?.get(c.chave);
      const livre = cap === undefined ? Infinity : Math.max(0, cap - (usado.get(c.chave) ?? 0));
      const q = Number(c.quantidade_m) || 0;
      parte = Math.max(0, Math.min(restante, livre, q > 0 ? q : Infinity));
    }
    out[i] = parte;
    restante -= parte;
    usado.set(c.chave, (usado.get(c.chave) ?? 0) + parte);
  }
  return out;
}

/** Reservada/comprometida por OC — FONTE ÚNICA consumida pelo Resumo (por OC) e pelo Drawer
 *  (por OC×variante). "Comprometido" = demanda dos cards já ENVIADOS À EXPLOSÃO (enviado_cad); o
 *  comprometido SAI da reservada (ver contabilizarOc). OC efetiva do slot: o vínculo real do Dev
 *  (vinculoOcMap por modelo) vence o hint do plano (slotOcMap por slot).
 *  REPARTIÇÃO (P-168 A): a demanda de cada parcela (modelo×tipo×numero×variante, ou ×artigo quando
 *  ainda sem cor) é dividida ENTRE as OCs vinculadas, em sequência, como o corte consome
 *  (`repartirDemanda`): ordem por prioridade/oc_tecido_item_id, limite min(restante, livre,
 *  quantidade_m>0), sobra na ÚLTIMA OC. Σ por OC = demanda elegível (nunca N×). Cards: enviados à
 *  Explosão primeiro, depois a ordem da vaga. Sem `vinculos` (detalhe não carregado/hint do plano):
 *  ordem do array, sem limite quantidade_m, mas sempre em sequência.
 *  ⚠️ Parcela sem variante_tecido_id conta no total por-OC mas não no por-variante.
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

/** 7º parâmetro de `detalheOc`. `capacidade`: `${ocId}|${variante_tecido_id}` → metros (entregue_m se a
 *  OC está recebida, senão pedida_m); `${ocId}|artigo:${artigo_id}` p/ parcela sem variante. */
export type DetalheOcOpts = {
  vinculos?: VinculoDetalhe[];
  capacidade?: Map<string, number>;
  /** true enquanto a situação das OCs (capacidade) ainda não carregou: não reparte (mapas vazios) em vez de
   *  deixar a 1ª OC levar tudo de forma visível. */
  aguardando?: boolean;
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
  opts?: DetalheOcOpts,
): DetalheOc {
  const reservPorOc = new Map<string, number>();
  const comprometidoPorOc = new Map<string, number>();
  const nPorOc = new Map<string, number>();
  const reservPorOcVar = new Map<string, number>();
  const comprometidoPorOcVar = new Map<string, number>();
  if (opts?.aguardando) return { reservPorOc, comprometidoPorOc, nPorOc, reservPorOcVar, comprometidoPorOcVar };
  const pertence = (ocId: string, artigoId: string | null | undefined): boolean => {
    const s = ocArtigos?.get(ocId);
    return !s ? true : (!!artigoId && s.has(artigoId));
  };
  const varPertence = (ocId: string, vid: string): boolean => {
    const s = ocVariantes?.get(ocId);
    return !s ? true : s.has(vid);
  };
  // vínculos do detalhe por (modelo|tipo|numero), já em ordem prioridade (NULL por último) → item
  const vinPorChave = new Map<string, VinculoDetalhe[]>();
  for (const v of opts?.vinculos ?? []) {
    const k = `${v.modelo_id}|${v.tipo}|${v.numero}`;
    let arr = vinPorChave.get(k);
    if (!arr) { arr = []; vinPorChave.set(k, arr); }
    arr.push(v);
  }
  for (const arr of vinPorChave.values())
    arr.sort((x, y) => {
      const px = x.prioridade ?? Number.POSITIVE_INFINITY, py = y.prioridade ?? Number.POSITIVE_INFINITY;
      if (px !== py) return px < py ? -1 : 1;
      return x.oc_tecido_item_id < y.oc_tecido_item_id ? -1 : x.oc_tecido_item_id > y.oc_tecido_item_id ? 1 : 0;
    });
  const usado = new Map<string, number>();

  type SlotInfo = { slot: PtSlot; ocIds: string[]; enviado: boolean };
  const slotsInfo: SlotInfo[] = [];
  for (const sub of arvore.subcolecoes ?? []) for (const ln of sub.linhas ?? []) for (const slot of ln.slots ?? []) {
    if (!slot.id) continue;
    const devOc = slot.modelo_id ? (vinculoOcMap[slot.modelo_id] ?? []) : [];
    const ocIds = devOc.length ? devOc : (slotOcMap[slot.id] ?? []);
    if (!ocIds.length) continue;
    slotsInfo.push({ slot, ocIds, enviado: !!slot.modelo_id && !!enviadoCadSet?.has(slot.modelo_id) });
  }
  // enviados à Explosão primeiro (já consumiram), depois a ordem da vaga (sort estável)
  slotsInfo.sort((a, b) => Number(b.enviado) - Number(a.enviado));

  type ParcelaPlano = { vid: string | null; artigoId: string | null; tipo: string; numero: number; metros: number };
  const plano: { slot: PtSlot; ocIds: string[]; enviado: boolean; usaDetalhe: boolean; parcelas: ParcelaPlano[] }[] = [];
  for (const { slot, ocIds, enviado } of slotsInfo) {
    const usaDetalhe = !!slot.modelo_id && ocIds === (vinculoOcMap[slot.modelo_id] ?? []);
    type Parcela = { vid: string | null; artigoId: string | null; tipo: string; numero: number; metros: number };
    const parcelas = new Map<string, Parcela>();
    for (const mat of slot.materiais ?? []) for (const v of mat.variantes ?? []) {
      const metros = necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
      if (metros <= 0) continue;
      const tipo = mat.tipo ?? "tecido", numero = Number(mat.numero) || 1;
      if (v.variante_tecido_id) {
        const k = `${tipo}|${numero}|v:${v.variante_tecido_id}`;
        const cur = parcelas.get(k) ?? { vid: v.variante_tecido_id, artigoId: mat.artigo_id ?? null, tipo, numero, metros: 0 };
        cur.metros += metros;
        parcelas.set(k, cur);
      } else if (mat.artigo_id) {
        const k = `${tipo}|${numero}|a:${mat.artigo_id}`;
        const cur = parcelas.get(k) ?? { vid: null, artigoId: mat.artigo_id, tipo, numero, metros: 0 };
        cur.metros += metros;
        parcelas.set(k, cur);
      }
    }
    for (const ocId of ocIds) {
      reservPorOc.set(ocId, reservPorOc.get(ocId) ?? 0);
      nPorOc.set(ocId, (nPorOc.get(ocId) ?? 0) + 1);
    }
    plano.push({ slot, ocIds, enviado, usaDetalhe, parcelas: [...parcelas.values()] });
  }
  // 2 passes: primeiro TODAS as parcelas com variante, depois as só-artigo — o pool do artigo já enxerga
  // o que as variantes usaram (senão `oc|vid` poderia estourar a mesma OC depois). Dentro de cada passe
  // vale a ordem dos cards (enviados primeiro, depois a da vaga).
  for (const fase of [true, false]) for (const { slot, ocIds, enviado, usaDetalhe, parcelas } of plano) {
    for (const p of parcelas) {
      if (!!p.vid !== fase) continue;
      // candidatos elegíveis (artigo/cor da OC) na ordem do vínculo (prioridade) ou do array
      const elegivel = (ocId: string) => pertence(ocId, p.artigoId) && (!p.vid || varPertence(ocId, p.vid));
      let cands: { ocId: string; chave: string; quantidade_m?: number | null }[] = [];
      const todasLinhas = usaDetalhe ? (vinPorChave.get(`${slot.modelo_id}|${p.tipo}|${p.numero}`) ?? []) : [];
      // `ordem` do vínculo é a da VARIANTE (não do material): a seleção é por variante_tecido_id, sem filtro por ordem
      const linhas = todasLinhas;
      const chaveDe = (ocId: string) => (p.vid ? `${ocId}|${p.vid}` : `${ocId}|artigo:${p.artigoId}`);
      if (linhas.length) {
        const sel = p.vid ? linhas.filter((l) => l.variante_tecido_id === p.vid) : linhas.filter((l) => !l.variante_tecido_id || l.artigo_id === p.artigoId);
        const vistos = new Set<string>();
        for (const l of sel) {
          if (!elegivel(l.oc_tecido_id) || !ocIds.includes(l.oc_tecido_id)) continue;
          if (!p.vid) { // sem variante: 1 candidato por OC, na ordem da menor prioridade (sem limite quantidade_m)
            if (vistos.has(l.oc_tecido_id)) continue;
            vistos.add(l.oc_tecido_id);
            cands.push({ ocId: l.oc_tecido_id, chave: chaveDe(l.oc_tecido_id) });
          } else cands.push({ ocId: l.oc_tecido_id, chave: chaveDe(l.oc_tecido_id), quantidade_m: l.quantidade_m });
        }
      }
      // sem detalhe: ordem determinística (oc_tecido_id), não a do array (que varia com o fetch)
      if (!cands.length) cands = [...ocIds].sort().filter(elegivel).map((ocId) => ({ ocId, chave: chaveDe(ocId) }));
      if (!cands.length) continue;
      const partes = repartirDemanda(p.metros, cands, opts?.capacidade, usado);
      cands.forEach((c, i) => {
        const m = partes[i];
        if (m <= 0) return;
        reservPorOc.set(c.ocId, (reservPorOc.get(c.ocId) ?? 0) + m);
        if (enviado) comprometidoPorOc.set(c.ocId, (comprometidoPorOc.get(c.ocId) ?? 0) + m);
        if (p.vid) {
          // a mesma OC tem UM estoque por artigo: o que a variante consome também sai do pool do artigo
          if (p.artigoId) {
            const ka = `${c.ocId}|artigo:${p.artigoId}`;
            usado.set(ka, (usado.get(ka) ?? 0) + m);
          }
          const k = `${c.ocId}|${p.vid}`;
          reservPorOcVar.set(k, (reservPorOcVar.get(k) ?? 0) + m);
          if (enviado) comprometidoPorOcVar.set(k, (comprometidoPorOcVar.get(k) ?? 0) + m);
        }
      });
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
