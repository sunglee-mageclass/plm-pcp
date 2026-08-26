import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Search, Minimize2, Maximize2 } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { supabase } from "@/integrations/supabase/client";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { TerceirizadosDetail } from "@/routes/_authenticated/pcp.servicos.$modeloId";
import { FilterButton } from "@/components/shared/filters";
import { useFilterState } from "@/hooks/useFilterState";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useEtapasCards } from "@/components/producao/etapas/useEtapasCards";
import { EtapasBoard } from "@/components/producao/etapas/EtapasBoard";
import { ETAPA_FINALIZADO, type EtapaKey } from "@/lib/pcp-etapas";

// Etapas PL (Fase 2, Task 1) — página ÚNICA (sem sub-rota de detalhe ainda), então o
// componente renderiza direto (sem <Outlet/>), diferente de pcp.servicos.tsx que envolve
// as sub-rotas $modeloId/index. Sem ModuleGuard aqui de propósito — mesmo precedente do
// produto_acabado/otb (CLAUDE.md, corrida de render do useTenantModules().isLoading antes
// do tenantId resolver): renderiza um empty-state próprio quando `etapas_pl` está OFF.
export const Route = createFileRoute("/_authenticated/pcp/etapas")({
  component: () => (
    <RequirePermission page="producao_etapas">
      <EtapasPlPage />
    </RequirePermission>
  ),
});

// Ordenação simples do resumo — "Ordenar por" existe pra espelhar o padrão do sibling
// (linha 2 do header), mas por ora o quadro é agrupado por etapa (a ordem dentro da coluna
// não muda por essa seleção ainda; fica pronta para o Task 4/5 usarem).
const SORT_NONE = "__none__";
const SORT_OPTS = [
  { key: "ref", label: "REF" },
  { key: "nome", label: "Nome" },
];

function EtapasPlPage() {
  const { isModuleEnabled, isLoading } = useTenantModules();
  const fl = useFieldLabels();
  const qc = useQueryClient();

  // Overlay do PCP Serviços (Task 5) — mesmo padrão de pcp.servicos.index.tsx: Sheet
  // embutido + guarda de "não salvo" no pai (o TerceirizadosDetail reporta dirty via
  // onDirtyChange; fechar com pendências passa pelo requestClose/confirm).
  const [overlayModeloId, setOverlayModeloId] = useState<string | null>(null);
  const [overlayDirty, setOverlayDirty] = useState(false);
  const closeOverlay = () => {
    setOverlayDirty(false);
    setOverlayModeloId(null);
    // O sheet grava via a mesma RPC do PCP Serviços (salvar_terceirizados) → o quadro
    // precisa reler pra refletir a mudança (a lista de Serviços já se invalida sozinha
    // dentro do TerceirizadosDetail; "etapas-cards" é queryKey própria desta tela).
    qc.invalidateQueries({ queryKey: ["etapas-cards"] });
  };
  const { requestClose, confirm } = useUnsavedGuard({ dirty: overlayDirty, onClose: closeOverlay });

  const [busca, setBusca] = useState("");
  const [fColecao, setFColecao] = useFilterState("pcp-etapas", "Coleção", []);
  const [fFornecedor, setFFornecedor] = useFilterState("pcp-etapas", "Fornecedor", []);
  const [sortKey, setSortKey] = useState(SORT_NONE);
  const [collapsedCols, setCollapsedCols] = useState<Set<EtapaKey>>(new Set());
  const [minimizedCards, setMinimizedCards] = useState(false);

  // `useEtapasCards` já filtra coleção/busca no servidor (EtapasFiltros); fornecedor não faz
  // parte da interface do T2 (o card achatado não carrega coleção — só o bloco carrega
  // empresa), então filtramos fornecedor no cliente, sobre o resultado já filtrado.
  const {
    cards: filteredCards,
    etapas,
    isLoading: cardsLoading,
  } = useEtapasCards({
    busca,
    colecao: fColecao,
  });

  const tenantId = useActiveTenantId();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["opt", "colecoes-modelos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("colecao")
        .not("colecao", "is", null);
      if (error) throw error;
      return Array.from(
        new Set((data ?? []).map((r: { colecao: string | null }) => r.colecao).filter(Boolean)),
      ) as string[];
    },
  });

  const fornecedores = useMemo(
    () => Array.from(new Set(filteredCards.map((c) => c.empresa).filter(Boolean))) as string[],
    [filteredCards],
  );

  // Cascata Coleção→Fornecedor: `filteredCards` já vem filtrado por coleção (useEtapasCards),
  // então `fornecedores` já é a união certa; aqui só podamos a seleção de fFornecedor quando
  // a troca de coleção reduz as opções disponíveis (idempotente — só remove).
  useEffect(() => {
    const validos = new Set(fornecedores);
    const podado = fFornecedor.filter((f) => validos.has(f));
    if (podado.length !== fFornecedor.length) setFFornecedor(podado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedores]);

  const cards = useMemo(() => {
    let list = filteredCards;
    if (fFornecedor.length) list = list.filter((c) => fFornecedor.includes(c.empresa ?? ""));
    if (sortKey !== SORT_NONE) {
      list = [...list].sort((a, b) => {
        const av = (sortKey === "ref" ? a.ref : a.nome) ?? "";
        const bv = (sortKey === "ref" ? b.ref : b.nome) ?? "";
        return av.localeCompare(bv, "pt-BR");
      });
    }
    return list;
  }, [filteredCards, fFornecedor, sortKey]);

  const colunasAtivas = etapas.filter((e) => e.ativa);
  const contagemPorEtapa = colunasAtivas.map((col) => ({
    ...col,
    count: cards.filter((c) => c.etapa === col.key).length,
  }));
  // Contagem da coluna terminal sintética "Finalizado" (fora de `colunasAtivas`/toggle-all —
  // só entra no resumo pra deixar a soma dos cards visível/fechada).
  const finalizadoCount = cards.filter((c) => c.etapa === ETAPA_FINALIZADO).length;

  const allCollapsed =
    colunasAtivas.length > 0 && colunasAtivas.every((c) => collapsedCols.has(c.key));
  const toggleAllCols = () =>
    setCollapsedCols(allCollapsed ? new Set() : new Set(colunasAtivas.map((c) => c.key)));
  const toggleCol = (key: EtapaKey) =>
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onAbrir = (modeloId: string) => {
    setOverlayModeloId(modeloId);
  };

  // Evita flashear a tela errada no primeiro paint (mesmo padrão de criacao.produto-acabado.tsx).
  if (isLoading) return null;

  if (!isModuleEnabled("etapas_pl")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <ListChecks className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Etapas PL desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em{" "}
          <Link to="/admin/configuracoes" className="underline underline-offset-2">
            Config da Loja
          </Link>{" "}
          para usar o quadro de Etapas.
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-4 p-3 sm:p-6">
      <Breadcrumb items={[{ label: "PCP", to: "/pcp" }, { label: "Etapas" }]} />

      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ListChecks className="mt-0.5 h-7 w-7 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight">
              Etapas — Produção PL
            </h1>
            <p className="text-sm text-muted-foreground">
              Quadro de acompanhamento por etapa da confecção PL.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 max-sm:justify-end sm:w-auto">
          <div className="relative w-full max-w-sm sm:w-56">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Pesquisar por nome ou REF…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <FilterButton
            screen="pcp-etapas"
            filters={[
              {
                label: fl("colecao"),
                value: fColecao,
                onChange: setFColecao,
                options: colecoes.map((c) => ({ id: c, nome: c })),
              },
              {
                label: "Fornecedor",
                value: fFornecedor,
                onChange: setFFornecedor,
                options: fornecedores.map((f) => ({ id: f, nome: f })),
              },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            className="hidden h-9 md:inline-flex"
            onClick={toggleAllCols}
            disabled={colunasAtivas.length === 0}
            title={allCollapsed ? "Expandir todas as colunas" : "Recolher todas as colunas"}
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-4 w-4 sm:mr-1" />
            ) : (
              <ChevronsDownUp className="h-4 w-4 sm:mr-1" />
            )}
            <span className="max-lg:sr-only">
              {allCollapsed ? "Expandir colunas" : "Recolher colunas"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setMinimizedCards((v) => !v)}
            title={minimizedCards ? "Expandir cards" : "Recolher cards"}
          >
            {minimizedCards ? (
              <Maximize2 className="h-4 w-4 sm:mr-1" />
            ) : (
              <Minimize2 className="h-4 w-4 sm:mr-1" />
            )}
            <span className="max-lg:sr-only">
              {minimizedCards ? "Expandir cards" : "Recolher cards"}
            </span>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {cards.length} PL{cards.length === 1 ? "" : "s"} ativo{cards.length === 1 ? "" : "s"}
        </span>
        {contagemPorEtapa.map((c) => (
          <span key={c.key} className="text-sm text-muted-foreground">
            · {c.label}: {c.count}
          </span>
        ))}
        {finalizadoCount > 0 && (
          <span className="text-sm text-muted-foreground">· Finalizado: {finalizadoCount}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">Ordenar por</Label>
          <Select value={sortKey} onValueChange={setSortKey}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="Padrão" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SORT_NONE}>Padrão</SelectItem>
              {SORT_OPTS.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!cardsLoading && cards.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum PL encontrado.</p>
      ) : (
        <EtapasBoard
          cards={cards}
          etapas={etapas}
          collapsedCols={collapsedCols}
          onToggleCol={toggleCol}
          onAbrir={onAbrir}
          minimizedCards={minimizedCards}
        />
      )}

      <Sheet open={!!overlayModeloId} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent size="editor" className="flex flex-col p-0 max-md:[&>button]:hidden">
          {overlayModeloId && (
            <TerceirizadosDetail
              modeloId={overlayModeloId}
              onClose={requestClose}
              onForceClose={closeOverlay}
              onDirtyChange={setOverlayDirty}
            />
          )}
          {/* Guarda DENTRO do SheetContent (portal) — mesma razão do pcp.servicos.index.tsx:
              fora do portal o indicador "não salvo" não aparecia. */}
          <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nos Serviços." />
        </SheetContent>
      </Sheet>
    </div>
  );
}
