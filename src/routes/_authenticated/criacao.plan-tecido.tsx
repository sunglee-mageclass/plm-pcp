import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { RequirePermission } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownAZ, ArrowDownZA, CheckCircle2 } from "lucide-react";
import { FilterButton } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";
import { useOrcamento } from "@/components/otb/orcamento";
import { PlanTecidoSheet } from "@/components/plan-tecido/PlanTecidoSheet";
import { fmtMetros } from "@/lib/plan-tecido/calc";

// Coleção e subcoleção ABERTAS vivem na URL (?colecao=&sub=) — F5 e Voltar do navegador
// preservam onde o usuário estava, e a tela vira endereçável ("olha a R2"). Laudo das
// 3 lentes, jul/2026: antes era useState e o Back descartava as 3 etapas de uma vez.
type PlanTecidoSearch = { colecao?: string; sub?: string };

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido")({
  validateSearch: (s: Record<string, unknown>): PlanTecidoSearch => ({
    colecao: typeof s.colecao === "string" && s.colecao ? s.colecao : undefined,
    sub: typeof s.sub === "string" && s.sub ? s.sub : undefined,
  }),
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <PlanTecidoListPage />
    </RequirePermission>
  ),
});

type ColecaoRow = { id: string; nome: string; tipo: string | null; status: string | null; mes_id: string | null; ano_id: string | null };
type Opt = { id: string; nome: string };

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as any)
        .select(`id, ${key}`)
        .order(table === "meses" ? "ordem" : key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

const TIPO_LABEL: Record<string, string> = { orcamento: "Orçamento", poder_venda: "Poder de venda" };

/** "a comprar" da coleção no card — mesma conta do Fazer pedido (prévia salva no servidor).
 *  Query própria por card (poucas coleções por loja) com staleTime alto; silencioso enquanto carrega. */
function AComprarChip({ colecaoId }: { colecaoId: string }) {
  const { data } = useQuery({
    queryKey: ["plan-tecido-previa", colecaoId],
    staleTime: 5 * 60_000,
    queryFn: async () => ((await supabase.rpc("plan_tecido_previa_pedido" as any, { _colecao_id: colecaoId })).data ?? null) as any,
  });
  const info = useMemo(() => {
    if (!data) return null;
    let deficit = 0;
    for (const f of data.fornecedores ?? []) for (const it of f.itens ?? []) deficit += Number(it.deficit_m) || 0;
    // necessidade total (chave 'cobertura' = TODAS as linhas da conta): déficit 0 SEM necessidade
    // nenhuma = plano vazio, não "coberto" — 0/0 lia como verde (dono, jul/2026).
    let nec = 0;
    for (const c of (data.cobertura ?? []) as { nec_m: number }[]) nec += Number(c.nec_m) || 0;
    return { deficit, nec };
  }, [data]);
  if (info == null) return null;
  if (info.nec <= 0) return <span className="text-muted-foreground">sem plano de tecido</span>;
  return info.deficit > 0 ? (
    <span className="font-medium text-red-700">a comprar {fmtMetros(info.deficit)} m</span>
  ) : (
    <span className="font-medium text-emerald-700">tecido coberto</span>
  );
}

function PlanTecidoListPage() {
  const { isModuleEnabled } = useTenantModules();
  const navigate = useNavigate({ from: Route.fullPath });
  const { colecao: openColecaoId, sub: subAberta } = Route.useSearch();

  const { data: colecoes = [] } = useQuery({
    queryKey: ["plan-tecido-colecoes"],
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome, tipo, status, mes_id, ano_id").order("created_at", { ascending: false })).data ?? []) as ColecaoRow[],
  });

  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const orc = useOrcamento();

  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fTipo, setFTipo] = useState("all");

  const filtered = useMemo(() => {
    return colecoes.filter((c) => {
      if (fMes !== "all" && c.mes_id !== fMes) return false;
      if (fAno !== "all" && c.ano_id !== fAno) return false;
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (fTipo !== "all" && c.tipo !== fTipo) return false;
      return true;
    });
  }, [colecoes, fMes, fAno, fStatus, fTipo]);

  const sort = useSort(filtered, { key: "nome" });
  const nomeDe = (opts: Opt[], id: string | null) => opts.find((o) => o.id === id)?.nome ?? null;

  if (!isModuleEnabled("otb")) {
    return <div className="p-6 text-sm text-muted-foreground">Ative o módulo OTB para planejar tecido por coleção.</div>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* Sem o eyebrow "Estilo & Engenharia": era a ÚNICA tela que repetia a seção no
              título (dono, jul/2026) — a seção já aparece no header sticky e no hub. */}
          <h1 className="font-display text-2xl font-semibold tracking-tight">Planejamento de Tecido</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Escolha uma coleção para planejar os tecidos.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => sort.toggle("nome")}
            title="Ordenar por nome"
          >
            {sort.sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowDownZA className="h-4 w-4" />}
            <span className="hidden sm:inline">{sort.sortDir === "asc" ? "A–Z" : "Z–A"}</span>
          </Button>
          <FilterButton
            screen="plan-tecido"
            filters={[
              { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
              {
                label: "Status",
                value: fStatus,
                onChange: setFStatus,
                options: [
                  { id: "all", nome: "Todos" },
                  { id: "rascunho", nome: "Rascunho" },
                  { id: "confirmada", nome: "Confirmada" },
                ],
              },
              {
                label: "Tipo",
                value: fTipo,
                onChange: setFTipo,
                options: [
                  { id: "all", nome: "Todos" },
                  { id: "orcamento", nome: "Orçamento" },
                  { id: "poder_venda", nome: "Poder de Venda" },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sort.sorted.map((c) => {
          const bucket = orc.colecao(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate({ search: { colecao: c.id }, resetScroll: false })}
              className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
            >
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{c.nome}</span>
                {c.tipo && <Badge variant="secondary" className="shrink-0 font-normal">{TIPO_LABEL[c.tipo] ?? c.tipo}</Badge>}
              </span>
              {/* metadados que os FILTROS usam, visíveis no card (laudo: reconhecimento > evocação) */}
              <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {(nomeDe(meses, c.mes_id) || nomeDe(anos, c.ano_id)) && (
                  <span>{[nomeDe(meses, c.mes_id), nomeDe(anos, c.ano_id)].filter(Boolean).join(" · ")}</span>
                )}
                {c.status === "confirmada" ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />confirmada</span>
                ) : (
                  <span className="font-medium text-amber-700">rascunho</span>
                )}
              </span>
              <span className="flex w-full items-center gap-2 border-t border-dashed pt-2 text-xs text-muted-foreground">
                {/* 0/0 não é informação — coleção ainda em planejamento diz isso com todas as letras */}
                {bucket && (bucket.total > 0 || bucket.realizado > 0)
                  ? <span>{bucket.realizado}/{bucket.total} modelos</span>
                  : <span>sem modelos ainda</span>}
                <AComprarChip colecaoId={c.id} />
                <span className="ml-auto shrink-0 font-medium text-primary">abrir →</span>
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {colecoes.length === 0 ? (
              <>Nenhuma coleção ainda — <a href="/otb" className="font-medium text-primary underline">crie no OTB</a>.</>
            ) : (
              "Nenhuma coleção corresponde aos filtros."
            )}
          </div>
        )}
      </div>

      {openColecaoId && (
        <PlanTecidoSheet
          colecaoId={openColecaoId}
          subInicial={subAberta ?? null}
          onSubChange={(subId) => navigate({ search: { colecao: openColecaoId, sub: subId ?? undefined }, replace: true, resetScroll: false })}
          onClose={() => navigate({ search: {}, resetScroll: false })}
        />
      )}
    </div>
  );
}
