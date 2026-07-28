import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";

export function CustoSection({ slot, onChange, maoObraAprovado }: { slot: PtSlot; onChange: (s: PtSlot) => void; maoObraAprovado?: boolean | null }) {
  // markup vem da LINHA do modelo (linhas.markup) — necessário p/ o preço sugerido
  const { data: markupMap = {} } = useQuery({
    queryKey: ["plan-tecido-linhas-markup"],
    queryFn: async () => {
      const rows = ((await supabase.from("linhas").select("id, markup")).data ?? []) as { id: string; markup: number | null }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });
  const markup = slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0;

  const cs = (slot.custo_simulado ?? {}) as { materiais?: number };
  // custos automáticos destrinchados por papel: Σ consumo × preço/m
  const custoTecido = custoMateriaisPrevisto({ ...slot, materiais: slot.materiais.filter((m) => m.tipo === "tecido") });
  const custoForro = custoMateriaisPrevisto({ ...slot, materiais: slot.materiais.filter((m) => m.tipo === "forro") });
  const materiais = Number(cs.materiais) || 0; // editável: outros materiais/aviamentos
  const maoObra = Number(slot.custo_terceirizados_previsto) || 0;
  const custoTotal = custoTecido + custoForro + materiais + maoObra;
  const pi = precoInfo(custoTotal, markup, slot.preco_venda ?? null);
  // valores ligados ao modelo REAL (Desenvolvimento) → borda verde (integridade). A reflexão
  // efetiva do valor do Dev (travado) é finalizada na Fase 4.2.
  const fromDev = !!slot.modelo_id;

  const RO = ({ label, value }: { label: string; value: string }) => (
    <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="rounded-md border bg-muted px-2 py-1 text-right text-xs text-muted-foreground">{value}</div></div>
  );

  return (
    <div className="p-2">
      <div className="mb-2 flex items-start gap-1 rounded-md border border-warning bg-warning/10 p-2 text-[10px]">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> Estimativa — não é o custo/preço real (esses vêm do BOM/CAD). Guardado no plano; não sobrescreve o modelo.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RO label="Custo de tecido (auto)" value={brl(custoTecido)} />
        <RO label="Custo de forro (auto)" value={brl(custoForro)} />
        <div><div className="text-[10px] text-muted-foreground">Materiais</div>
          <NumberInput blankZero placeholder="0,00" className={`h-7 w-full text-right ${fromDev ? "border-emerald-500" : ""}`} title={fromDev ? "Valor ligado ao modelo do Desenvolvimento" : undefined} value={materiais} onChange={(e) => onChange({ ...slot, custo_simulado: { ...cs, materiais: Number(e.target.value) || 0 } })} /></div>
        <div><div className="text-[10px] text-muted-foreground">Mão de obra prevista</div>
          <NumberInput blankZero placeholder="0,00" className={`h-7 w-full text-right ${fromDev ? "border-emerald-500" : ""}`} title={fromDev ? "Valor ligado ao modelo do Desenvolvimento" : undefined} value={maoObra} onChange={(e) => onChange({ ...slot, custo_terceirizados_previsto: Number(e.target.value) || 0 })} /></div>
        {slot.modelo_id && (
          <div className="col-span-2 flex items-center gap-2 text-[11px]">
            <span className="text-muted-foreground">Aprovação de Mão de Obra:</span>
            <span className={`ml-auto rounded px-2 py-0.5 font-medium ${maoObraAprovado === true ? "bg-emerald-100 text-emerald-700" : maoObraAprovado === false ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
              {maoObraAprovado === true ? "aprovada" : maoObraAprovado === false ? "reprovada" : "pendente"}
            </span>
          </div>
        )}
        <RO label="Custo total" value={brl(custoTotal)} />
        <RO label="Markup (linha)" value={markup > 0 ? `${markup.toFixed(2)}×` : "—"} />
        <RO label="Preço sugerido" value={pi.sugerido > 0 ? brl(pi.sugerido) : "—"} />
        <div className="col-span-2"><div className="text-[10px] text-muted-foreground">Preço p/ venda</div>
          <NumberInput blankZero placeholder={pi.sugerido > 0 ? brl(pi.sugerido) : "0,00"} className="h-7 w-full text-right" value={slot.preco_venda ?? 0} onChange={(e) => onChange({ ...slot, preco_venda: Number(e.target.value) || 0 })} /></div>
      </div>
      {markup <= 0 && (
        <div className="mt-1 text-[9px] text-muted-foreground">Sem markup na linha do modelo → preço sugerido indisponível; use o preço p/ venda.</div>
      )}
    </div>
  );
}
