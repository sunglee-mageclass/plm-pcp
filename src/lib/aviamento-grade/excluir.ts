/* eslint-disable @typescript-eslint/no-explicit-any -- RPC/tabela fora do types.ts (regen pendente): `as any`, padrão da tela de Aviamentos */
// Excluir aviamento / cor JÁ CADASTRADOS pela grade "Lista tipo Excel" de Cadastro > Aviamentos. Grava NA HORA (não passa pelo
// rascunho nem pelo Salvar): é a exceção explícita à regra "nada grava antes do Salvar", sempre atrás de confirmação na tela.
//  • COR  → RPC `excluir_variante_aviamento` (a MESMA do Sheet; com GUARDA: em uso — OC/modelo/CAD/ordem de saída — ela RECUSA com
//    mensagem PT). Devolve `{foto_url}`, que sai do storage DEPOIS do delete confirmado.
//  • AVIAMENTO inteiro → DELETE DIRETO em `aviamentos` (como a tela de hoje, `deleteMut`): NÃO existe RPC `excluir_aviamento`. A
//    proteção é a FK: aviamento/cores em uso = erro 23503, traduzido para PT; nada é apagado. As cores saem junto (ON DELETE CASCADE).
// Fotos (do aviamento e das cores) saem do bucket "aviamentos" só DEPOIS do delete confirmado — nunca antes, senão uma recusa deixaria
// o registro sem a foto. Falha na limpeza não desfaz nem acusa a exclusão (que já valeu): sobra no máximo um arquivo órfão.
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ErroGrade } from "./salvar";

/** Bucket das fotos de aviamento (item e cores): o mesmo da tela de hoje e do upload da grade. */
export const BUCKET_AVIAMENTO = "aviamentos";

/** Texto PT do 23503 ao apagar um aviamento (o mesmo da tela de hoje). */
export const TEXTO_AVIAMENTO_EM_USO =
  "Aviamento em uso (OC, modelo, CAD ou ordem de saída). Remova de lá antes.";

async function limparFotos(paths: (string | null | undefined)[]): Promise<void> {
  const lista = paths.filter((p): p is string => !!p);
  if (lista.length === 0) return;
  try {
    await supabase.storage.from(BUCKET_AVIAMENTO).remove(lista);
  } catch {
    /* arquivo órfão é inofensivo */
  }
}

/** Exclui UMA cor (variante) do aviamento. Lança o erro da RPC (cor em uso = recusa, já em PT). */
export async function excluirVarianteGrade(varianteId: string): Promise<void> {
  const { data, error } = await supabase.rpc("excluir_variante_aviamento" as any, {
    _variante_id: varianteId,
  });
  if (error) throw error;
  await limparFotos([(data as any)?.foto_url as string | null | undefined]);
}

/**
 * Exclui o AVIAMENTO inteiro (cabeçalho + todas as cores) por DELETE direto. `fotoUrl` = foto do aviamento; `fotosCores` = fotos das
 * cores (saem do storage junto). Lança `ErroGrade` PT: 23503 = em uso; 0 linhas apagadas = já não existia (outra pessoa excluiu).
 */
export async function excluirAviamentoGrade(alvo: {
  id: string;
  fotoUrl?: string | null;
  fotosCores?: (string | null)[];
}): Promise<void> {
  const { data, error } = await (supabase.from("aviamentos") as any)
    .delete()
    .eq("id", alvo.id)
    .select("id");
  if (error) {
    throw (error as { code?: string }).code === "23503"
      ? new ErroGrade(TEXTO_AVIAMENTO_EM_USO)
      : error;
  }
  if (Array.isArray(data) && data.length === 0) {
    throw new ErroGrade(
      "Este aviamento não foi encontrado (talvez já tenha sido excluído por outra pessoa). Recarreguei a lista.",
    );
  }
  await limparFotos([alvo.fotoUrl, ...(alvo.fotosCores ?? [])]);
}

/** Texto PT-BR do erro de excluir (ErroGrade já vem pronto; o resto passa por `mensagemErro`). */
export function textoErroExcluir(e: unknown): string {
  if (e instanceof ErroGrade) return e.message;
  if ((e as { code?: string } | null)?.code === "23503") return TEXTO_AVIAMENTO_EM_USO;
  return mensagemErro(e, "Erro ao excluir.");
}

/** Query keys da grade que precisam ser relidas depois de excluir (a tela relê ANTES de seguir, senão a linha "pisca" de volta). */
export const QUERY_KEYS_GRADE = ["aviamentos", "variantes"] as const;
