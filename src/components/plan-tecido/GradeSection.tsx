import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import type { PtSlot } from "@/lib/plan-tecido/types";

const SIZE_KEYS = ["PP", "P", "M", "G", "GG"];
const PROP_VAZIA: Record<string, number> = Object.fromEntries(SIZE_KEYS.map((k) => [k, 0]));

export function GradeSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
  const { data: prop } = useQuery({
    queryKey: ["plan-tecido-proporcoes", slot.modelo_id],
    enabled: !!slot.modelo_id,
    queryFn: async () => (((await supabase.from("modelos").select("proporcoes").eq("id", slot.modelo_id!).maybeSingle()).data as any)?.proporcoes ?? null) as Record<string, number> | null,
  });
  // Modelo avançado com proporção cadastrada → mostra ela; senão placeholder (0 = blankZero), NÃO "1".
  const proporcao = prop && Object.keys(prop).length > 0 ? prop : PROP_VAZIA;
  const somaProp = Object.values(proporcao).reduce((s, n) => s + (Number(n) || 0), 0) || 1;
  const totalTec1 = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);

  if (!tec1 || !tec1.artigo_id) return <div className="p-2 text-xs text-muted-foreground">Defina o Tecido 1 para editar a grade.</div>;

  return (
    <div className="p-2">
      <div className="mb-1 text-[10px] text-muted-foreground">Proporção de tamanho {slot.modelo_id ? "(do cadastro do modelo)" : "(padrão)"} — editável</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(proporcao).map(([tam, q]) => (
          <div key={tam} className="flex flex-col items-center rounded border px-2 py-1">
            <NumberInput integer blankZero placeholder="0" className="h-6 w-10 text-center" value={q}
              onChange={(e) => {
                const next = { ...proporcao, [tam]: Number(e.target.value) || 0 };
                // proporção fica no slot só como referência de exibição (não escreve no modelo — A.1)
                onChange({ ...slot });
                void next;
              }} />
            <span className="text-[9px] text-muted-foreground">{tam}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-muted-foreground">grade total <b>{totalTec1} pç</b> · Σ proporção {somaProp}</div>
    </div>
  );
}
