/* eslint-disable @typescript-eslint/no-explicit-any -- `variantes_aviamento` fora do types.ts (regen pendente): `as any` no builder, como a tela de Aviamentos */
// Foto por cor (variante) na grade "Lista tipo Excel" de Aviamentos. EXCEÇÃO documentada ao "nada grava antes do Salvar": a foto é
// BINÁRIO, então sobe e grava `variantes_aviamento.foto_url` NA HORA, fora do rascunho (mesmo padrão da grade de Tecidos). Só vale
// para cor JÁ cadastrada; linha nova não tem id para ligar a foto.
// BUCKET: "aviamentos" (o mesmo da foto do item; a RLS do Storage exige a LOJA na 1ª pasta). O descriptor de importação diz que
// "variante não tem foto", mas a coluna existe desde `20260820120000_variantes_aviamento` e nenhuma tela a usava até aqui.
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extensaoDaFoto } from "@/components/tecido/grade/useFotoVariante";
import { mensagemErro } from "@/lib/erro-mensagem";

export const AVIAMENTO_BUCKET = "aviamentos";

export type AlvoFoto = { id: string; aviamento_id: string; foto_url: string | null };

/** Caminho da foto no bucket: `<loja>/<aviamento>/<cor>-<timestamp>.<ext>` (a 1ª pasta é a loja — RLS do bucket). */
export function caminhoDaFoto(
  tenant: string,
  aviamentoId: string,
  varianteId: string,
  nomeArquivo: string,
  agora = Date.now(),
): string {
  return `${tenant}/${aviamentoId}/${varianteId}-${agora}.${extensaoDaFoto(nomeArquivo)}`;
}

/**
 * Sobe a imagem, grava o `foto_url` da cor e só então apaga a foto antiga (se subir ou gravar falhar, a antiga fica).
 * Devolve o caminho novo. Lança em erro (quem chama mostra o toast).
 */
export async function enviarFotoVariante(alvo: AlvoFoto, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  const { tenantPrefix } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = caminhoDaFoto(tenant, alvo.aviamento_id, alvo.id, file.name);
  const { error: upErr } = await supabase.storage
    .from(AVIAMENTO_BUCKET)
    .upload(path, file, { upsert: true });
  if (upErr) throw upErr;
  const { error: updErr } = await (supabase.from("variantes_aviamento") as any)
    .update({ foto_url: path })
    .eq("id", alvo.id);
  if (updErr) {
    // não deixa o arquivo órfão no bucket se o vínculo não gravou
    await supabase.storage.from(AVIAMENTO_BUCKET).remove([path]);
    throw updErr;
  }
  if (alvo.foto_url && alvo.foto_url !== path && !/^https?:\/\//i.test(alvo.foto_url)) {
    await supabase.storage.from(AVIAMENTO_BUCKET).remove([alvo.foto_url]);
  }
  return path;
}

/** Hook da célula: `enviar(file)` + `enviando`. Relê a grade (variantes) antes de liberar o próximo Salvar. */
export function useFotoVariante(alvo: AlvoFoto) {
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const { id, aviamento_id: aviamentoId, foto_url: fotoAtual } = alvo;
  const enviar = useCallback(
    async (file: File) => {
      setEnviando(true);
      try {
        await enviarFotoVariante({ id, aviamento_id: aviamentoId, foto_url: fotoAtual }, file);
        // Falha na releitura é inofensiva: o refetch normal cobre.
        try {
          await qc.refetchQueries({ queryKey: ["aviamentos-grade", "variantes"] });
        } catch {
          /* o refetch normal cobre */
        }
        qc.invalidateQueries({ queryKey: ["aviamentos-variantes"] });
        toast.success("Foto atualizada.");
      } catch (e) {
        toast.error(mensagemErro(e, "Erro ao enviar foto."));
      } finally {
        setEnviando(false);
      }
    },
    [id, aviamentoId, fotoAtual, qc],
  );
  return { enviar, enviando };
}
