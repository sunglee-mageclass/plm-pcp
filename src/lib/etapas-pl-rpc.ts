/**
 * KANBAN PL (Etapas PL, Onda 3): chamadas às RPCs públicas do PL (migrations 20261127120000 / 20261127130000).
 * Nomes = `RPC_ETAPAS_PL`. `as any`: types.ts do Supabase não conhece as RPCs novas (padrão do repo, igual ao Dev).
 * Erros sobem crus: a tela traduz com `mensagemErro` (PT-BR).
 */
import { supabase } from "@/integrations/supabase/client";
import { RPC_ETAPAS_PL, type ResultadoMoverPl } from "./etapas-pl-ui";

export type ResultadoDefinirPl = { ligado: boolean; mudou: boolean; lote_id: string | null; snapshot: number; cards_movidos: number };
export type PreviaRestauracaoPl = {
  lote_id: string | null; chave_ligada: boolean; total: number; voltam: number; movidos_depois: number;
  lotes_superados: number; cards: any[]; avisos: string[];
};
export type ResultadoRestaurarPl = { lote_id: string; restaurados: number; historico_apagado: number; lotes_superados: number };

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome as any, args as any);
  if (error) throw error;
  return data as T;
}

export function etapasPlMover(modeloId: string, para: string): Promise<ResultadoMoverPl> {
  return rpc<ResultadoMoverPl>(RPC_ETAPAS_PL.mover, { _modelo_id: modeloId, _para: para });
}
export function etapasPlDefinirAutomatico(ligar: boolean): Promise<ResultadoDefinirPl> {
  return rpc<ResultadoDefinirPl>(RPC_ETAPAS_PL.definir, { _ligar: ligar });
}
export function etapasPlPreviaRestauracao(loteId: string): Promise<PreviaRestauracaoPl> {
  return rpc<PreviaRestauracaoPl>(RPC_ETAPAS_PL.previaRestauracao, { _lote_id: loteId });
}
export function etapasPlRestaurar(loteId: string): Promise<ResultadoRestaurarPl> {
  return rpc<ResultadoRestaurarPl>(RPC_ETAPAS_PL.restaurar, { _lote_id: loteId });
}
