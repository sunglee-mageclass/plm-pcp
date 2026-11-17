// F7 Armário · FOTO POR VARIANTE (cor) — sub-lista "Foto por cor" dentro da seção ANEXOS do Sheet do
// Planejamento. Repete as cores/variantes do produto (as 3 origens: interno/revenda/importado), cada uma
// com thumb + upload + remover. A foto é SÓ para a vitrine do Armário (qualidade baixa aceita): comprime
// no upload (`comprimirImagem`), sobe no bucket "modelos" com prefixo `variante-fotos/<modeloId>` e grava
// pela RPC `modelo_variante_foto_salvar`. Fonte da lista + foto atual = RPC `modelo_variante_fotos_listar`.
//
// Card NOVO (sem `modeloId`): as variantes vêm do BOM/produto SALVO, então pedimos "Salve o card primeiro".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { uploadFile, useSignedUrlBucket } from "@/components/planejamento/modelo-shared";
import { corApelidoLabel } from "@/lib/variante";
import { comprimirImagem } from "@/lib/comprimir-imagem";
import { mensagemErro } from "@/lib/erro-mensagem";

/** Uma variante (cor) do produto, vinda de `modelo_variante_fotos_listar`. */
interface VarianteFotoRpc {
  variante_tecido_id: string | null;
  produto_variante_id: string | null;
  cor_id: string | null;
  cor_apelido_id: string | null;
  cor_nome: string | null;
  cor_apelido_nome: string | null;
  ordem: number | null;
  /** Foto da variante (ou null = usa a capa do modelo como fallback visual). */
  foto_path: string | null;
}

const queryKeyFotos = (modeloId: string) => ["modelo-variante-fotos", modeloId];

/** Miniatura da foto da variante; sem ela, cai na capa do modelo (fallback visual). */
function VarianteThumb({ fotoPath, capaPath, alt }: { fotoPath: string | null; capaPath: string | null; alt: string }) {
  const efetiva = fotoPath ?? capaPath;
  const url = useSignedUrlBucket(efetiva);
  const box = "flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted";
  if (!url) return <div className={box}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
  const img = <img src={url} alt={alt} draggable={false} className="h-full w-full object-cover" />;
  return (
    <ImagePreview src={url} alt={alt} className={box}>
      {img}
    </ImagePreview>
  );
}

export function FotoPorCorSecao({
  modeloId,
  capaModelo,
  somenteLeitura = false,
}: {
  /** null = card novo (ainda sem variantes salvas). */
  modeloId: string | null;
  /** Capa do modelo (coalesce fotos_modelo[0]/desenho/croqui), usada como fallback visual por cor. */
  capaModelo: string | null;
  somenteLeitura?: boolean;
}) {
  const qc = useQueryClient();

  const { data: variantes, isLoading, isError, refetch } = useQuery({
    queryKey: modeloId ? queryKeyFotos(modeloId) : ["modelo-variante-fotos", "novo"],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_variante_fotos_listar" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? []) as VarianteFotoRpc[];
    },
  });

  const salvar = useMutation({
    mutationFn: async ({ v, file }: { v: VarianteFotoRpc; file: File | null }) => {
      let foto_path: string | null = null;
      if (file) {
        const comprimido = await comprimirImagem(file);
        foto_path = await uploadFile(comprimido, `variante-fotos/${modeloId}`);
      }
      const { error } = await supabase.rpc("modelo_variante_foto_salvar" as any, {
        _modelo_id: modeloId,
        _variante_tecido_id: v.variante_tecido_id,
        _produto_variante_id: v.produto_variante_id,
        _cor_id: v.cor_id,
        _cor_apelido_id: v.cor_apelido_id,
        _foto_path: foto_path,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      if (modeloId) qc.invalidateQueries({ queryKey: queryKeyFotos(modeloId) });
      // A foto da variante é consumida no Armário (vitrine), que tem cache próprio e noutra tela:
      // invalidar p/ a foto aparecer sem precisar de F5. Prefixo pega o dialog "+ Variante"
      // (["armario-variantes-disponiveis", ...]) e a grade montada (["armario-itens", ...]).
      qc.invalidateQueries({ queryKey: ["armario-variantes-disponiveis"] });
      qc.invalidateQueries({ queryKey: ["armario-itens"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Card novo: as variantes só existem depois de o BOM/produto estar salvo.
  if (!modeloId) {
    return (
      <div className="grid gap-2">
        <Label>Foto por cor (vitrine do Armário)</Label>
        <p className="text-sm text-muted-foreground">Salve o card primeiro para enviar uma foto por cor.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-testid="foto-por-cor">
      <Label>Foto por cor (vitrine do Armário)</Label>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando cores…</p>
      ) : isError ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-amber-700 dark:text-amber-300">Não foi possível carregar as cores.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      ) : !variantes || variantes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este produto ainda não tem cores (variantes) para associar fotos.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {variantes.map((v, i) => {
            const rotulo = corApelidoLabel(v.cor_nome, v.cor_apelido_nome) || `Cor ${v.ordem ?? i + 1}`;
            const pendente = salvar.isPending && salvar.variables?.v === v;
            return (
              <li
                key={`${v.variante_tecido_id ?? ""}|${v.produto_variante_id ?? ""}|${v.cor_id ?? ""}|${v.cor_apelido_id ?? ""}`}
                className="flex items-center gap-3 rounded-md border p-2"
              >
                <VarianteThumb fotoPath={v.foto_path} capaPath={capaModelo} alt={rotulo} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={rotulo}>{rotulo}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.foto_path ? "Foto da cor" : "Usando a capa do modelo"}
                  </p>
                </div>
                {!somenteLeitura && (
                  <div className="flex items-center gap-1">
                    {pendente ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                          <Upload className="h-3.5 w-3.5" /> {v.foto_path ? "Trocar" : "Enviar"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={salvar.isPending}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (f) salvar.mutate({ v, file: f });
                            }}
                          />
                        </label>
                        {v.foto_path && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="iconSm"
                            title="Remover foto desta cor"
                            disabled={salvar.isPending}
                            onClick={() => salvar.mutate({ v, file: null })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
