import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useAuth } from "@/hooks/useAuth";
import { RequirePermission } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ArrowDownAZ, ArrowDownZA } from "lucide-react";
import { useSort } from "@/components/shared/sort";
import { ProdutoAcabadoSheet } from "@/components/produto-acabado/ProdutoAcabadoSheet";

// Coleção e subcoleção ABERTAS vivem na URL (?colecao=&sub=) — mesmo padrão do Plan.
// Tecido (F5/Voltar preservam onde o usuário estava; tela endereçável).
type ProdutoAcabadoSearch = { colecao?: string; sub?: string };

export const Route = createFileRoute("/_authenticated/criacao/produto-acabado")({
  validateSearch: (s: Record<string, unknown>): ProdutoAcabadoSearch => ({
    colecao: typeof s.colecao === "string" && s.colecao ? s.colecao : undefined,
    sub: typeof s.sub === "string" && s.sub ? s.sub : undefined,
  }),
  // Sem ModuleGuard aqui de propósito — mesmo padrão do OTB/OC P. Acabado (Task 5): o gate de
  // módulo é aplicado na sidebar/hub (PageDef.gate) + nas RPCs (tenant_module_enabled); a
  // página em si é protegida por permissão + o check de módulo abaixo (empty-state, evita
  // mostrar a tela quando dá pra saber que está desligado).
  component: () => (
    <RequirePermission page="criacao_produto_acabado">
      <ProdutoAcabadoListPage />
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

function ProdutoAcabadoListPage() {
  const { isModuleEnabled, isLoading } = useTenantModules();
  const { isSuperAdmin } = useAuth();
  const navigate = useNavigate({ from: Route.fullPath });
  const { colecao: openColecaoId, sub: subAberta } = Route.useSearch();

  const { data: colecoes = [] } = useQuery({
    queryKey: ["produto-acabado-colecoes"],
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome, tipo, status, mes_id, ano_id").order("created_at", { ascending: false })).data ?? []) as ColecaoRow[],
  });
  const { data: contagens = {} } = useQuery({
    queryKey: ["produto-acabado-contagem-por-colecao"],
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_acabados" as any).select("colecao_id");
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as unknown as { colecao_id: string | null }[]) if (r.colecao_id) m[r.colecao_id] = (m[r.colecao_id] ?? 0) + 1;
      return m;
    },
  });

  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");

  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const filtered = useMemo(() => {
    return colecoes.filter((c) => {
      if (fMes !== "all" && c.mes_id !== fMes) return false;
      if (fAno !== "all" && c.ano_id !== fAno) return false;
      return true;
    });
  }, [colecoes, fMes, fAno]);

  const sort = useSort(filtered, { key: "nome" });
  const nomeDe = (opts: Opt[], id: string | null) => opts.find((o) => o.id === id)?.nome ?? null;

  // Mitigação de UI (mesmo padrão de entrada-saida.oc-p-acabado.tsx / OC P. Acabado): módulo
  // OFF ainda é alcançável por URL direta — evita mostrar a lista quando dá pra saber que está
  // desligado. `isLoading` pode ler `false` numa render intermediária antes do tenantId
  // resolver (bug pré-existente documentado na Task 5) — o `if (isLoading) return null` evita
  // flashear a tela errada no primeiro paint.
  if (isLoading) return null;
  if (!isModuleEnabled("produto_acabado")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Produto Acabado desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em <Link to="/admin/configuracoes" className="underline underline-offset-2">Config da Loja</Link> para usar o planejador Produto Acabado.
        </p>
      </div>
    );
  }
  // Achado EXTRA do review (fix round 1): loja com produto_acabado ON e otb OFF caía num
  // texto cinza discreto (fácil de confundir com "tela vazia") — o planejador é 100% organizado
  // por coleção do OTB (§2 do design), então merece o MESMO tratamento visual do módulo OFF
  // acima. ⚠️ Sem link pra "Config da Loja" aqui de propósito: diferente de `produto_acabado`
  // (Task 5, `ProdutoAcabadoToggleCard` — Switch de verdade), `otb` é um dos 7 módulos de
  // CONTRATAÇÃO (badge só-leitura em `admin/configuracoes.tsx`, editável só por super_admin em
  // `admin/lojas.tsx`) — um `tenant_admin` clicando num link pra Config da Loja só veria o
  // mesmo badge "Inativo", sem ação nenhuma (achado ao conferir o código de `configuracoes.tsx`
  // durante o fix). `isSuperAdmin` ganha o link de verdade; os demais veem o pedido pra loja.
  if (!isModuleEnabled("otb")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <Package className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo OTB desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          O Produto Acabado usa as coleções do OTB.{" "}
          {isSuperAdmin ? (
            <>Ative o módulo OTB em <Link to="/admin/lojas" className="underline underline-offset-2">Gerenciar Lojas</Link>.</>
          ) : (
            "Peça a um administrador da loja para ativar o módulo OTB."
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Package className="mt-0.5 h-7 w-7 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight">Produto Acabado</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Escolha uma coleção para planejar produtos de revenda.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => sort.toggle("nome")} title="Ordenar por nome">
            {sort.sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowDownZA className="h-4 w-4" />}
            <span className="hidden sm:inline">{sort.sortDir === "asc" ? "A–Z" : "Z–A"}</span>
          </Button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fMes} onChange={(e) => setFMes(e.target.value)}>
          <option value="all">Todos os meses</option>
          {meses.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fAno} onChange={(e) => setFAno(e.target.value)}>
          <option value="all">Todos os anos</option>
          {anos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sort.sorted.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => navigate({ search: { colecao: c.id }, resetScroll: false })}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
          >
            <span className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{c.nome}</span>
              {c.tipo && <StatusBadge tone="info" className="shrink-0">{TIPO_LABEL[c.tipo] ?? c.tipo}</StatusBadge>}
            </span>
            <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {(nomeDe(meses, c.mes_id) || nomeDe(anos, c.ano_id)) && (
                <span>{[nomeDe(meses, c.mes_id), nomeDe(anos, c.ano_id)].filter(Boolean).join(" · ")}</span>
              )}
              {c.status === "confirmada" ? <StatusBadge tone="success">Confirmada</StatusBadge> : <StatusBadge tone="warning">Rascunho</StatusBadge>}
            </span>
            <span className="flex w-full items-center gap-2 border-t border-dashed pt-2 text-xs text-muted-foreground">
              <span>{contagens[c.id] ?? 0} produto(s)</span>
              <span className="ml-auto shrink-0 font-medium text-primary">abrir →</span>
            </span>
          </button>
        ))}
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
        <ProdutoAcabadoSheet
          colecaoId={openColecaoId}
          subInicial={subAberta ?? null}
          onSubChange={(subId) => navigate({ search: { colecao: openColecaoId, sub: subId ?? undefined }, replace: true, resetScroll: false })}
          onClose={() => navigate({ search: {}, resetScroll: false })}
        />
      )}
    </div>
  );
}
