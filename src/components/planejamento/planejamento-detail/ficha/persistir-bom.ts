// Salvar único do Planejamento (Task 3) — MONTADORES do núcleo do Salvar. Antes este arquivo GRAVAVA (persistirBom: RPC do BOM + diff
// de etiquetas CRU; persistirCad: RPC do CAD), cada um numa transação. Agora só MONTA o payload e o hook chama UMA vez a RPC
// `salvar_card_planejamento` (migration 20261108100000), que grava tudo numa transação atômica (tudo ou nada). Funções PURAS — testadas
// sem mock de Supabase (`tests/unit/salvar-card-nucleo.test.ts`).
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload,
  type BomCapturado, type FlagsBom, type GradeRowDb,
} from "./ficha-calc";
import type { CadCapturado } from "./ficha-cad";
import { chavesFichaBom } from "./useFichaDados";

/** `_bom` da RPC: o que o `salvar_modelo_bom` recebia. Só quando `bom.gravar` (senão o bloco vai NULL = não mexe no BOM). */
export function montarBomPayload(bom: BomCapturado): { tecidos: unknown[]; aviamentos: unknown[]; grades: unknown[] } {
  return {
    tecidos: montarTecidosPayload(bom.estado.blocks) as unknown[],
    aviamentos: montarAviamentosPayload(bom.estado.aviamentos) as unknown[],
    // F3.4 — comprado: a grade cor × tamanho (a RPC apaga TODAS as grades — nunca mandar a da ficha, que é projetada fora).
    // `gradesPayload` null num comprado só existe quando o BOM NÃO grava (a captura LANÇA antes — R1 do G-plano F3.4).
    grades: (bom.gradesPayload ?? montarGradesPayload(bom.estado.grades)) as unknown[],
  };
}

/**
 * `_etiquetas` da RPC: o ESTADO COMPLETO dos insumos do card (linha com `id` = já existe; sem `id` = nova). A RPC faz o diff
 * (UPDATE/INSERT/DELETE) e numera pela posição entre as linhas COM insumo — o mesmo que `planoEtiquetas` fazia no navegador.
 * Linha sem `etiqueta_id` é ignorada (e, se tinha `id`, o insumo some do card — igual ao plano antigo).
 */
export function montarEtiquetasPayload(rows: ModeloEtiquetaRow[]): { id: string | null; etiqueta_id: string; cor_id: string | null; consumo: number; loss_percent: number; custo_previsto: number }[] {
  return rows.filter((r) => r.etiqueta_id).map((r) => ({
    id: r.id ?? null, etiqueta_id: r.etiqueta_id as string, cor_id: r.cor_id || null,
    consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
  }));
}

/**
 * `_cad` da RPC (nomes SEM underscore): o que o `salvar_cad_completo` recebia (F3.3). `null` = o CAD não grava neste Salvar
 * (`cad.gravar` já decidiu tudo — `deveGravarCad`). ⚠️ Paridade com o Dev: num card JÁ enviado (com "Editar") isso apaga os ajustes
 * da Explosão (obs. do molde, envio por tamanho, "a separar"/"a enviar") — decisão F3 #7 (a); correção = tarefa própria.
 */
export function montarCadRpcPayload(cad: CadCapturado): Record<string, unknown> | null {
  if (!cad.gravar || !cad.payload) return null;
  const p = cad.payload;
  return {
    tecidos: p._tecidos, grades: p._grades, aviamentos: p._aviamentos, etiquetas: p._etiquetas, proporcoes: p._proporcoes,
    observacoes_molde: p._observacoes_molde, data_previsao_corte: p._data_previsao_corte,
  };
}

/** `_revisao` da RPC: o que decidia `marcar_revisao_por_mudanca` (#Erro nas etapas seguintes). NULL = não marca. */
export function montarRevisaoPayload(bom: Pick<BomCapturado, "gravar" | "flags">): FlagsBom | null {
  if (!bom.gravar) return null;
  const f = bom.flags;
  if (!(f.grade || f.consumo || f.aviamentos)) return null;
  return { grade: f.grade, consumo: f.consumo, aviamentos: f.aviamentos };
}

export type EntradaNucleo = {
  modeloId: string;
  /** Colunas de `modelos` do Salvar (o MESMO `payload` do antigo UPDATE, já passado por `omitirColunasTravadas`). */
  header: Record<string, unknown>;
  /** Trava otimista ÚNICA do card (`revCongelado`). NÃO pode ser null aqui — o hook trata antes (null = sem trava no servidor). */
  revBase: number;
  bom: BomCapturado;
  /** Grade da revenda quando `isRevenda && gradeRevendaDirty`; senão null. */
  gradeRevenda: unknown[] | null;
  /** Linhas de M.O. (já em `moLinhaParaPayload`) quando a M.O. grava neste Salvar; senão null. */
  mo: unknown[] | null;
};

/** Argumentos de `supabase.rpc("salvar_card_planejamento", …)`. Cada bloco só vai se for gravar; senão NULL (= o servidor não mexe). */
export function montarArgsSalvarCard(i: EntradaNucleo) {
  return {
    _modelo_id: i.modeloId,
    _header: i.header,
    _rev_base: i.revBase,
    _bom: i.bom.gravar ? montarBomPayload(i.bom) : null,
    _etiquetas: i.bom.gravar ? montarEtiquetasPayload(i.bom.estado.etiquetas) : null,
    _cad: montarCadRpcPayload(i.bom.cad),
    _mo: i.mo,
    _grade_revenda: i.gradeRevenda,
    _revisao: montarRevisaoPayload(i.bom),
    _flags: {},
  };
}

export type RetornoSalvarCard = { modelo_id: string; rev: number | null; revisao_marcada: Record<string, unknown> };

/**
 * UMA chamada, UMA transação: cabeçalho + BOM + insumos + CAD + M.O. + grade da revenda + #Erro (tudo ou nada). Erro do servidor é
 * relançado como veio (P0409 `conflito_versao: card` = a trava otimista; o hook trata). ⚠️ O `rev` devolvido é o de DENTRO da
 * transação — o processador adiado do custo pode somar +1 no COMMIT: quem precisa do rev final RELÊ o card (refetch de `["modelo"]`).
 */
export async function salvarCardPlanejamento(i: EntradaNucleo): Promise<RetornoSalvarCard> {
  const { data, error } = await supabase.rpc("salvar_card_planejamento" as any, montarArgsSalvarCard(i) as any);
  if (error) throw error;
  const r = (data ?? {}) as Partial<RetornoSalvarCard>;
  return { modelo_id: r.modelo_id ?? i.modeloId, rev: r.rev ?? null, revisao_marcada: r.revisao_marcada && typeof r.revisao_marcada === "object" ? r.revisao_marcada : {} };
}

/**
 * F3.3 — quem lê o CAD relê depois de o Salvar gravá-lo (Dev :2244-2266 + o CQ/Lançar do Planejamento, `plan-cq`).
 * Fix round 1 (revisão Opus das T5+T6, M2) — cobre também o que `_salvar_cad_completo_core` mexe quando SÓ o CAD
 * grava (sem o BOM tocado neste Salvar, então as invalidações do `bom.gravar` em `usePlanejamentoSave` não rodam):
 * `modelo_grades` (linhas zeradas e poda — funcoes.sql :6797-6810), consumo (devolvido ao BOM — :6878-6881) e
 * estoque (a grade real que `salvar_cad_completo` grava alimenta a reserva do tecido). `chavesFichaBom` já traz
 * `plan-ficha-grades`/`plan-ficha-tecidos` (Sheet do Planejamento relê grade e consumo) e `plan-ficha-cad` (o
 * próprio CAD); `estoque-tecidos` é a MESMA key que o Dev invalida sempre (`ModeloDetailPanel.tsx:2247`).
 */
export function invalidarAposGravarCad(qc: QueryClient, modeloId: string | null): void {
  for (const k of ["dev-cad-row", "explosao-cad-row", "modelo-cad-calc", "plan-cq"]) qc.invalidateQueries({ queryKey: [k, modeloId] });
  for (const k of ["dev-cad-tecidos", "dev-cad-aviamentos", "dev-cad-etiquetas", "explosao-cad-tecidos", "explosao-cad-grades"]) {
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === k });
  }
  qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
  // `chavesFichaBom` (nota abaixo) já cobre o cache PRÓPRIO da ficha do Planejamento (plan-ficha-*); esta função
  // some quando SÓ o CAD grava (BOM não tocado neste Salvar) — nesse cenário as invalidações "genéricas" de
  // `bom.gravar` em usePlanejamentoSave.ts (~:519-521) NÃO rodam, e telas que leem por essas chaves (não as
  // `plan-ficha-*`) ficavam com cache velho. Fix pós-T9 (item 2, M2 da re-revisão de 67e363f) — mesmas 3 keys
  // exatas de usePlanejamentoSave.ts (~:519-521): consumo/grade/estoque que o CAD também deriva.
  for (const k of ["modelo-tecidos-consumo", "modelo-grades"]) qc.invalidateQueries({ queryKey: [k, modeloId] });
  qc.invalidateQueries({ queryKey: ["estoque-tecido-por-artigo"] });
  // Fix T9 M6 — `["modelo-condicoes-kanban", modeloId]` (a MESMA key que o Dev usa — ModeloDetailPanel.tsx:284
  // — pra avaliar `cad_preenchido`/demais condições do kanban) também faltava aqui: com SÓ o CAD gravando
  // (BOM não tocado), a condição `cad_preenchido` (que olha `cad_tecidos.tamanho_folha`/`cad_tecido_variantes.
  // quantidade_folhas`/`metragem_planejada` — exatamente o que este Salvar acabou de gravar) ficava com o cache
  // velho no card do kanban do Desenvolvimento até um refetch manual.
  qc.invalidateQueries({ queryKey: ["modelo-condicoes-kanban", modeloId] });
  for (const k of chavesFichaBom(modeloId)) qc.invalidateQueries({ queryKey: k });
  qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
}

/**
 * G-mockup R3 / decisão F3 #9 — BOM inicial = Tecido 1..3 só com o artigo. ⚠️ SÓ para modelo RECÉM-CRIADO
 * (Dialog "Novo Modelo" e Duplicar): `salvar_modelo_bom` APAGA o BOM inteiro antes de inserir.
 */
export async function gravarTecidosIniciais(modeloIdRecemCriado: string, artigoIds: string[]): Promise<void> {
  const tecidos = blocosTecidosIniciais(artigoIds);
  if (tecidos.length === 0) return;
  const { error } = await supabase.rpc("salvar_modelo_bom" as any, {
    _modelo_id: modeloIdRecemCriado,
    _tecidos: tecidos as any,
    _aviamentos: [] as any,
    _grades: [] as any,
    _rev_base: null,
  });
  if (error) throw error;
}

/**
 * F3.3 — Importar dados, "Observações (bloco)": SUBSTITUI na hora (Dev :2383-2394 — o bloco `ModeloObservacoes` é
 * auto-save, fora do Salvar). Apaga SEMPRE (origem vazia limpa o destino) e insere as linhas da origem.
 */
export async function substituirObservacoesDoBloco(
  modeloId: string,
  linhas: { ordem: number | null; descricao: string | null; observacao: string | null }[],
): Promise<void> {
  const { error: eDel } = await supabase.from("modelo_observacoes" as any).delete().eq("modelo_id", modeloId);
  if (eDel) throw eDel;
  const rows = linhas.map((o) => ({ modelo_id: modeloId, ordem: o.ordem, descricao: o.descricao, observacao: o.observacao }));
  if (rows.length === 0) return;
  const { error: eIns } = await supabase.from("modelo_observacoes" as any).insert(rows);
  if (eIns) throw eIns;
}

/**
 * F3.4 — R1 do G-plano F3.4. A grade do SERVIDOR que o `salvar_modelo_bom` de um card COMPRADO recebe (ele APAGA todas as
 * grades) é LIDA NO PRÓPRIO Salvar — nunca o cache `plan-ficha-grades`: uma mudança alheia sem toque só INVALIDA o cache
 * (useFichaTecnica `aoMudarNoServidor`) e o merge já avançou o `revRef`; um Salvar nessa janela passaria no `.eq("rev")` do
 * header e regravaria a grade VELHA por cima da nova. `rev` e grade vêm num SELECT só (embed `modelo_grades`, o mesmo de
 * PlanTecidoSheet.tsx:457) ⇒ do mesmo instante. `rev` lido ≠ o que o `revDoCard()` devolve (fix C1 — o CALLER, em
 * `usePlanejamentoSave.ts`, congela `revCongelado = revRef.current` no MESMO ponto síncrono em que o rascunho `d` é
 * congelado, ANTES deste await; `revDoCard` é um fechamento que devolve ESSE `revCongelado`, não `revRef.current` lido de
 * novo aqui dentro — se o merge do colab avançar `revRef` durante este SELECT, o valor já capturado não muda) ⇒ P0409: o
 * retry que já existe relê o modelo e o BOM e tenta 1×. Erro ⇒ lança: falha FECHADA (nunca devolve [] como "o servidor não
 * tem grade").
 */
export async function lerGradeServidorComprado(modeloId: string, revDoCard: () => number | null): Promise<GradeRowDb[]> {
  const { data, error } = await (supabase.from("modelos") as any)
    .select("rev, grades:modelo_grades(variante_numero, grades, grade_total)")
    .eq("id", modeloId)
    .single();
  if (error) throw error;
  if (!data || !Array.isArray(data.grades)) {
    throw new Error("Não deu para conferir a grade deste card no servidor — nada foi salvo. Tente de novo.");
  }
  const rev = revDoCard();
  if (rev === null || data.rev !== rev) {
    const conflito: any = new Error("conflito_versao: o registro foi salvo por outra pessoa");
    conflito.code = "P0409";
    throw conflito;
  }
  return data.grades as GradeRowDb[];
}
