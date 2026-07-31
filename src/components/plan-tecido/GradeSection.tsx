import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import type { PtSlot } from "@/lib/plan-tecido/types";

// label exibido de um tamanho cadastrado (formato "34|PPP" → "PPP")
const labelTamanho = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);
const FALLBACK = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

export function GradeSection({ slot, onChange, tamanhos }: { slot: PtSlot; onChange: (s: PtSlot) => void; tamanhos?: string[] }) {
  const { data: prop } = useQuery({
    queryKey: ["plan-tecido-proporcoes", slot.modelo_id],
    enabled: !!slot.modelo_id,
    queryFn: async () => (((await supabase.from("modelos").select("proporcoes").eq("id", slot.modelo_id!).maybeSingle()).data as any)?.proporcoes ?? null) as Record<string, number> | null,
  });

  // chaves = tamanhos CADASTRADOS na loja (tenant_config.tamanhos_grade)
  const keys = (tamanhos && tamanhos.length > 0 ? tamanhos : FALLBACK);
  // valor efetivo: o que foi editado no slot manda; senão a proporção do modelo (chave cheia OU label legado)
  const valorDe = (t: string) => {
    const sp = slot.proporcoes as Record<string, number> | undefined;
    if (sp && t in sp) return Number(sp[t]) || 0;
    return Number(prop?.[t] ?? prop?.[labelTamanho(t)] ?? 0) || 0;
  };
  const setProp = (t: string, val: number) => {
    const base: Record<string, number> = {};
    for (const k of keys) base[k] = valorDe(k); // congela os valores atuais sobre as chaves cadastradas
    onChange({ ...slot, proporcoes: { ...base, [t]: val } });
  };
  return (
    <div className="px-2 pb-1">
      <div className="flex flex-wrap gap-1">
        {keys.map((t) => (
          <div key={t} className="flex w-[30px] max-md:w-11 flex-col items-center overflow-hidden rounded border bg-background">
            <NumberInput
              integer
              blankZero
              placeholder="0"
              className="h-6 w-full rounded-none border-0 bg-transparent px-0 text-center text-xs shadow-none focus-visible:ring-0 max-md:h-9 max-md:text-base"
              value={valorDe(t)}
              onChange={(e) => setProp(t, Number(e.target.value) || 0)}
            />
            <span className="pb-0.5 text-[8px] uppercase tracking-tight text-muted-foreground">{labelTamanho(t)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
