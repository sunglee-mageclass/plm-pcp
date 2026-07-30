import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Bolinha vermelha com o nº de PEDIDOS ATRASADOS — MESMA fonte (RPC sidebar_badges) e MESMA queryKey
 * (["sidebar-badges"]) da sidebar, então o número bate exatamente e o cache é compartilhado (sem
 * request extra). Fica no canto SUPERIOR DIREITO do pai — envolva o alvo (ex.: TabsTrigger) com
 * `className="relative"`. Chaves: `oc_tecido_atrasada` | `oc_aviamento_atrasada` | `oc_etiqueta_atrasada`.
 */
export function AtrasadasBadge({ chave }: { chave: string }) {
  const { data: badges } = useQuery({
    queryKey: ["sidebar-badges"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sidebar_badges" as any);
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
    staleTime: 30_000,
  });
  const n = Number(badges?.[chave] ?? 0);
  if (n <= 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
      title={`${n} pedido(s) atrasado(s)`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
