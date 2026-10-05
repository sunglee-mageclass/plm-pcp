import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buscarTodas } from "@/lib/buscar-todas";
import { mapaTamanhoVinculado, type EtiquetaTamanhoRow } from "@/lib/insumo-tamanho";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

/**
 * urg R1 (T8) — `etiqueta_id` → tamanho EFETIVO do insumo (vínculo que vale: só p/ insumo sem tamanho próprio), da loja
 * ativa. Query SEPARADA: o embed aninhado `cad_etiquetas → etiquetas → variantes_etiqueta` vem vazio (ver `useFichaData`).
 * LANÇA o erro no `queryFn` (padrão C3): `data === undefined` = ainda carregando ou 1ª carga com falha — quem decide
 * "sem vínculo" a partir de `data ?? {}` imprimiria/explodiria a grade inteira em silêncio. Refetch com erro mantém o dado.
 */
export function useTamanhoVinculadoInsumos() {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: ["insumos-tamanho-vinculado", tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async () => {
      const rows = await buscarTodas<EtiquetaTamanhoRow>((de, ate) =>
        supabase
          .from("etiquetas" as any)
          .select("id, formato_tamanho, tamanho_vinculado, variantes_etiqueta(tamanho)")
          .eq("tenant_id", tenantId)
          .order("id")
          .range(de, ate) as unknown as PromiseLike<{ data: EtiquetaTamanhoRow[] | null; error: { message: string } | null }>,
      );
      return mapaTamanhoVinculado(rows);
    },
  });
}
