import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { brl, fmtNum } from "@/lib/format";
import { AlertTriangle, Check, X } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";

export function CustoSection({ slot, onChange, maoObraEstado, maoObraServico }: { slot: PtSlot; onChange: (s: PtSlot) => void; maoObraEstado?: string; maoObraServico?: number | null }) {
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
  const materiais = Number(cs.materiais) || 0; // materiais/aviamentos (semeado dos aviamentos do Dev)
  // Mão de obra: MO por serviço (Σ modelo_servico_mo.valor) do modelo do slot — READ-ONLY, fonte
  // ÚNICA (chega em `maoObraServico` = `modelo_mo_resumo.total`). Slot sem modelo → 0 (a MO nasce
  // por-serviço no Planejamento). Mascarado p/ quem não vê custos → null → 0.
  const maoObra = Number(maoObraServico) || 0;
  const custoTotal = custoTecido + custoForro + materiais + maoObra;
  const pi = precoInfo(custoTotal, markup, slot.preco_venda ?? null);
  const fromDev = !!slot.modelo_id; // materiais vem dos aviamentos do Dev quando é modelo

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
        <RO label="Mão de obra (por serviço)" value={brl(maoObra)} />
        {!slot.modelo_id && (
          <p className="col-span-2 text-[10px] text-muted-foreground">Mão de obra definida por serviço no Planejamento.</p>
        )}
        {/* Estado da MO por serviço — READ-ONLY (aprovação é por serviço, no Planejamento).
            estado undefined = sem custo/mascarado → não mostra badge (não vaza valor). */}
        {slot.modelo_id && maoObraEstado && (
          <div className="col-span-2 space-y-0.5 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Mão de Obra:</span>
              <StatusBadge
                tone={maoObraEstado === "aprovada" ? "success" : maoObraEstado === "reprovada" ? "danger" : maoObraEstado === "pendente" ? "warning" : "neutral"}
                className="ml-auto gap-1 normal-case tracking-normal"
              >
                {maoObraEstado === "aprovada" ? <Check className="h-3 w-3" /> : maoObraEstado === "reprovada" ? <X className="h-3 w-3" /> : maoObraEstado === "pendente" ? <AlertTriangle className="h-3 w-3" /> : null}
                {maoObraEstado === "aprovada" ? "aprovada"
                  : maoObraEstado === "reprovada" ? "reprovada"
                  : maoObraEstado === "pendente" ? "pendente" : "sem serviço"}
              </StatusBadge>
            </div>
            <p className="text-[10px] text-muted-foreground">Aprovação da mão de obra é por serviço, no Planejamento.</p>
          </div>
        )}
        <RO label="Custo total" value={brl(custoTotal)} />
        <RO label="Markup (linha)" value={markup > 0 ? `${fmtNum(markup)}×` : "—"} />
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
