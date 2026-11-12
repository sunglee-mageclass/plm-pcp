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
/** `loteId` null = o lote 'ligar' mais recente ainda não restaurado (o servidor resolve; mesmo contrato do Dev). */
export function etapasPlPreviaRestauracao(loteId: string | null): Promise<PreviaRestauracaoPl> {
  return rpc<PreviaRestauracaoPl>(RPC_ETAPAS_PL.previaRestauracao, { _lote_id: loteId });
}
export function etapasPlRestaurar(loteId: string): Promise<ResultadoRestaurarPl> {
  return rpc<ResultadoRestaurarPl>(RPC_ETAPAS_PL.restaurar, { _lote_id: loteId });
}

/** Chave do modo automático DESLIGADA: `etapas_pl_mover` recusa (P0001 `etapas_pl_manual`) — a pessoa decide e a tela grava direto
 *  (como o Dev com a chave off). Passa pelo gatilho de página de `modelos` (quem só edita PCP › Etapas recebe 42501). */
export async function etapasPlDefinirStatusDireto(modeloId: string, para: string): Promise<void> {
  const { error } = await supabase.from("modelos").update({ status_etapa_pl: para } as any).eq("id", modeloId);
  if (error) throw error;
}
