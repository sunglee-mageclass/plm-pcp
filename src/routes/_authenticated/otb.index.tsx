import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Target as TargetIcon, Wallet } from "lucide-react";
import { ColecaoPVSheet } from "@/components/otb/ColecaoPVSheet";
import { PadraoMixSheet } from "@/components/otb/PadraoMixSheet";
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
    const { data } = await supabase.from(table as any).select(`id, ${key}`).order(table === "meses" ? "ordem" : key);
    return ((data ?? []) as any[]).map((r) => ({ id: r.id, nome: r[key] }));
  }});
}

function OtbPage() {
  const { isModuleEnabled } = useTenantModules();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [tipoOpen, setTipoOpen] = useState(false);
  const [pvOpen, setPvOpen] = useState<{ id: string | null } | null>(null);
  const [padraoOpen, setPadraoOpen] = useState(false);
  const abrirColecao = (c: any) =>
    c.tipo === "poder_venda" ? setPvOpen({ id: c.id }) : setOpenId(c.id);
  const [fAno, setFAno] = useState("all");
  const [fMes, setFMes] = useState("all");
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome, status, orcamento, mes_id, ano_id, tipo, poder_venda_meta").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Poder de venda PLANEJADO por coleção PV (Σ qtd × prof × cores × valor médio da faixa).
  const { data: pvItens = [] } = useQuery({
    queryKey: ["otb-pv-poder"],
    queryFn: async () => {
      const { data } = await supabase.from("colecao_pv_itens" as any).select("colecao_id, prof_cor, cores, preco_min, preco_max, qtd_semanas");
      return (data ?? []) as any[];
    },
  });
  const poderPVMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of pvItens as any[]) {
      const tot = Object.values(it.qtd_semanas ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      const vm = (Number(it.preco_min) + Number(it.preco_max)) / 2;
      m[it.colecao_id] = (m[it.colecao_id] || 0) + tot * (Number(it.prof_cor) || 0) * (Number(it.cores) || 0) * vm;
    }
    return m;
  }, [pvItens]);

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
  // Orçamento (custo) de uma coleção PV = poder de venda ÷ markup (cálculo reverso), por linha.
  const custoPVMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of pvItens as any[]) {
      const tot = Object.values(it.qtd_semanas ?? {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      const vm = (Number(it.preco_min) + Number(it.preco_max)) / 2;
      const poder = tot * (Number(it.prof_cor) || 0) * (Number(it.cores) || 0) * vm;
      const mk = Number(linhaMarkupMap[it.linha_id]) || 0;
      m[it.colecao_id] = (m[it.colecao_id] || 0) + (mk > 0 ? poder / mk : 0);
    }
    return m;
  }, [pvItens, linhaMarkupMap]);

  // Per-collection stats
  const statsByColecao = useMemo(() => {
    // definido = qtd definida no OTB (Σ das semanas). planejados = modelos que
    // chegaram no status "planejado" (rascunho/em planejamento/reprovado NÃO contam).
    const definido: Record<string, number> = {};
    for (const s of semanas) definido[s.colecao_id] = (definido[s.colecao_id] ?? 0) + Number(s.qtd_planejada ?? 0);
    const byCol: Record<string, typeof modelosLink> = {};
    for (const m of modelosLink) (byCol[m.colecao_id] ??= []).push(m);
    const out: Record<string, { definido: number; planejados: number; previsto: number; real: number; poder: number }> = {};
    for (const c of colecoes) {
      const ms = byCol[c.id] ?? [];
      const resumo = computeColecaoResumo(ms as any, custoMap as any, gradeMap as any, linhaMarkupMap as any);
      const planejados = ms.filter((m) => m.status_planejamento === "planejado").length;
      // "custo comprometido" = real (que já cai no previsto quando não há CAD no corte).
      out[c.id] = { definido: definido[c.id] ?? 0, planejados, previsto: resumo.previsto, real: resumo.real, poder: resumo.poder };
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
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
          <FilterButton filters={[
            { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
            { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
          ]} />
          <Button variant="outline" size="sm" onClick={() => setPadraoOpen(true)}>Padrão do mix</Button>
          <Button variant="outline" className="max-sm:hidden" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar coleções existentes</Button>
          <Button className="max-sm:hidden" onClick={() => setTipoOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
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
            const st = statsByColecao[c.id] ?? { definido: 0, planejados: 0, previsto: 0, real: 0, poder: 0 };
            const orc = c.tipo === "poder_venda" ? (custoPVMap[c.id] || null) : (c.orcamento != null ? Number(c.orcamento) : null);
            const temOrc = orc != null && orc > 0;
            const fora = temOrc && st.real > (orc as number);
            const pctUso = temOrc ? Math.round((st.real / (orc as number)) * 100) : null;
            // Orçamento vira a BORDA esquerda do card: verde=dentro · vermelho=estourou ·
            // amarelo=sem orçamento. O % (texto) fica como canal não-cromático + title.
            const borderCor = !temOrc ? "border-l-amber-500" : fora ? "border-l-red-500" : "border-l-emerald-500";
            const orcTitle = !temOrc ? "Sem orçamento" : `${fora ? "Acima do" : "Dentro do"} orçamento — ${pctUso}% usado`;
            return (
              <button key={c.id} onClick={() => abrirColecao(c)} title={orcTitle} className={`text-left rounded-lg border border-l-4 ${borderCor} p-3 hover:bg-muted`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{c.nome}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums" title={orcTitle} aria-label={orcTitle}>{temOrc ? `${pctUso}%` : "—"}</span>
                    {c.tipo === "poder_venda" && <Badge variant="outline" className="text-[10px]" title="Poder de Venda">PV</Badge>}
                    <Badge variant={c.status === "confirmada" ? "secondary" : "outline"}>{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</Badge>
                  </div>
                </div>
                {periodoLabel && <div className="text-xs text-muted-foreground mt-0.5">{periodoLabel}</div>}
                {c.tipo === "poder_venda" ? (() => {
                  const pvMeta = Number(c.poder_venda_meta) || 0;
                  const pvPoder = poderPVMap[c.id] || 0;
                  const pvPct = pvMeta > 0 ? (pvPoder / pvMeta) * 100 : 0;
                  return (
                    <div className="mt-1 space-y-1">
                      <div className="text-sm text-muted-foreground">Orçamento (calc.): {orc != null ? brl(orc) : "—"}</div>
                      <div className="text-sm text-muted-foreground">Custo comprometido: {brl(st.real)}</div>
                      <div className="text-sm mt-1"><span className="text-muted-foreground">Poder de venda:</span> {brl(pvPoder)} <span className="text-muted-foreground">de {pvMeta > 0 ? brl(pvMeta) : "—"}</span></div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={`h-full ${pvPct >= 100 ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${Math.min(100, pvPct)}%` }} /></div>
                      {pvMeta > 0 && <div className="text-right text-xs font-semibold text-primary">{Math.round(pvPct)}% da meta</div>}
                    </div>
                  );
                })() : (
                  <>
                    <div className="text-sm text-muted-foreground mt-1">Orçamento: {c.orcamento != null ? brl(Number(c.orcamento)) : "—"}</div>
                    <div className="text-sm text-muted-foreground">Custo comprometido: {brl(st.real)}</div>
                    <div className="text-sm font-medium">Poder de venda: {brl(st.poder)}</div>
                  </>
                )}
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
      {pvOpen && (
        <ColecaoPVSheet colecaoId={pvOpen.id}
          onClose={() => setPvOpen(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["otb-colecoes"] }); qc.invalidateQueries({ queryKey: ["otb-pv-poder"] }); }} />
      )}
      {padraoOpen && <PadraoMixSheet onClose={() => setPadraoOpen(false)} />}
      <MobileActionBar>
        <Button variant="outline" aria-label="Importar coleções existentes" onClick={() => importar.mutate()} disabled={importar.isPending}>Importar</Button>
        <Button className="ml-auto" onClick={() => setTipoOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
      </MobileActionBar>

      <Dialog open={tipoOpen} onOpenChange={setTipoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova coleção</DialogTitle>
            <DialogDescription>Como você quer montar esta coleção?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="flex flex-col items-start gap-1 rounded-lg border p-4 text-left hover:bg-muted"
              onClick={() => { setTipoOpen(false); setOpenNew(true); }}
            >
              <Wallet className="h-6 w-6 text-primary" />
              <span className="font-semibold">Por Orçamento</span>
              <span className="text-xs text-muted-foreground">Subcoleções, semanas e categorias, mirando o orçamento de custo.</span>
            </button>
            <button
              className="flex flex-col items-start gap-1 rounded-lg border p-4 text-left hover:bg-muted"
              onClick={() => { setTipoOpen(false); setPvOpen({ id: null }); }}
            >
              <TargetIcon className="h-6 w-6 text-primary" />
              <span className="font-semibold">Por Poder de Venda</span>
              <span className="text-xs text-muted-foreground">Herda um Padrão do mix e mira a meta de poder de venda.</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
