// Foto por cor (variante) na grade "Lista tipo Excel". EXCEÇÃO documentada ao "nada grava antes do Salvar": a foto é
// BINÁRIO, então sobe e grava `variantes_tecido.foto_url` NA HORA, fora do rascunho (mesmo padrão do Sheet do tecido,
// `cadastro.tecidos.$artigoId.tsx`, P-271). Só vale para cor JÁ cadastrada; linha nova não tem id para ligar a foto.
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { VARIANT_BUCKET } from "@/hooks/useSignedUrl";
import { sanitizeStorageName } from "@/lib/storage-tenant";
import { mensagemErro } from "@/lib/erro-mensagem";

export type AlvoFoto = { id: string; artigo_id: string; foto_url: string | null };

/** Extensão segura para a key do Storage (sem acento/símbolo); sem extensão no nome cai em "jpg". */
export function extensaoDaFoto(nome: string): string {
  const ponto = nome.lastIndexOf(".");
  const bruta = ponto >= 0 ? nome.slice(ponto + 1) : "";
  const ext = sanitizeStorageName(bruta)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return ext || "jpg";
}

/** Caminho da foto no bucket: `<loja>/<tecido>/<cor>-<timestamp>.<ext>` (a 1ª pasta é a loja — RLS do bucket). */
export function caminhoDaFoto(
  tenant: string,
  artigoId: string,
  varianteId: string,
  nomeArquivo: string,
  agora = Date.now(),
): string {
  return `${tenant}/${artigoId}/${varianteId}-${agora}.${extensaoDaFoto(nomeArquivo)}`;
}

/**
 * Sobe a imagem, grava o `foto_url` da cor e só então apaga a foto antiga (se subir ou gravar falhar, a antiga fica).
 * Devolve o caminho novo. Lança em erro (quem chama mostra o toast).
 */
export async function enviarFotoVariante(alvo: AlvoFoto, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  const { tenantPrefix } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = caminhoDaFoto(tenant, alvo.artigo_id, alvo.id, file.name);
  const { error: upErr } = await supabase.storage
    .from(VARIANT_BUCKET)
    .upload(path, file, { upsert: true });
  if (upErr) throw upErr;
  // `foto_url` ainda não está nos tipos gerados da tabela (types.ts pendente de regen) — mesmo `as any` do Sheet do tecido
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase.from("variantes_tecido") as any)
    .update({ foto_url: path })
    .eq("id", alvo.id);
  if (updErr) {
    // não deixa o arquivo órfão no bucket se o vínculo não gravou
    await supabase.storage.from(VARIANT_BUCKET).remove([path]);
    throw updErr;
  }
  if (alvo.foto_url && alvo.foto_url !== path && !/^https?:\/\//i.test(alvo.foto_url)) {
    await supabase.storage.from(VARIANT_BUCKET).remove([alvo.foto_url]);
  }
  return path;
}

/** Hook da célula: `enviar(file)` + `enviando`. Relê a grade (variantes E tecidos — a foto sobe o `artigos.rev` por gatilho). */
export function useFotoVariante(alvo: AlvoFoto) {
  const qc = useQueryClient();
  const [enviando, setEnviando] = useState(false);
  const { id, artigo_id: artigoId, foto_url: fotoAtual } = alvo;
  const enviar = useCallback(
    async (file: File) => {
      setEnviando(true);
      try {
        await enviarFotoVariante({ id, artigo_id: artigoId, foto_url: fotoAtual }, file);
        // O gatilho de colaboração sobe o `rev` do tecido a cada cor gravada: relê a grade ANTES de liberar o próximo
        // Salvar (senão ele mandaria um rev velho = conflito falso contra a própria foto). Falha na releitura é inofensiva.
        try {
          await Promise.all(
            ["variantes", "artigos"].map((k) =>
              qc.refetchQueries({ queryKey: ["tecidos-grade", k] }),
            ),
          );
        } catch {
          /* o refetch normal cobre */
        }
        for (const chave of [["variantes-thumb"], ["variantes", artigoId], ["artigos"]]) {
          qc.invalidateQueries({ queryKey: chave });
        }
        toast.success("Foto atualizada.");
      } catch (e) {
        toast.error(mensagemErro(e, "Erro ao enviar foto."));
      } finally {
        setEnviando(false);
      }
    },
    [id, artigoId, fotoAtual, qc],
  );
  return { enviar, enviando };
}
