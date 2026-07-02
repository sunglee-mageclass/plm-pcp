import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeColecaoResumo } from "./otb-resumo";
import { brl } from "@/lib/format";

const WEEKS = ["1", "2", "3", "4", "5"];
type Opt = { id: string; nome: string };

export function ColecaoSheet({
  colecaoId, meses, anos, onClose, onSaved,
}: {
  colecaoId: string | null;
  meses: Opt[]; anos: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [anoId, setAnoId] = useState<string | null>(null);
  const [mesId, setMesId] = useState<string | null>(null);
  const [orcamento, setOrcamento] = useState<string>("");
  const [weeks, setWeeks] = useState<Record<string, number | null>>({}); // semana→qtd (undefined = off)

  const { data } = useQuery({
    queryKey: ["otb-colecao", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data: col, error } = await supabase.from("colecoes").select("*, colecao_semanas(semana, qtd_planejada)").eq("id", colecaoId!).single();
      if (error) throw error;
      return col as any;
    },
  });
  useEffect(() => {
    if (!data) return;
    setNome(data.nome ?? "");
    setAnoId(data.ano_id ?? null);
    setMesId(data.mes_id ?? null);
    setOrcamento(data.orcamento != null ? String(data.orcamento) : "");
    const w: Record<string, number> = {};
    for (const s of data.colecao_semanas ?? []) w[s.semana] = s.qtd_planejada;
    setWeeks(w);
  }, [data]);

  // Queries para painel de resumo (só quando editando coleção existente)
  const { data: modelos = [] } = useQuery({
    queryKey: ["otb-colecao-modelos", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("id, linha_id, preco_venda").eq("colecao_id", colecaoId!);
      if (error) throw error;
      return data as { id: string; linha_id: string | null; preco_venda: number | null }[];
    },
  });
  const modeloIds = modelos.map((m) => m.id).sort();
  const { data: custoMap = {} } = useQuery({
    queryKey: ["otb-custo", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIds });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  const { data: gradeMap = {} } = useQuery({
    queryKey: ["otb-grade", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIds);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
      return m;
    },
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas", "markup"],
    queryFn: async () => {
      const { data } = await supabase.from("linhas").select("id, markup");
      return (data ?? []) as { id: string; markup: number | null }[];
    },
  });
  const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));

  const resumo = computeColecaoResumo(modelos, custoMap as any, gradeMap as any, linhaMarkupMap as any);
  const orc = orcamento === "" ? null : Number(orcamento);
  const saldo = orc != null ? orc - resumo.previsto : null;
  const pct = orc && orc > 0 ? resumo.previsto / orc : 0;
  const statusCor = orc == null ? "text-muted-foreground" : pct > 1 ? "text-destructive" : pct >= 0.9 ? "text-amber-600" : "text-emerald-600";
  const statusTxt = orc == null ? "Sem orçamento" : pct > 1 ? "Estourou" : pct >= 0.9 ? "Perto do teto" : "Dentro";

  const save = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Informe o nome da coleção.");
      const payload = { nome: nome.trim(), ano_id: anoId, mes_id: mesId, orcamento: orcamento === "" ? null : Number(orcamento) };
      let id = colecaoId;
      if (id) {
        const { error } = await supabase.from("colecoes").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data: ins, error } = await supabase.from("colecoes").insert(payload).select("id").single();
        if (error) throw error;
        id = (ins as any).id;
      }
      // Diff das semanas: apaga as desmarcadas, upserta as marcadas.
      const marked = WEEKS.filter((s) => weeks[s] != null);
      await supabase.from("colecao_semanas").delete().eq("colecao_id", id!).not("semana", "in", `(${marked.map((s) => `'${s}'`).join(",") || "''"})`);
      for (const s of marked) {
        await supabase.from("colecao_semanas").upsert({ colecao_id: id!, semana: s, qtd_planejada: weeks[s] ?? 0 }, { onConflict: "colecao_id,semana" });
      }
      return id!;
    },
    onSuccess: () => { toast.success("Coleção salva"); qc.invalidateQueries({ queryKey: ["otb-colecoes"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar coleção")),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0">
        <SheetHeader className="p-4 border-b shrink-0"><SheetTitle>{colecaoId ? "Editar coleção" : "Nova coleção"}</SheetTitle></SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid gap-1"><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-1"><Label>Ano</Label>
              <Select value={anoId ?? ""} onValueChange={setAnoId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Mês</Label>
              <Select value={mesId ?? ""} onValueChange={setMesId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Orçamento</Label><NumberInput value={orcamento} onChange={(e) => setOrcamento(e.target.value)} /></div>
          </div>
          <div>
            <Label className="mb-2 block">Semanas</Label>
            <div className="space-y-2">
              {WEEKS.map((s) => {
                const on = weeks[s] != null;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <Checkbox checked={on} onCheckedChange={(v) => setWeeks((w) => { const n = { ...w }; if (v) n[s] = n[s] ?? 0; else delete n[s]; return n; })} />
                    <span className="w-16 text-sm">Semana {s}</span>
                    {on && <div className="w-28"><NumberInput integer value={String(weeks[s] ?? 0)} onChange={(e) => setWeeks((w) => ({ ...w, [s]: Number(e.target.value) || 0 }))} /></div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Orçamento</span><span className="tabular-nums">{orc != null ? brl(orc) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Custo previsto</span><span className="tabular-nums">{brl(resumo.previsto)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Custo real</span><span className="tabular-nums">{brl(resumo.real)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Poder de venda</span><span className="tabular-nums">{brl(resumo.poder)}</span></div>
            <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Saldo (orç. − previsto)</span><span className="tabular-nums">{saldo != null ? brl(saldo) : "—"}</span></div>
            <div className={`flex justify-between font-medium ${statusCor}`}><span>Status</span><span>{statusTxt}</span></div>
            <div className="text-xs text-muted-foreground pt-1">{resumo.qtdModelos} modelo(s) · {resumo.qtdPecas} peça(s)</div>
          </div>
        </div>
        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
