import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";

// Fotos do PEDIDO por nome de tecido (Modo Plano, set/2026). Mapa { nome_tecido: paths[] } da
// coleção, no bucket "oc-tecido". Fonte única de leitura/escrita: RPCs `plan_tecido_pedido_fotos`
// (mapa) e `plan_tecido_set_pedido_fotos` (upsert estado-completo; paths vazio remove).
export const PEDIDO_FOTOS_BUCKET = "oc-tecido";

export function usePedidoFotos(colecaoId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ["plan-tecido-pedido-fotos", colecaoId];

  const { data: mapa = {} } = useQuery({
    queryKey: key,
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("plan_tecido_pedido_fotos" as any, { _colecao_id: colecaoId });
      if (error) throw error;
      return (data ?? {}) as Record<string, string[]>;
    },
  });

  const salvar = useMutation({
    mutationFn: async ({ nomeTecido, paths }: { nomeTecido: string; paths: string[] }) => {
      const { error } = await supabase.rpc("plan_tecido_set_pedido_fotos" as any, {
        _colecao_id: colecaoId, _nome_tecido: nomeTecido, _paths: paths,
      });
      if (error) throw error;
    },
    // Otimista: atualiza o mapa local na hora (o carrossel reflete sem esperar o refetch).
    onMutate: async ({ nomeTecido, paths }) => {
      await qc.cancelQueries({ queryKey: key });
      const anterior = qc.getQueryData<Record<string, string[]>>(key);
      qc.setQueryData<Record<string, string[]>>(key, (m) => {
        const next = { ...(m ?? {}) };
        if (paths.length === 0) delete next[nomeTecido];
        else next[nomeTecido] = paths;
        return next;
      });
      return { anterior };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.anterior) qc.setQueryData(key, ctx.anterior);
      toast.error(mensagemErro(e, "Não foi possível salvar as fotos do pedido."));
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); },
  });

  return {
    fotosDe: (nomeTecido: string): string[] => mapa[nomeTecido] ?? [],
    salvar,
  };
}
