// Helpers PUROS do detalhe do Planejamento (sem JSX e sem hooks). Extraídos na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava (só ganhou
// `export`). A F3.1 acrescenta em ROTULO_CONFLITO_PLAN os rótulos dos campos novos.
import { useQueryClient } from "@tanstack/react-query";
import { type CustoSimInput } from "@/lib/preco";
import type { Draft } from "@/components/planejamento/modelo-shared";

// Colab round 4 (padrão do piloto/Desenvolvimento) — rótulos PT dos paths do Draft p/ o
// banner de resolução genérica de conflito. O merge compara TODAS as chaves do Draft; path
// sem rótulo cai no fallback (o próprio path) — nunca fica sem saída no banner.
const ROTULO_CONFLITO_PLAN: Record<string, string> = {
  nome: "Nome do Modelo", estilista_id: "Estilista", linha_id: "Linha",
  colecao: "Coleção", colecao_id: "Coleção", subcolecao: "Subcoleção", semana: "Semana de Lançamento",
  mes_id: "Mês de Planejamento", ano_id: "Ano",
  categoria_principal_id: "Categoria", subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2",
  origem: "Origem", preco_venda: "Preço para venda", preco_atacado: "Preço atacado", markup_editado: "Markup aplicado", data_lancamento: "Data de Lançamento",
  tecidos_planejados: "Tecido Planejado", status_planejamento: "Status",
  croqui_url: "Foto do Croqui", desenho_tecnico_url: "Desenho Técnico",
  fotos_modelo: "Fotos do modelo", fotos_referencia: "Fotos de referência",
  observacoes_gerais: "Observações Gerais", observacoes_mao_obra: "Obs. Mão de obra",
  versao: "Versão", modelo_base_id: "Modelo base", custo_simulado: "Simulação de custo",
  // F3.1 — campos vindos do Desenvolvimento + Descrição do produto (rótulos do Dev,
  // ModeloDetailPanel.tsx:145-160, e do mockup aprovado).
  ref: "REF", modelista_id: "Modelista",
  piloteiro1_id: "Piloteiro 1", piloteiro2_id: "Piloteiro 2", piloteiro3_id: "Piloteiro 3",
  data_piloto1: "Data Piloto 1", data_piloto2: "Data Piloto 2", data_piloto3: "Data Piloto 3",
  data_desenho_tecnico: "Data Desenho Técnico", data_aprovacao: "Data Aprovação",
  observacoes_tecnicas: "Observações Técnicas", motivo_cancelamento: "Motivo do cancelamento",
  ficha_medida_url: "Ficha de Medidas", descricao_produto: "Descrição do produto",
  // F3.2 — colunas do Dev editadas nas seções Grade e Preço e Custos.
  proporcoes: "Proporções da grade", custos_adicionais: "Custos adicionais",
  // F3.6 — seção "4. Códigos".
  tamanho_tipo: "Tamanho em",
  // F3.6 (Parte B) — seção 1 e Preço e Custos.
  titulo_pagina: "Título para a página", peso_kg: "Peso (kg)", comprimento_cm: "Comprimento (cm)", largura_cm: "Largura (cm)",
  altura_cm: "Altura (cm)", ncm: "NCM do Produto", preco_anterior: "Preço anterior",
};
export function rotuloConflitoPlan(path: string): string {
  // F3.2 — conflito de SEÇÃO do BOM: mesmo path e rótulo do Desenvolvimento (ModeloDetailPanel.tsx:160-163).
  if (path === "secao:bom") return "Tecidos & BOM";
  return ROTULO_CONFLITO_PLAN[path] ?? path;
}

// Normaliza a simulação de custo p/ salvar: só valores > 0; se tudo vazio → null.
// preco_tecido_m NÃO é gravado (é derivado do Tecido Planejado mais caro); consumo_tecido
// aqui é só o OVERRIDE manual (quando nulo, a tela usa o consumo real do BOM).
export function limparCustoSim(s: CustoSimInput | null | undefined): CustoSimInput | null {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const out: CustoSimInput = {
    consumo_tecido: n(s?.consumo_tecido),
    aviamento: n(s?.aviamento),
    mao_obra: n(s?.mao_obra),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// MO por serviço: invalidations padrão após aprovar/reprovar POR SERVIÇO (`aprovar_servico_mo`,
// spec 2026-08-11 Task 2). Compartilhada entre o editor do detalhe (aprovação de dentro do card
// aberto, aqui) e a seção expandida da lista (`ModeloCard` via `PlanejamentoPage`) sem duplicar
// a lista de queryKeys entre as duas mutations.
export function invalidarAposAprovarMO(qc: ReturnType<typeof useQueryClient>, modeloId: string) {
  // Re-sincroniza a rev do colab (o rollup no banco bumpa `modelos.rev`) — sem isto o próximo
  // Salvar do card compara `.eq('rev', revRef)` desatualizado e dá P0409 falso.
  qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
  qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
  qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
  qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
  // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem isto o
  // Dev não ficava sabendo de aprovações feitas aqui sem refetch manual.
  qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
  // Reprovar MO pode REGREDIR o card no kanban (Fase 2) — refresca o board de Desenvolvimento.
  qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
}

// ── F3.1 — regras dos campos vindos do Desenvolvimento no payload do Salvar/Duplicar ──────────────
// Chaves do Draft que são do Desenvolvimento. SEM permissão de editar o Dev, o Salvar as OMITE
// (decisão F3 #8); o Duplicar não as leva, menos Obs. Gerais, que já era copiada (decisão F3 #9).
// A F3.2 acrescenta aqui os escalares do Dev que ela passar a gravar (ex.: proporcoes, custos_adicionais).
export const CAMPOS_DEV_DRAFT = [
  "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
  "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",
  // F3.2 — colunas do Dev (objeto/array, não escalar) que o Sheet passa a gravar (Grade e Preço e
  // Custos). Lista ÚNICA da campanha: sem permissão do Dev saem do payload (aplicarRegrasCamposDev) e
  // o Duplicar não os leva (camposParaDuplicar, decisão F3 #9). Vão como estão (vazio = {} / [] é
  // valor válido — sem normalização em aplicarRegrasCamposDev, ao contrário dos escalares acima).
  "proporcoes", "custos_adicionais",
] as const satisfies readonly (keyof Draft)[];
export type CampoDevDraft = (typeof CAMPOS_DEV_DRAFT)[number];

/** Texto vazio/só-espaço (ou ausente) → NULL; senão o texto como está. */
export function textoOuNull(s: string | null | undefined): string | null {
  return s != null && s.trim() !== "" ? s : null;
}

// ── F3.6 (Parte B — spec 2026-09-25 §5.2) — campos novos do Planejamento no payload / Duplicar / eco do Salvar ─────────
/** NCM do Produto (ruling 3): só dígitos e pontos, até 10 caracteres — sem tabela oficial nem sugestão (validação no cliente).
 *  R30: a vírgula vira ponto ANTES do filtro (o `inputMode="decimal"` do iOS pt-BR mostra "," no lugar de "."). */
export function filtrarNcm(s: string | null | undefined): string {
  return (s ?? "").replace(/,/g, ".").replace(/[^0-9.]/g, "").slice(0, 10);
}
/** Número do Draft → coluna: vazio/null/inválido ⇒ NULL; senão arredondado às `casas` da coluna. 0 VALE (CHECK >= 0). */
export function numeroOuNull(v: unknown, casas: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
/** O valor canônico que o MoneyInput emite ("" = vazio) → Draft. */
export function numeroDoInput(v: string): number | null {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) ? null : n;
}
/** Preço anterior (ruling 11): mesmo padrão do preço de venda — vazio/0 = NULL = automático (não "preço zero"). */
export function precoAnteriorOuNull(v: unknown): number | null {
  const n = numeroOuNull(v, 2);
  return n !== null && n > 0 ? n : null;
}
/** O que a linha "Preço anterior" mostra: o fixado à mão; senão o preço EFETIVO (o digitado ou o sugerido); 0 ⇒ vazio. */
export function precoAnteriorExibido(fixado: number | null | undefined, efetivo: number): number | null {
  if (fixado !== null && fixado !== undefined) return fixado;
  return efetivo > 0 ? efetivo : null;
}
/** Os 6 campos novos que vão em TODO payload (o Preço anterior tem regra de permissão própria — no save). Título aparado. */
export function camposNovosParaPayload(
  d: Pick<Draft, "titulo_pagina" | "ncm" | "peso_kg" | "comprimento_cm" | "largura_cm" | "altura_cm">,
) {
  return {
    titulo_pagina: textoOuNull((d.titulo_pagina ?? "").trim()),
    ncm: textoOuNull(filtrarNcm(d.ncm)),
    peso_kg: numeroOuNull(d.peso_kg, 3),
    comprimento_cm: numeroOuNull(d.comprimento_cm, 2),
    largura_cm: numeroOuNull(d.largura_cm, 2),
    altura_cm: numeroOuNull(d.altura_cm, 2),
  };
}

/**
 * Aplica ao payload (UPDATE ou INSERT de `modelos`) as regras dos campos vindos do Dev. PURO: devolve cópia.
 *  • podeEditarDev → normaliza vazios para NULL (paridade com o Dev, ModeloDetailPanel.tsx:1877-1898 —
 *    data "" daria 22007 no PostgREST). `motivo_cancelamento` vai como está no Draft: a etapa NUNCA o apaga
 *    aqui (dono, 23/set — ao contrário do Dev, que zera fora de Reprovado).
 *  • sem podeEditarDev → as chaves de `CAMPOS_DEV_DRAFT` SAEM do payload (o banco fica com o que tinha).
 *  • REF: só vai quando `refEditavel` (campo visível a partir da etapa configurada E Dev editável, sem
 *    trava), aparada, vazia → NULL; senão SAI do payload, como antes (a REF é do trigger fn_modelo_ref_auto,
 *    invariante #11).
 *  • A etapa (`status_desenvolvimento`) não existe no Draft e nunca é posta aqui.
 */
export function aplicarRegrasCamposDev(
  payload: Record<string, unknown>,
  draft: Draft,
  o: { podeEditarDev: boolean; refEditavel: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  if (o.podeEditarDev) {
    out.modelista_id = draft.modelista_id || null;
    out.piloteiro1_id = draft.piloteiro1_id || null;
    out.piloteiro2_id = draft.piloteiro2_id || null;
    out.piloteiro3_id = draft.piloteiro3_id || null;
    out.data_piloto1 = draft.data_piloto1 || null;
    out.data_piloto2 = draft.data_piloto2 || null;
    out.data_piloto3 = draft.data_piloto3 || null;
    out.data_desenho_tecnico = draft.data_desenho_tecnico || null;
    out.data_aprovacao = draft.data_aprovacao || null;
    out.observacoes_tecnicas = draft.observacoes_tecnicas || null;
    out.motivo_cancelamento = draft.motivo_cancelamento || null;
    out.ficha_medida_url = draft.ficha_medida_url || null;
    out.observacoes_gerais = draft.observacoes_gerais || null;
  } else {
    for (const k of CAMPOS_DEV_DRAFT) delete out[k];
  }
  const ref = (draft.ref ?? "").trim();
  if (o.podeEditarDev && o.refEditavel) out.ref = ref || null;
  else delete out.ref;
  return out;
}

/**
 * Duplicar (decisão F3 #9): a nova versão herda o de HOJE — Planejamento + tecidos (só o artigo) + Obs. Gerais —
 * e o resto do Desenvolvimento nasce vazio. Tira REF (a nova versão gera a própria), versão e base (o chamador
 * recalcula) e os campos do Dev. A Descrição do produto VAI (é do Planejamento).
 * F3.6 (ruling 5, decisão do dono 25/set): Título e Preço anterior voltam ao AUTOMÁTICO (ficam FORA, como ref/versão/base);
 * NCM e Peso/medidas VÃO (mesmo tipo de produto), já normalizados como no Salvar.
 */
export function camposParaDuplicar(draft: Draft): Record<string, unknown> {
  const { versao: _v, modelo_base_id: _b, ref: _r, titulo_pagina: _t, preco_anterior: _pa, ...rest } = draft;
  const out: Record<string, unknown> = { ...rest };
  for (const k of CAMPOS_DEV_DRAFT) if (k !== "observacoes_gerais") delete out[k];
  out.descricao_produto = textoOuNull(draft.descricao_produto);
  const { titulo_pagina: _tn, ...novos } = camposNovosParaPayload(draft);
  Object.assign(out, novos);
  return out;
}

/**
 * Fonte do payload do Salvar (fix round 1, T2): o ESPELHO ao vivo do draft, NÃO o draft
 * capturado no closure do render (receita do Dev, ModeloDetailPanel.tsx:1849-1853). No
 * retry pós-P0409, `save.mutate()` é chamado de dentro do `onError` — o React ainda não
 * re-renderizou entre o `setDraft(md.valor)` do merge e essa chamada, então o `draft` do
 * closure da mutation (fixado quando o hook foi criado) está ANTERIOR ao merge. Ler do ref
 * (atualizado SINCRONAMENTE a cada render E, no onError, logo após o merge) garante que o
 * retry envia os campos ADOTADOS do outro usuário — sem isto, o retry reverteria em
 * silêncio o que o Dev acabou de salvar. Fora do retry, `draftLiveRef.current === draft`
 * (mesmo valor, semântica idêntica a antes).
 */
export function draftParaSalvar(draftLiveRefCurrent: Draft | null | undefined, draft: Draft): Draft {
  return draftLiveRefCurrent ?? draft;
}

/**
 * Fix final (F3.1, item 2 — "eco do próprio Salvar"): normaliza o `Draft` com as MESMAS regras
 * que `usePlanejamentoSave` aplica ao montar o payload (`ref.trim()` e `descricao_produto` via
 * `textoOuNull`) — nenhuma outra regra de `aplicarRegrasCamposDev`, que depende de
 * permissão/etapa e não faz parte do "o que o servidor gravou". Usado para construir o
 * `savedDraft` que vira `baseRef` após o Salvar: sem isto, `baseRef` guardava o valor CRU
 * (ex.: `" ABC "` ou `"   "`) enquanto o banco gravou o normalizado (`"ABC"` ou `NULL`); no
 * próximo refetch, o merge via `mergeDraft` comparava base≠fresh nesses 2 campos e mostrava
 * "Alguém salvou agora — 1 campo" para o PRÓPRIO save de quem acabou de clicar Salvar.
 * F3.6: + Título/NCM/Peso/medidas/Preço anterior (camposNovosParaPayload/precoAnteriorOuNull).
 */
export function normalizarDraftSalvo(d: Draft): Draft {
  return {
    ...d,
    ref: (d.ref ?? "").trim(),
    descricao_produto: textoOuNull(d.descricao_produto) ?? "",
    // F3.6 — os 7 campos novos com as MESMAS regras do payload (senão o eco do próprio Salvar vira "alguém salvou agora").
    ...camposNovosParaPayload(d),
    preco_anterior: precoAnteriorOuNull(d.preco_anterior),
  };
}
