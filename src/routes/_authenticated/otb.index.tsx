import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { FilterButton } from "@/components/shared/filters";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Target, Plus } from "lucide-react";
import { ColecaoSheet } from "@/components/otb/ColecaoSheet";
import { computeColecaoResumo } from "@/components/otb/otb-resumo";
import { brl } from "@/lib/format";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/otb/")({
  component: () => (
    <RequirePermission page="otb">
      <OtbPage />
    </RequirePermission>
  ),
});

function useOpts(table: string, key = "nome") {
  return useQuery({ queryKey: ["opt", table], queryFn: async () => {
    const { data } = await supabase.from(table as any).select(`id, ${key}`).order(key);
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, nome: r[key] }));
  }});
}

function OtbPage() {
  const { isModuleEnabled } = useTenantModules();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [fAno, setFAno] = useState("all");
  const [fMes, setFMes] = useState("all");
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome, status, orcamento, mes_id, ano_id").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Aggregate data for xx/yy modelos + badge
  const { data: semanas = [] } = useQuery({
    queryKey: ["otb-semanas-todas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_semanas").select("colecao_id, qtd_planejada");
      if (error) throw error;
      return (data ?? []) as { colecao_id: string; qtd_planejada: number }[];
    },
  });
  const { data: modelosLink = [] } = useQuery({
    queryKey: ["otb-modelos-link"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("id, colecao_id, linha_id, preco_venda, status_planejamento").not("colecao_id", "is", null);
      if (error) throw error;
      return (data ?? []) as { id: string; colecao_id: string; linha_id: string | null; preco_venda: number | null; status_planejamento: string | null }[];
    },
  });
  const modeloIds = modelosLink.map((m) => m.id).sort();
  const { data: custoMap = {} } = useQuery({
    queryKey: ["otb-custo-lista", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIds });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  const { data: gradeMap = {} } = useQuery({
    queryKey: ["otb-grade-lista", modeloIds],
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

  // Per-collection stats
  const statsByColecao = useMemo(() => {
    // definido = qtd definida no OTB (Σ das semanas). planejados = modelos que
    // chegaram no status "planejado" (rascunho/em planejamento/reprovado NÃO contam).
    const definido: Record<string, number> = {};
    for (const s of semanas) definido[s.colecao_id] = (definido[s.colecao_id] ?? 0) + Number(s.qtd_planejada ?? 0);
    const byCol: Record<string, typeof modelosLink> = {};
    for (const m of modelosLink) (byCol[m.colecao_id] ??= []).push(m);
    const out: Record<string, { definido: number; planejados: number; previsto: number; real: number }> = {};
    for (const c of colecoes) {
      const ms = byCol[c.id] ?? [];
      const resumo = computeColecaoResumo(ms as any, custoMap as any, gradeMap as any, linhaMarkupMap as any);
      const planejados = ms.filter((m) => m.status_planejamento === "planejado").length;
      // "custo comprometido" = real (que já cai no previsto quando não há CAD no corte).
      out[c.id] = { definido: definido[c.id] ?? 0, planejados, previsto: resumo.previsto, real: resumo.real };
    }
    return out;
  }, [semanas, modelosLink, colecoes, custoMap, gradeMap, linhaMarkupMap]);

  const qc = useQueryClient();
  const importar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("otb_importar_colecoes" as any);
      if (error) throw error;
      return data as { importadas: number; vinculados: number };
    },
    onSuccess: (r) => {
      toast.success(`${r.importadas} coleção(ões) importada(s), ${r.vinculados} modelo(s) vinculado(s).`);
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      qc.invalidateQueries({ queryKey: ["otb-colecoes-opts"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao importar coleções")),
  });

  const colecoesFiltradas = colecoes.filter(
    (c) => (fAno === "all" || c.ano_id === fAno) && (fMes === "all" || c.mes_id === fMes),
  );

  if (!isModuleEnabled("otb")) {
    return <div className="container mx-auto p-6"><EmptyState icon={Target} title="OTB não habilitado" description="Ative o módulo OTB nas configurações da loja." /></div>;
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Target className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div><h1 className="text-2xl font-bold">OTB</h1><p className="text-sm text-muted-foreground">Orçamento de coleção.</p></div></div>
        <div className="flex items-center gap-2">
          <FilterButton filters={[
            { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
            { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
          ]} />
          <Button variant="outline" className="max-sm:hidden" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar coleções existentes</Button>
          <Button className="max-sm:hidden" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
        </div>
      </header>
      {colecoesFiltradas.length === 0 ? (
        colecoes.length === 0
          ? <EmptyState icon={Target} title="Nenhuma coleção" description="Crie a primeira coleção do OTB." />
          : <EmptyState icon={Target} title="Nenhuma coleção no filtro" description="Ajuste o filtro de ano/mês." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colecoesFiltradas.map((c) => {
            const anoNome = c.ano_id ? (anos.find((a) => a.id === c.ano_id)?.nome ?? null) : null;
            const mesNome = c.mes_id ? (meses.find((m) => m.id === c.mes_id)?.nome ?? null) : null;
            const periodoLabel = [mesNome, anoNome].filter(Boolean).join(" / ");
            const st = statsByColecao[c.id] ?? { definido: 0, planejados: 0, previsto: 0, real: 0 };
            const orc = c.orcamento != null ? Number(c.orcamento) : null;
            const temOrc = orc != null && orc > 0;
            const fora = temOrc && st.real > (orc as number);
            const pctUso = temOrc ? Math.round((st.real / (orc as number)) * 100) : null;
            // Bolinha: verde=dentro · vermelho=estourou · amarelo=sem orçamento. Rótulo = % (ou "—").
            const dotCor = !temOrc ? "bg-amber-600" : fora ? "bg-red-600" : "bg-emerald-600";
            const orcTitle = !temOrc ? "Sem orçamento" : `${fora ? "Acima do" : "Dentro do"} orçamento — ${pctUso}% usado`;
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)} className="text-left rounded-lg border p-3 hover:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{c.nome}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="flex items-center gap-1" title={orcTitle} aria-label={orcTitle}>
                      <span className={`h-2.5 w-2.5 rounded-full ${dotCor}`} />
                      <span className="text-xs text-muted-foreground tabular-nums">{temOrc ? `${pctUso}%` : "—"}</span>
                    </span>
                    <Badge variant={c.status === "confirmada" ? "secondary" : "outline"}>{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</Badge>
                  </div>
                </div>
                {periodoLabel && <div className="text-xs text-muted-foreground mt-0.5">{periodoLabel}</div>}
                <div className="text-sm text-muted-foreground mt-1">Orçamento: {c.orcamento != null ? brl(Number(c.orcamento)) : "—"}</div>
                <div className="text-sm text-muted-foreground">Custo comprometido: {brl(st.real)}</div>
                <div className="mt-1">
                  <span className="text-xs text-muted-foreground tabular-nums" title="Modelos em status planejado / quantidade definida no OTB">
                    {st.definido > 0 ? `${st.planejados}/${st.definido} planejados` : `${st.planejados} ${st.planejados === 1 ? "planejado" : "planejados"}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {(openNew || openId) && (
        <ColecaoSheet colecaoId={openId} meses={meses} anos={anos}
          onClose={() => { setOpenNew(false); setOpenId(null); }} onSaved={() => {}} />
      )}
      <MobileActionBar>
        <Button variant="outline" aria-label="Importar coleções existentes" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar</Button>
        <Button className="ml-auto" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
      </MobileActionBar>
    </div>
  );
}
