/* eslint-disable @typescript-eslint/no-explicit-any -- `etiquetas` fora do types.ts (regen pendente): `as any` no builder, padrão da tela de Insumos */
// Excluir pela grade "Lista tipo Excel" de Cadastro > Insumos (lixeira ÚNICA por linha).
//  • INSUMO inteiro (linha-pai) → DELETE DIRETO em `etiquetas`, como a tela de hoje (`delMut`): NÃO existe RPC `excluir_insumo`. Grava NA
//    HORA (exceção explícita à regra "nada grava antes do Salvar", sempre atrás de confirmação na tela). A proteção é a FK: insumo em
//    uso = erro 23503, traduzido para PT e nada é apagado. As cores (`variantes_etiqueta`) saem junto (ON DELETE CASCADE).
//  • COR (linha-filha) → NÃO grava nada: o insumo não tem RPC de exclusão de variante com guarda (a tela de hoje regrava as cores em
//    bloco, delete-and-reinsert). A lixeira da cor só marca o bloco como `removido` no RASCUNHO; o próximo Salvar regrava as cores sem
//    ela (e, se a cor estiver em uso, o banco recusa com o texto PT de `mensagemSalvarVariantes` e o rascunho continua com o aviso).
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ErroGrade, type BlocoDraft } from "./salvar";

/** Texto PT do 23503 ao apagar um insumo (o mesmo espírito da tela de hoje, com "insumo" no lugar de "etiqueta"). */
export const TEXTO_INSUMO_EM_USO = "Insumo em uso (CAD/modelo/OC). Remova de lá antes.";

/**
 * Exclui o INSUMO inteiro (cabeçalho + todas as cores) por DELETE direto. Lança `ErroGrade` PT: 23503 = em uso; 0 linhas apagadas = já
 * não existia (outra pessoa excluiu).
 */
export async function excluirInsumoGrade(id: string): Promise<void> {
  const { data, error } = await (supabase.from("etiquetas" as any) as any)
    .delete()
    .eq("id", id)
    .select("id");
  if (error) {
    throw (error as { code?: string }).code === "23503"
      ? new ErroGrade(TEXTO_INSUMO_EM_USO)
      : error;
  }
  if (Array.isArray(data) && data.length === 0) {
    throw new ErroGrade(
      "Este insumo não foi encontrado (talvez já tenha sido excluído por outra pessoa). Recarreguei a lista.",
    );
  }
}

/** Marca/desmarca a cor como removida no rascunho (puro: devolve a lista nova; posição e demais blocos não mudam). */
export function marcarCorRemovida(
  blocos: readonly BlocoDraft[],
  idx: number,
  removido: boolean,
): BlocoDraft[] {
  return blocos.map((b, i) => (i === idx ? { ...b, removido } : b));
}

/** Texto PT-BR do erro de excluir (ErroGrade já vem pronto; o resto passa por `mensagemErro`). */
export function textoErroExcluir(e: unknown): string {
  if (e instanceof ErroGrade) return e.message;
  if ((e as { code?: string } | null)?.code === "23503") return TEXTO_INSUMO_EM_USO;
  return mensagemErro(e, "Erro ao excluir.");
}

/** Query keys da grade que precisam ser relidas depois de excluir (a tela relê ANTES de seguir, senão a linha "pisca" de volta). */
export const QUERY_KEYS_GRADE = ["etiquetas", "variantes"] as const;
