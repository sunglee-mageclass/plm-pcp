import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, ArrowLeft, Check, Save, Plus } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeColecaoResumo } from "./otb-resumo";
import { brl } from "@/lib/format";

const WEEKS = ["1", "2", "3", "4", "5"];
type Opt = { id: string; nome: string };
// Um bloco de subcoleção no editor: nome + semanas (semana→qtd; ausente = semana off).
type SubBlock = { id: string | null; nome: string; weeks: Record<string, number | null> };

// Editor das 5 semanas (reutilizado no modo simples e em cada subcoleção).
function WeeksEditor({ value, onChange }: { value: Record<string, number | null>; onChange: (w: Record<string, number | null>) => void }) {
  return (
    <div className="space-y-2">
      {WEEKS.map((s) => {
        const on = s in value; // marcada = chave presente (valor pode ser null = vazio)
        return (
          <div key={s} className="flex items-center gap-3">
            <Checkbox checked={on} onCheckedChange={(v) => { const n = { ...value }; if (v) n[s] = n[s] ?? null; else delete n[s]; onChange(n); }} />
            <span className="w-16 text-sm">Semana {s}</span>
            {on && <div className="w-28"><NumberInput integer placeholder="0" value={value[s] == null ? "" : String(value[s])} onChange={(e) => onChange({ ...value, [s]: e.target.value === "" ? null : Number(e.target.value) })} /></div>}
          </div>
        );
      })}
    </div>
  );
}

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
  const [weeks, setWeeks] = useState<Record<string, number | null>>({}); // modo simples (sem subcoleção)
  const [subs, setSubs] = useState<SubBlock[]>([]); // subcoleções, cada uma com suas semanas
  const [confirmDel, setConfirmDel] = useState(false);

  const { data } = useQuery({
    queryKey: ["otb-colecao", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data: col, error } = await supabase.from("colecoes")
        .select("*, colecao_semanas(semana, qtd_planejada, subcolecao_id), colecao_subcolecoes(id, nome, ordem)")
        .eq("id", colecaoId!).single();
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
    const allSem = (data.colecao_semanas ?? []) as { semana: string; qtd_planejada: number; subcolecao_id: string | null }[];
    // Semanas de nível coleção (modo simples).
    const flat: Record<string, number | null> = {};
    for (const s of allSem) if (!s.subcolecao_id) flat[s.semana] = s.qtd_planejada > 0 ? s.qtd_planejada : null;
    setWeeks(flat);
    // Subcoleções ordenadas, cada uma com as suas semanas.
    const subList = ((data.colecao_subcolecoes ?? []) as { id: string; nome: string; ordem: number }[])
      .slice()
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((sc) => {
        const wk: Record<string, number | null> = {};
        for (const s of allSem) if (s.subcolecao_id === sc.id) wk[s.semana] = s.qtd_planejada > 0 ? s.qtd_planejada : null;
        return { id: sc.id, nome: sc.nome, weeks: wk } as SubBlock;
      });
    setSubs(subList);
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
    enabled: !!colecaoId,
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

  // Helper compartilhado: persiste a coleção + semanas, devolve o id.
  // NÃO exibe toast nem fecha o sheet — quem chama é responsável por isso.
  const persistColecao = async (): Promise<string> => {
    if (!nome.trim()) throw new Error("Informe o nome da coleção.");
    const cleanSubs = subs.map((s) => ({ ...s, nome: s.nome.trim() })).filter((s) => s.nome !== "");
    const nomesLower = cleanSubs.map((s) => s.nome.toLowerCase());
    if (new Set(nomesLower).size !== nomesLower.length) throw new Error("Há subcoleções com o mesmo nome.");

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

    // Regrava as semanas de um (coleção, subcoleção): apaga todas e insere as marcadas.
    const saveWeeks = async (subId: string | null, wk: Record<string, number | null>) => {
      let del = supabase.from("colecao_semanas").delete().eq("colecao_id", id!);
      del = subId ? del.eq("subcolecao_id", subId) : (del.is as any)("subcolecao_id", null);
      { const { error } = await del; if (error) throw error; }
      const marked = WEEKS.filter((s) => s in wk);
      if (marked.length) {
        const { error } = await supabase.from("colecao_semanas")
          .insert(marked.map((s) => ({ colecao_id: id!, subcolecao_id: subId, semana: s, qtd_planejada: wk[s] ?? 0 })) as any);
        if (error) throw error;
      }
    };

    if (cleanSubs.length > 0) {
      // Com subcoleções: zera as semanas de nível coleção (modo simples desligado).
      await saveWeeks(null, {});
      // Remove subcoleções que sumiram (cascade apaga as semanas delas).
      const keptIds = cleanSubs.map((s) => s.id).filter(Boolean) as string[];
      let delSub = supabase.from("colecao_subcolecoes").delete().eq("colecao_id", id!);
      if (keptIds.length) delSub = delSub.not("id", "in", `(${keptIds.map((x) => `'${x}'`).join(",")})`);
      { const { error } = await delSub; if (error) throw error; }
      // Insere/atualiza cada subcoleção + regrava as suas semanas.
      for (let i = 0; i < cleanSubs.length; i++) {
        const s = cleanSubs[i];
        let subId = s.id;
        if (subId) {
          const { error } = await supabase.from("colecao_subcolecoes").update({ nome: s.nome, ordem: i } as any).eq("id", subId);
          if (error) throw error;
        } else {
          const { data: insSub, error } = await supabase.from("colecao_subcolecoes")
            .insert({ colecao_id: id!, nome: s.nome, ordem: i } as any).select("id").single();
          if (error) throw error;
          subId = (insSub as any).id;
        }
        await saveWeeks(subId, s.weeks);
      }
    } else {
      // Sem subcoleções: apaga todas (cascade suas semanas) e grava as semanas da coleção.
      { const { error } = await supabase.from("colecao_subcolecoes").delete().eq("colecao_id", id!); if (error) throw error; }
      await saveWeeks(null, weeks);
    }
    return id!;
  };

  const isConfirmada = data?.status === "confirmada";

  const save = useMutation({
    mutationFn: async () => {
      const id = await persistColecao();
      // Já confirmada: Salvar também RECONCILIA os cards (mantém em sincronia com as semanas).
      if (isConfirmada) {
        const { data: r, error } = await supabase.rpc("otb_confirmar" as any, { _colecao_id: id });
        if (error) throw error;
        return r as { criados: number; removidos: number; mantidos: number };
      }
      return null;
    },
    onSuccess: (r) => {
      const partes = r ? [r.criados ? `${r.criados} criado(s)` : "", r.removidos ? `${r.removidos} removido(s)` : ""].filter(Boolean) : [];
      toast.success(`Coleção salva.${partes.length ? " " + partes.join(" · ") : ""}`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      if (isConfirmada) {
        qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
        qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      }
      onSaved(); onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar coleção")),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      const id = await persistColecao();
      const { data, error } = await supabase.rpc("otb_confirmar" as any, { _colecao_id: id });
      if (error) throw error;
      return data as { criados: number; removidos: number; mantidos: number };
    },
    onSuccess: (r) => {
      const partes = [
        r.criados ? `${r.criados} criado(s)` : "",
        r.removidos ? `${r.removidos} removido(s)` : "",
        r.mantidos ? `${r.mantidos} mantido(s) (preenchidos)` : "",
      ].filter(Boolean);
      toast.success(`Coleção confirmada. ${partes.join(" · ") || "Sem mudanças."}`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      onSaved(); onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar coleção")),
  });

  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("otb_excluir_colecao" as any, { _colecao_id: colecaoId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Coleção excluída");
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-semanas-todas"] });
      qc.invalidateQueries({ queryKey: ["otb-modelos-link"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      setConfirmDel(false); onSaved(); onClose();
    },
    // Bloqueio (há modelo planejado) chega como erro: mostra a mensagem do banco.
    onError: (e: any) => { setConfirmDel(false); toast.error(mensagemErro(e, "Erro ao excluir coleção")); },
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            {colecaoId ? "Editar coleção" : "Nova coleção"}
            {colecaoId && data && <Badge variant={isConfirmada ? "secondary" : "outline"}>{isConfirmada ? "Confirmada" : "Rascunho"}</Badge>}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid gap-1"><Label>Nome de Coleção</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="grid gap-1"><Label>Ano</Label>
              <Select value={anoId ?? ""} onValueChange={setAnoId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Mês</Label>
              <Select value={mesId ?? ""} onValueChange={setMesId}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1"><Label>Orçamento</Label><NumberInput value={orcamento} onChange={(e) => setOrcamento(e.target.value)} /></div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="block">Subcoleções e Modelos por Semana</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setSubs((p) => [...p, { id: null, nome: "", weeks: {} }])}>
                <Plus className="h-4 w-4 mr-1" /> Subcoleção
              </Button>
            </div>
            {subs.length === 0 ? (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Sem subcoleção: informe os modelos por semana da coleção. Ou clique em “Subcoleção” para dividir a coleção.</p>
                <WeeksEditor value={weeks} onChange={setWeeks} />
              </div>
            ) : (
              <div className="space-y-3">
                {subs.map((s, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={s.nome} placeholder="Nome da subcoleção (ex.: Praia)"
                        onChange={(e) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
                      <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setSubs((p) => p.filter((_, j) => j !== i))} aria-label="Remover subcoleção">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <WeeksEditor value={s.weeks} onChange={(w) => setSubs((p) => p.map((x, j) => (j === i ? { ...x, weeks: w } : x)))} />
                  </div>
                ))}
              </div>
            )}
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
          {colecaoId && (
            <Button variant="destructive" size="icon" className="sm:mr-auto" onClick={() => setConfirmDel(true)} disabled={excluir.isPending} aria-label="Excluir coleção">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:order-first max-sm:mr-auto max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Cancelar</span>
          </Button>
          {!isConfirmada && (
            <Button variant="secondary" onClick={() => confirmar.mutate()} disabled={confirmar.isPending || save.isPending} aria-label="Confirmar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Check className="h-4 w-4 sm:hidden" />
              <span className="max-sm:sr-only">{confirmar.isPending ? "Confirmando…" : "Confirmar"}</span>
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending || confirmar.isPending} aria-label="Salvar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <Save className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">{save.isPending ? "Salvando…" : "Salvar"}</span>
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a coleção “{nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Exclui a coleção, suas semanas e os modelos vinculados que ainda estão <strong>em planejamento</strong> (ou reprovados).
              Se houver algum modelo já <strong>planejado</strong>, a exclusão é <strong>bloqueada</strong>. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); excluir.mutate(); }}
              disabled={excluir.isPending}
            >
              {excluir.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
