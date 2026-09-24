// F3.2 — gravações do BOM feitas pelo Sheet do Planejamento (fora do React). Toda escrita de BOM passa por
// `salvar_modelo_bom` (a RPC guarda snapshot em `modelo_bom_snapshots` antes de apagar — G-inicial #7);
// etiquetas por diff de id em `modelo_etiquetas` (MESMO caminho do Dev, ModeloDetailPanel.tsx:2038-2060 —
// etiqueta não reserva estoque, fica fora da RPC).
import { supabase } from "@/integrations/supabase/client";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, planoEtiquetas,
  type BomCapturado,
} from "./ficha-calc";

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
