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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Target, Plus } from "lucide-react";
import { ColecaoSheet } from "@/components/otb/ColecaoSheet";
import { computeColecaoResumo } from "@/components/otb/otb-resumo";
import { useOrcamento } from "@/components/otb/orcamento";
import { brl, mesLimpo } from "@/lib/format";
import { RequirePermission } from "@/components/RequirePermission";
import { useFilterState } from "@/hooks/useFilterState";
import { useBuscaColecaoSub } from "@/hooks/useBuscaColecaoSub";

export const Route = createFileRoute("/_authenticated/otb/")({
  component: () => (
    <RequirePermission page="otb">
      <OtbPage />
    </RequirePermission>
  ),
});

// Rótulo de GRUPO dentro do card (laudo do time: agrupar por assunto resolve a leitura).
function GrpT({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{children}</span>;
}
function KV({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-display font-semibold tabular-nums">{v}</span>
    </div>
  );
}

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
  const [fAno, setFAno] = useFilterState("otb", "Ano", []);
  const [fMes, setFMes] = useFilterState("otb", "Mês", []);
  const [search, setSearch] = useState("");
  const { matchColecao } = useBuscaColecaoSub(); // busca por nome de coleção OU de subcoleção contida
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
      const { data } = await supabase.from("colecao_pv_itens" as any).select("colecao_id, linha_id, prof_cor, cores, preco_min, preco_max, qtd_semanas");
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

  const { data: modelosLink = [] } = useQuery({
    queryKey: ["otb-modelos-link"],
    queryFn: async () => {
      // "as any" no builder: markup_editado ainda não está no types.ts gerado (regen pendente).
      const { data, error } = await (supabase.from("modelos") as any).select("id, colecao_id, linha_id, preco_venda, markup_editado, status_planejamento").not("colecao_id", "is", null);
      if (error) throw error;
      return (data ?? []) as { id: string; colecao_id: string; linha_id: string | null; preco_venda: number | null; markup_editado: number | null; status_planejamento: string | null }[];
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
    const byCol: Record<string, typeof modelosLink> = {};
    for (const m of modelosLink) (byCol[m.colecao_id] ??= []).push(m);
    const out: Record<string, { previsto: number; real: number; poder: number }> = {};
    for (const c of colecoes) {
      const ms = byCol[c.id] ?? [];
      const resumo = computeColecaoResumo(ms as any, custoMap as any, gradeMap as any, linhaMarkupMap as any);
      // "custo comprometido" = real (que já cai no previsto quando não há CAD no corte).
      out[c.id] = { previsto: resumo.previsto, real: resumo.real, poder: resumo.poder };
    }
    return out;
  }, [modelosLink, colecoes, custoMap, gradeMap, linhaMarkupMap]);

  const [confirmImportar, setConfirmImportar] = useState(false);
  // Coleções PV que TÊM itens no mix — sem itens o card vira hint "montar o mix" (laudo).
  const pvComItens = useMemo(() => new Set((pvItens as any[]).map((it: any) => it.colecao_id as string)), [pvItens]);
  const qc = useQueryClient();
  const orcHook = useOrcamento();
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
    (c) => (!fAno.length || fAno.includes(c.ano_id ?? "")) && (!fMes.length || fMes.includes(c.mes_id ?? ""))
      && matchColecao(c.id, c.nome ?? "", search),
  );

  if (!isModuleEnabled("otb")) {
    return <div className="container mx-auto p-6"><EmptyState icon={Target} title="OTB não habilitado" description="Ative o módulo OTB nas configurações da loja." /></div>;
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Target className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div><h1 className="font-display text-xl font-semibold tracking-tight">OTB</h1><p className="text-sm text-muted-foreground">Orçamento de coleção.</p></div></div>
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
          <SearchToggle value={search} onChange={setSearch} placeholder="Buscar coleção ou subcoleção…" />
          <FilterButton filters={[
            { label: "Ano", value: fAno, onChange: setFAno, options: anos },
            { label: "Mês", value: fMes, onChange: setFMes, options: meses },
          ]} />
          <Button variant="outline" size="sm" onClick={() => setPadraoOpen(true)}>Padrão do mix</Button>
          <Button variant="outline" className="max-sm:hidden" onClick={() => setConfirmImportar(true)} disabled={importar.isPending}>Importar coleções existentes</Button>
          <Button className="max-sm:hidden" onClick={() => setTipoOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
        </div>
      </header>
      {colecoesFiltradas.length === 0 ? (
        colecoes.length === 0
          ? <EmptyState icon={Target} title="Nenhuma coleção" description="Crie a primeira coleção do OTB." />
          : <EmptyState icon={Target} title="Nenhuma coleção no filtro" description="Ajuste o filtro de ano/mês." />
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colecoesFiltradas.map((c) => {
            const anoNome = c.ano_id ? (anos.find((a) => a.id === c.ano_id)?.nome ?? null) : null;
            const mesNome = c.mes_id ? mesLimpo(meses.find((m) => m.id === c.mes_id)?.nome) : null;
            const periodoLabel = [mesNome, anoNome].filter(Boolean).join(" · ");
            const st = statsByColecao[c.id] ?? { previsto: 0, real: 0, poder: 0 };
            const isPV = c.tipo === "poder_venda";
            // Sem permissão de custos o wrapper devolve {} → NUNCA imprimir "R$ 0,00" falso (laudo UX#6).
            const custoOculto = modeloIds.length > 0 && Object.keys(custoMap).length === 0;
            const orc = isPV ? (custoPVMap[c.id] || null) : (c.orcamento != null ? Number(c.orcamento) : null);
            const temOrc = orc != null && orc > 0;
            const fora = temOrc && !custoOculto && st.real > (orc as number);
            const pctUso = temOrc ? Math.round((st.real / (orc as number)) * 100) : null;
            const sobra = temOrc ? (orc as number) - st.real : null;
            const pvMeta = Number(c.poder_venda_meta) || 0;
            const pvPoder = poderPVMap[c.id] || 0;
            const pvPct = pvMeta > 0 ? (pvPoder / pvMeta) * 100 : 0;
            const pvVazio = isPV && !pvComItens.has(c.id);
            // Borda esquerda = SAÚDE do orçamento (status já tem badge próprio):
            // verde = dentro · vermelho = estourou · âmbar = sem orçamento/plano.
            const borderCor = fora ? "border-l-red-600" : temOrc ? "border-l-emerald-600" : "border-l-amber-500";
            const ob = orcHook.colecao(c.id); // só confirmadas retornam bucket
            const over = !!ob && ob.realizado > ob.total;
            const faltam = ob && !over ? ob.total - ob.realizado : 0;
            const money = (v: number) => (custoOculto ? "—" : brl(v));
            return (
              <div key={c.id} role="button" tabIndex={0} onClick={() => abrirColecao(c)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirColecao(c); } }}
                className={`flex flex-col gap-2 rounded-lg border border-l-4 ${borderCor} bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md cursor-pointer`}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-display font-semibold">{c.nome}</span>
                  <StatusBadge tone="info">{isPV ? "PV" : "Orç."}</StatusBadge>
                  <StatusBadge tone={c.status === "confirmada" ? "success" : "warning"}>{c.status === "confirmada" ? "Confirmada" : "Rascunho"}</StatusBadge>
                </div>
                {(periodoLabel || (pvVazio && pvMeta > 0)) && (
                  <div className="-mt-1 text-xs text-muted-foreground">
                    {periodoLabel}{pvVazio && pvMeta > 0 ? `${periodoLabel ? " · " : ""}meta ${brl(pvMeta)}` : ""}
                  </div>
                )}
                {pvVazio ? (
                  /* Coleção confirmada sem mix = hint ACIONÁVEL, não casca de zeros (laudo UX#2). */
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    <b className="block text-[13px] font-semibold text-foreground">Plano sem itens</b>
                    <span>O mix ainda não foi montado — os números aparecem quando houver linhas no plano.</span>
                    <span className="mt-1 block font-semibold text-primary">Abrir e montar o mix →</span>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-1 border-b pb-2">
                      <GrpT>Orçamento · custo</GrpT>
                      <KV k={isPV ? "Estimado" : "Orçamento"} v={custoOculto && isPV ? "—" : temOrc ? brl(orc as number) : "—"} />
                      <KV k="Comprometido" v={money(st.real)} />
                      {temOrc && !custoOculto && (
                        <>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div className={`h-full ${fora ? "bg-red-600" : "bg-primary"}`} style={{ width: `${Math.min(100, pctUso ?? 0)}%` }} />
                          </div>
                          <div className="flex justify-between gap-2 text-xs tabular-nums">
                            <span className={fora ? "font-semibold text-red-700 dark:text-red-400" : "text-muted-foreground"}>{pctUso}% {fora ? "— estourou" : "usado"}</span>
                            <span className="text-muted-foreground">{fora ? `excede ${brl(Math.abs(sobra as number))}` : `sobra ${brl(sobra as number)}`}</span>
                          </div>
                        </>
                      )}
                      {!temOrc && !custoOculto && (
                        <span className="text-xs text-muted-foreground">{isPV ? "defina o markup das linhas para estimar o orçamento" : "defina o orçamento para acompanhar a saúde"}</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 border-b pb-2">
                      <GrpT>Poder de venda</GrpT>
                      {isPV ? (
                        <>
                          <KV k="Plano" v={<>{brl(pvPoder)}{pvMeta > 0 && <span className="ml-1 text-[11px] font-normal text-muted-foreground">de {brl(pvMeta)}</span>}</>} />
                          {pvMeta > 0 && (
                            <>
                              {/* Meta é PISO: barra verde ao bater, com TICK marcando o alvo quando passa (≠ teto do orçamento). */}
                              <div className="relative h-1.5 w-full rounded-full bg-muted">
                                <div className={`h-full rounded-full ${pvPct >= 100 ? "bg-emerald-600" : "bg-primary"}`} style={{ width: `${Math.min(100, pvPct)}%` }} />
                                {pvPct > 100 && <div className="absolute inset-y-[-2px] w-0.5 rounded bg-foreground/60" style={{ left: `${(100 / pvPct) * 100}%` }} />}
                              </div>
                              <span className={`text-xs font-semibold tabular-nums ${pvPct > 115 ? "text-amber-700 dark:text-amber-500" : pvPct >= 100 ? "text-emerald-700 dark:text-emerald-500" : "text-primary"}`}>
                                {Math.round(pvPct)}% da meta{pvPct > 115 ? " — bem acima da meta" : pvPct >= 100 ? " ✓" : ""}
                              </span>
                            </>
                          )}
                          <KV k="Real" v={brl(st.poder)} />
                        </>
                      ) : (
                        <KV k="Total" v={brl(st.poder)} />
                      )}
                    </div>
                    {ob && (
                      <div className="flex flex-col gap-1">
                        <GrpT>Modelos</GrpT>
                        <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                          <span><b className="font-display text-sm">{ob.realizado}/{ob.total}</b> <span className="text-muted-foreground">criados</span></span>
                          {over
                            ? <span className="font-semibold text-red-700 dark:text-red-400">divergência — {ob.realizado - ob.total} acima do plano</span>
                            : faltam > 0
                              ? <span className="text-muted-foreground">faltam {faltam} · open-to-buy</span>
                              : ob.total > 0 ? <span className="text-muted-foreground">plano completo ✓</span> : null}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
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
        <Button variant="outline" aria-label="Importar coleções existentes" onClick={() => setConfirmImportar(true)} disabled={importar.isPending}>Importar coleções</Button>
        <Button className="ml-auto" onClick={() => setTipoOpen(true)}><Plus className="h-4 w-4 mr-1" /> Nova coleção</Button>
      </MobileActionBar>

      <AlertDialog open={confirmImportar} onOpenChange={setConfirmImportar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Importar coleções existentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Cria no OTB as coleções que já existem no Planejamento e vincula os modelos delas.
              Coleções que já estão aqui não são alteradas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => importar.mutate()}>Importar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={tipoOpen} onOpenChange={setTipoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova coleção</DialogTitle>
            <DialogDescription>Como você quer montar esta coleção?</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:-translate-y-px hover:shadow-md hover:ring-2 hover:ring-primary"
              onClick={() => { setTipoOpen(false); setOpenNew(true); }}
            >
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary/10 text-primary"><Wallet className="h-5 w-5" /></span>
              <span className="font-display font-semibold">Por Orçamento</span>
              <span className="text-xs text-muted-foreground">Subcoleções, semanas e categorias, mirando o orçamento de custo.</span>
            </button>
            <button
              className="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all hover:-translate-y-px hover:shadow-md hover:ring-2 hover:ring-primary"
              onClick={() => { setTipoOpen(false); setPvOpen({ id: null }); }}
            >
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-primary/10 text-primary"><TargetIcon className="h-5 w-5" /></span>
              <span className="font-display font-semibold">Por Poder de Venda</span>
              <span className="text-xs text-muted-foreground">Herda um Padrão do mix e mira a meta de poder de venda.</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
