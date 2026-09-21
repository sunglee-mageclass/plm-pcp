// Tela "Distribuição" — resumo automático da coleção + N tabelas de distribuição por loja.
// Módulo opt-in (padrão OTB: RequirePermission, sem ModuleGuard — empty-state quando OFF).

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { BarChart3, Plus, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useTenantModules } from "@/hooks/useTenantModules";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { ResumoColecao } from "@/components/distribuicao/ResumoColecao";
import { DistribuicaoTabela } from "@/components/distribuicao/DistribuicaoTabela";
import type { ResumoData } from "@/components/distribuicao/ResumoColecao";
import type { TabelaRow } from "@/components/distribuicao/DistribuicaoTabela";

export const Route = createFileRoute("/_authenticated/distribuicao/")({
  component: () => (
    <RequirePermission page="distribuicao">
      <DistribuicaoPage />
    </RequirePermission>
  ),
});

type ColOpt = { id: string; nome: string };

function DistribuicaoPage() {
  const { isModuleEnabled } = useTenantModules();
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const [colecaoId, setColecaoId] = useState<string>("");
  const [subcolecao, setSubcolecao] = useState<string>(""); // "" = todas

  // coleções e subcoleções (reusa as queryKeys do Planejamento)
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome").order("nome");
      return (data ?? []) as ColOpt[];
    },
  });
  const { data: subcolecoes = [] } = useQuery({
    queryKey: ["subcolecoes-opts", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data } = await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", colecaoId).order("ordem");
      return ((data ?? []) as { nome: string }[]).map((s) => s.nome);
    },
  });

  // resumo (RPC) da coleção/subcoleção
  const { data: resumo, isLoading: resumoLoading } = useQuery({
    queryKey: ["distribuicao-resumo", colecaoId, subcolecao],
    enabled: !!colecaoId,
    queryFn: async () => {
      // RPC nova ainda não no types.ts → cast (padrão do projeto).
      const { data, error } = await (supabase.rpc as any)("distribuicao_resumo", {
        _colecao_id: colecaoId, _subcolecao: subcolecao || null,
      });
      if (error) throw error;
      return data as unknown as ResumoData;
    },
  });

  // tabelas salvas da coleção/subcoleção
  const { data: tabelas = [], isLoading: tabelasLoading } = useQuery({
    queryKey: ["distribuicao-tabelas", colecaoId, subcolecao],
    enabled: !!colecaoId,
    queryFn: async () => {
      let q = supabase.from("distribuicao_tabelas" as never).select("*").eq("colecao_id", colecaoId).order("ordem");
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as TabelaRow[];
      // filtra por subcoleção (null = coleção inteira) no cliente
      return rows.filter((r) => (subcolecao ? r.subcolecao === subcolecao : r.subcolecao == null));
    },
  });

  const addMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("salvar_distribuicao_tabela", {
        _dados: {
          colecao_id: colecaoId, subcolecao: subcolecao || null,
          nome: "Nova tabela", ordem: tabelas.length,
          grade_base: {}, cores: 1, pecas_mes: 0, lojas: [],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["distribuicao-tabelas", colecaoId, subcolecao] }),
    onError: (e) => toast.error(mensagemErro(e, "Erro ao adicionar tabela.")),
  });

  const invalidarTabelas = () => qc.invalidateQueries({ queryKey: ["distribuicao-tabelas", colecaoId, subcolecao] });

  if (!isModuleEnabled("distribuicao")) {
    return (
      <div className="container mx-auto p-6">
        <EmptyState icon={Lock} title="Distribuição não está habilitada"
          description="Peça ao administrador para ativar o módulo Distribuição para esta loja." />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <BarChart3 className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Distribuição</h1>
            <p className="text-sm text-muted-foreground">Distribuição por loja e poder de venda.</p>
          </div>
        </div>
      </header>

      {/* seletores */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Coleção</label>
          <Select value={colecaoId} onValueChange={(v) => { setColecaoId(v); setSubcolecao(""); }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Selecione a coleção" /></SelectTrigger>
            <SelectContent>
              {colecoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Subcoleção <span className="opacity-60">(opcional)</span></label>
          <Select value={subcolecao || "__todas__"} onValueChange={(v) => setSubcolecao(v === "__todas__" ? "" : v)} disabled={!colecaoId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas__">Todas (usa a coleção)</SelectItem>
              {subcolecoes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!colecaoId ? (
        <EmptyState icon={BarChart3} title="Escolha uma coleção" description="Selecione a coleção (e subcoleção) para ver o resumo e montar as tabelas de distribuição." />
      ) : (
        <>
          {/* resumo */}
          {resumoLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando resumo…</div>
          ) : resumo ? <ResumoColecao resumo={resumo} /> : null}

          {/* tabelas */}
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">Tabelas de distribuição</h2>
            <Button onClick={() => addMut.mutate()} disabled={readOnly || addMut.isPending}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar tabela
            </Button>
          </div>

          {tabelasLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : tabelas.length === 0 ? (
            <EmptyState icon={Plus} title="Nenhuma tabela ainda" description='Clique em "Adicionar tabela" para criar a primeira distribuição.' />
          ) : (
            tabelas.map((t) => (
              <DistribuicaoTabela key={t.id} tabela={t} readOnly={readOnly} onChanged={invalidarTabelas} />
            ))
          )}
        </>
      )}
    </div>
  );
}
