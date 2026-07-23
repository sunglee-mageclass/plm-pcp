import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import type { PtSlot } from "@/lib/plan-tecido/types";

// label exibido de um tamanho cadastrado (formato "34|PPP" → "PPP")
const labelTamanho = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);
const FALLBACK = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

export function GradeSection({ slot, onChange, tamanhos }: { slot: PtSlot; onChange: (s: PtSlot) => void; tamanhos?: string[] }) {
  const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
  const { data: prop } = useQuery({
    queryKey: ["plan-tecido-proporcoes", slot.modelo_id],
    enabled: !!slot.modelo_id,
    queryFn: async () => (((await supabase.from("modelos").select("proporcoes").eq("id", slot.modelo_id!).maybeSingle()).data as any)?.proporcoes ?? null) as Record<string, number> | null,
  });

  // chaves = tamanhos CADASTRADOS na loja (tenant_config.tamanhos_grade); valor = proporção do modelo (se houver), senão placeholder
  const keys = (tamanhos && tamanhos.length > 0 ? tamanhos : FALLBACK);
  const valorDe = (t: string) => Number(prop?.[t] ?? prop?.[labelTamanho(t)] ?? 0) || 0; // casa por chave cheia OU label (legado)
  const somaProp = keys.reduce((s, t) => s + valorDe(t), 0) || 1;
  const totalTec1 = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);

  if (!tec1 || !tec1.artigo_id) return <div className="p-2 text-xs text-muted-foreground">Defina o Tecido 1 para editar a grade.</div>;

  return (
    <div className="p-2">
      <div className="mb-1 text-[10px] text-muted-foreground">Proporção de tamanho {slot.modelo_id ? "(do cadastro do modelo)" : "(cadastro da loja)"} — editável</div>
      <div className="flex flex-wrap gap-1">
        {keys.map((t) => (
          <div key={t} className="flex flex-col items-center rounded border px-2 py-1">
            <NumberInput integer blankZero placeholder="0" className="h-6 w-10 text-center" value={valorDe(t)}
              onChange={() => {
                // proporção fica só como referência de exibição (não escreve no modelo — A.1)
                onChange({ ...slot });
              }} />
            <span className="text-[9px] text-muted-foreground">{labelTamanho(t)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-muted-foreground">grade total <b>{totalTec1} pç</b> · Σ proporção {somaProp}</div>
    </div>
  );
}
