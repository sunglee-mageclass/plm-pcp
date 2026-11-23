/* eslint-disable @typescript-eslint/no-explicit-any -- RPCs fora do types.ts (regen pendente): `as any`, padrão do Sheet `cadastro.tecidos.$artigoId` */
// Excluir tecido / cor JÁ CADASTRADOS pela grade "Lista tipo Excel" de Cadastro > Tecidos. Grava NA HORA (não passa pelo rascunho
// nem pelo Salvar): é a exceção explícita à regra "nada grava antes do Salvar", sempre atrás de confirmação na tela.
// Usa as MESMAS RPCs com GUARDA do Sheet (`excluir_tecido` / `excluir_variante_tecido`): em uso (OC/estoque/modelo/CAD/ordem)
// a RPC RECUSA e a tela mostra a mensagem em PT-BR (`mensagemErro`); só quando apaga é que as fotos devolvidas saem do storage
// (DEPOIS do delete confirmado — nunca antes, senão uma recusa deixaria o registro sem a foto).
import { supabase } from "@/integrations/supabase/client";
import { VARIANT_BUCKET } from "@/hooks/useSignedUrl";

/** Limpa as fotos do storage DEPOIS do delete. Falha aqui NÃO desfaz nem acusa a exclusão (que já valeu): sobra no máximo um arquivo órfão. */
async function limparFotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(VARIANT_BUCKET).remove(paths);
  } catch {
    /* arquivo órfão é inofensivo */
  }
}

/** Exclui UMA cor (variante) do tecido. Lança o erro da RPC (cor em uso = recusa). */
export async function excluirVarianteGrade(varianteId: string): Promise<void> {
  const { data, error } = await supabase.rpc("excluir_variante_tecido" as any, { _variante_id: varianteId });
  if (error) throw error;
  const foto = (data as any)?.foto_url as string | null | undefined;
  await limparFotos(foto ? [foto] : []);
}

/** Exclui o tecido INTEIRO (cabeçalho + todas as cores). Lança o erro da RPC (tecido em uso = recusa). */
export async function excluirTecidoGrade(artigoId: string): Promise<void> {
  const { data, error } = await supabase.rpc("excluir_tecido" as any, { _artigo_id: artigoId });
  if (error) throw error;
  await limparFotos((((data as any)?.fotos ?? []) as string[]).filter(Boolean));
}

/** Query keys da grade que precisam ser relidas depois de excluir (a tela relê ANTES de seguir, senão a linha "pisca" de volta). */
export const QUERY_KEYS_GRADE = ["artigos", "variantes", "artigo-categorias"] as const;
