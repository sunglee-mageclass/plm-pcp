import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, isSameMonth, isSameDay,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Kind = "prevista" | "entregue";
type Evento = { date: string; ref: string | null; nome: string | null; servico: string; kind: Kind };

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function fetchCalendario(): Promise<Evento[]> {
  const sel = "cad_id, data_prevista, data_entregue";
  const [cadsRes, tercRes, ofiRes, acabRes] = await Promise.all([
    supabase.from("cad").select("id, modelos(ref, nome)"),
    supabase.from("producao_terceirizados").select(sel),
    supabase.from("producao_oficina").select(sel),
    supabase.from("producao_acabamento").select(sel),
  ]);
  for (const r of [cadsRes, tercRes, ofiRes, acabRes]) if (r.error) throw r.error;

  const refByCad = new Map<string, { ref: string | null; nome: string | null }>();
  for (const c of (cadsRes.data ?? []) as any[]) {
    const m = Array.isArray(c.modelos) ? c.modelos[0] : c.modelos;
    refByCad.set(c.id, { ref: m?.ref ?? null, nome: m?.nome ?? null });
  }

  const toEvents = (rows: any[], servico: string): Evento[] =>
    (rows ?? []).flatMap((r): Evento[] => {
      const info = r.cad_id ? refByCad.get(r.cad_id) : undefined;
      const base = { ref: info?.ref ?? null, nome: info?.nome ?? null, servico };
      // Entregue tem prioridade; se há entregue, não mostra a prevista do serviço.
      if (r.data_entregue) return [{ ...base, date: r.data_entregue, kind: "entregue" as const }];
      if (r.data_prevista) return [{ ...base, date: r.data_prevista, kind: "prevista" as const }];
      return [];
    });

  return [
    ...toEvents(tercRes.data ?? [], "Terceirizado"),
    ...toEvents(ofiRes.data ?? [], "Oficina"),
    ...toEvents(acabRes.data ?? [], "Acabamento"),
  ];
}

export function ProducaoCalendario() {
  const [mes, setMes] = useState(() => startOfMonth(new Date()));
  const { data: eventos = [] } = useQuery({
    queryKey: ["producao-calendario"],
    queryFn: fetchCalendario,
  });

  const dias = useMemo(() => {
    const ini = startOfWeek(startOfMonth(mes), { weekStartsOn: 0 });
    const fim = endOfWeek(endOfMonth(mes), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: ini, end: fim });
  }, [mes]);

  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of eventos) {
      const key = (e.date ?? "").slice(0, 10);
      if (!key) continue;
      const arr = m.get(key);
      if (arr) arr.push(e);
      else m.set(key, [e]);
    }
    return m;
  }, [eventos]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Calendário de Produção</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMes((d) => addMonths(d, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium w-36 text-center">{MESES[mes.getMonth()]} {mes.getFullYear()}</span>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setMes((d) => addMonths(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Entregue</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Prevista</span>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
        {DIAS.map((d) => (
          <div key={d} className="bg-muted/50 px-2 py-1 text-center text-xs font-medium">{d}</div>
        ))}
        {dias.map((dia) => {
          const key = dayKey(dia);
          const evs = porDia.get(key) ?? [];
          const hoje = isSameDay(dia, new Date());
          const noMes = isSameMonth(dia, mes);
          return (
            <div key={key} className={`bg-background min-h-[90px] p-1 ${noMes ? "" : "opacity-40"}`}>
              <div className={`text-[11px] mb-0.5 ${hoje ? "font-bold text-primary" : "text-muted-foreground"}`}>
                {dia.getDate()}
              </div>
              <div className="space-y-0.5">
                {evs.map((e, i) => (
                  <div
                    key={i}
                    className={`truncate rounded px-1 py-0.5 text-white text-[10px] ${e.kind === "entregue" ? "bg-emerald-500" : "bg-amber-500"}`}
                    title={`${e.ref ?? "—"} · ${e.nome ?? ""} · ${e.servico} · ${e.kind === "entregue" ? "Entregue" : "Prevista"}`}
                  >
                    {e.ref ?? "—"} · {e.servico}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
