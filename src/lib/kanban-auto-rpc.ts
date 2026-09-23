/**
 * KANBAN AUTOMÁTICO — F2: chamadas às RPCs públicas da F1 (migration 20260930150000_kanban_auto_4_rpcs.sql).
 * Nomes/parâmetros = `RPC_KANBAN` (contrato travado por tests/unit/kanban-auto-rpc-contrato.test.ts).
 * `as any`: types.ts do Supabase ainda não conhece as RPCs novas (regen pendente — padrão do repo).
 * Erros sobem crus: a tela traduz com `mensagemErro` (PT-BR).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  RPC_KANBAN,
  type PreviaRecalculo, type PreviaRestauracao, type ResultadoDefinir, type ResultadoMover, type ResultadoRestaurar,
} from "./kanban-auto-ui";

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome as any, args as any);
  if (error) throw error;
  return data as T;
}

export function kanbanMover(modeloId: string, para: string): Promise<ResultadoMover> {
  return rpc<ResultadoMover>(RPC_KANBAN.mover.nome, { _modelo_id: modeloId, _para: para });
}
export function kanbanPreviaRecalculo(cfg: Record<string, unknown>): Promise<PreviaRecalculo> {
  return rpc<PreviaRecalculo>(RPC_KANBAN.previaRecalculo.nome, { _cfg: cfg });
}
export function kanbanDefinirAutomatico(ligar: boolean): Promise<ResultadoDefinir> {
  return rpc<ResultadoDefinir>(RPC_KANBAN.definirAutomatico.nome, { _ligar: ligar });
}
export function kanbanPreviaRestauracao(loteId: string | null): Promise<PreviaRestauracao> {
  return rpc<PreviaRestauracao>(RPC_KANBAN.previaRestauracao.nome, { _lote_id: loteId });
}
export function kanbanRestaurar(loteId: string): Promise<ResultadoRestaurar> {
  return rpc<ResultadoRestaurar>(RPC_KANBAN.restaurar.nome, { _lote_id: loteId });
}
