// F3.2 — gravações do BOM feitas pelo Sheet do Planejamento (fora do React). Toda escrita de BOM passa por
// `salvar_modelo_bom` (a RPC guarda snapshot em `modelo_bom_snapshots` antes de apagar — G-inicial #7);
// etiquetas por diff de id em `modelo_etiquetas` (MESMO caminho do Dev, ModeloDetailPanel.tsx:2038-2060 —
// etiqueta não reserva estoque, fica fora da RPC).
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, planoEtiquetas,
  type BomCapturado,
} from "./ficha-calc";
import type { CadCapturado } from "./ficha-cad";
import { chavesFichaBom } from "./useFichaDados";

/** Grava o BOM capturado. `_rev_base: null`: a trava otimista já validou no UPDATE de `modelos` (Dev :1950-1959). */
export async function persistirBom(modeloId: string, bom: BomCapturado): Promise<void> {
  const { error: eBom } = await supabase.rpc("salvar_modelo_bom" as any, {
    _modelo_id: modeloId,
    _tecidos: montarTecidosPayload(bom.estado.blocks) as any,
    _aviamentos: montarAviamentosPayload(bom.estado.aviamentos) as any,
    _grades: montarGradesPayload(bom.estado.grades) as any,
    _rev_base: null,
  });
  if (eBom) throw eBom;
  const plano = planoEtiquetas(bom.estado.etiquetas, bom.idsEtiquetasServidor, modeloId);
  for (const op of plano.ops) {
    if (op.tipo === "atualizar") {
      const { error } = await supabase.from("modelo_etiquetas" as any).update(op.row).eq("id", op.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("modelo_etiquetas" as any).insert(op.row);
      if (error) throw error;
    }
  }
  if (plano.apagar.length > 0) {
    const { error } = await supabase.from("modelo_etiquetas" as any).delete().in("id", plano.apagar);
    if (error) throw error;
  }
}

/**
 * F3.3 — grava o CAD pela MESMA RPC do Dev (`salvar_cad_completo`, ModeloDetailPanel.tsx:2092-2118). A RPC APAGA e
 * re-insere tecidos/variantes/aviamentos/etiquetas do CAD e, com grade, `cad_grades` e `modelo_grades` (preservando a
 * grade real com CQ confirmado — funcoes.sql:6779-6810), grava `modelos.proporcoes` e devolve consumo/%loss ao BOM
 * (:6878-6881 — aqui os MESMOS valores que o `salvar_modelo_bom` acabou de gravar: plano F3.3 §3 P3). `_observacoes_molde:
 * null`, `enviar_por_tamanho: {}` e as quantidades recalculadas (consumo × grade) = paridade com o Dev: num card JÁ enviado
 * (com "Editar") isso apaga os ajustes da Explosão — obs. do molde, envio por tamanho, "a separar" dos aviamentos
 * (`cad_aviamentos.quantidade_separar`, ExplosaoDetail.tsx:699/:783) e "a enviar" dos insumos
 * (`cad_etiquetas.quantidade_enviar`, ExplosaoInsumosSection.tsx:7) voltam ao cálculo —, igual ao Dev (decisão F3 #7 (a);
 * D4; correção = tarefa própria). Só com `cad.gravar` — nunca vazio (`deveGravarCad`).
 */
export async function persistirCad(modeloId: string, cad: CadCapturado): Promise<void> {
  if (!cad.gravar || !cad.payload) return;
  const { error } = await supabase.rpc("salvar_cad_completo" as any, { _modelo_id: modeloId, ...cad.payload } as any);
  if (error) throw error;
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
