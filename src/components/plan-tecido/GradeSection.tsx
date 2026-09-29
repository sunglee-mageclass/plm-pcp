import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { proporcaoDoTamanho } from "@/lib/distribuicao-produto";
import { tamanhosVisiveis, tipoEfetivo } from "@/lib/tamanho-exibicao";
import { cn } from "@/lib/utils";

const FALLBACK = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

export function GradeSection({ slot, onChange, tamanhos, readOnly = false }: { slot: PtSlot; onChange: (s: PtSlot) => void; tamanhos?: string[]; readOnly?: boolean }) {
  const { data: prop } = useQuery({
    queryKey: ["plan-tecido-proporcoes", slot.modelo_id],
    enabled: !!slot.modelo_id,
    queryFn: async () => (((await supabase.from("modelos").select("proporcoes").eq("id", slot.modelo_id!).maybeSingle()).data as any)?.proporcoes ?? null) as Record<string, number> | null,
  });

  // chaves = tamanhos CADASTRADOS na loja (tenant_config.tamanhos_grade)
  const keys = (tamanhos && tamanhos.length > 0 ? tamanhos : FALLBACK);
  // valor efetivo: o que foi editado no slot manda; senão a proporção do modelo (chave cheia OU a chave legada
  // só-letra — `proporcaoDoTamanho`, a MESMA leitura do dialog "Distribuir por loja"; corrige o par invertido
  // "PPP|34", que antes caía no lado número).
  const valorDe = (t: string) => {
    const sp = slot.proporcoes as Record<string, number> | undefined;
    if (sp && t in sp) return Number(sp[t]) || 0;
    return proporcaoDoTamanho(prop, t);
  };
  const setProp = (t: string, val: number) => {
    const base: Record<string, number> = {};
    // Congela os valores atuais sobre TODAS as chaves cadastradas — inclusive as escondidas pelo "Tamanho em"
    // (o filtro abaixo é só de EXIBIÇÃO; nunca reduz o que é gravado — G-plano ressalva #3).
    for (const k of keys) base[k] = valorDe(k);
    onChange({ ...slot, proporcoes: { ...base, [t]: val } });
  };
  // "Tamanho em" (frente Tamanho em, Tarefa 4): mostra só o lado escolhido (par sempre; solto do outro lado só se já
  // tiver valor — aí esmaecido, nunca some). O rascunho do slot manda (card: o do modelo; vaga: o da vaga).
  const tipo = tipoEfetivo(slot.tamanho_tipo);
  const comValor = new Set(keys.filter((k) => valorDe(k) > 0));
  const visiveis = tamanhosVisiveis(keys, tipo, comValor);
  return (
    <div className="px-2 pb-1">
      <div className="flex flex-wrap gap-1">
        {visiveis.map(({ chave: t, rotulo, esmaecido }) => (
          <div key={t} className={cn("flex w-[30px] max-md:w-11 flex-col items-center overflow-hidden rounded border bg-background", esmaecido && "opacity-50")}
            title={esmaecido ? "Tamanho do outro lado do \"Tamanho em\" — aparece porque já tem proporção" : undefined}>
            <NumberInput
              integer
              blankZero
              disabled={readOnly}
              placeholder="0"
              className="h-6 w-full rounded-none border-0 bg-transparent px-0 text-center text-xs shadow-none focus-visible:ring-0 max-md:h-9 max-md:text-base"
              value={valorDe(t)}
              data-colab-path={`pt-prop:${slot.id ?? slot.modelo_id ?? "x"}:${t}`}
              onChange={(e) => setProp(t, Number(e.target.value) || 0)}
            />
            <span className="pb-0.5 text-[8px] uppercase tracking-tight text-muted-foreground">{rotulo}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
