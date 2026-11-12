import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useIsFetching, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecks, Search, Minimize2, Maximize2, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useAuth } from "@/hooks/useAuth";
import { useEtapasPlConfig } from "@/hooks/useEtapasPlConfig";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useFilterState } from "@/hooks/useFilterState";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { buscarOpcoesColecao } from "@/lib/opcoes-colecao";
import { mensagemErro } from "@/lib/erro-mensagem";
import { fluxoEtapasPl, type DestinoDropPl } from "@/lib/etapas-pl-config";
import { etapasPlDefinirStatusDireto, etapasPlMover } from "@/lib/etapas-pl-rpc";
import { etapaPlFiltroOpts, toastDoMoverPl } from "@/lib/etapas-pl-ui";
import {
  contarPorEtapaPl, ehRecusaChaveDesligadaPl, filtrarProdutosPl, modoGravarMoverPl, montarProdutoPl, podeMoverPl,
  type ModeloPlRow,
} from "@/lib/pcp-etapas-pl-board";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { FilterButton } from "@/components/shared/filters";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { EtapasPlKanban } from "@/components/producao/etapas/EtapasPlKanban";
import { useEtapasPlProdutos } from "@/components/producao/etapas/useEtapasPlProdutos";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TerceirizadosDetail } from "@/routes/_authenticated/pcp.servicos.$modeloId";

// Etapas PL (Onda 3, Task 9) — a rota que JUNTA o board novo (`EtapasPlKanban`): 1 card por PRODUTO (`modelos.status_etapa_pl` não
// nulo), colunas = o board PL da loja (Config da Loja), arraste que obedece a chave do modo automático. Clicar no card abre o Sheet de
// Serviços (`TerceirizadosDetail`, o mesmo do PCP › Serviços). Substitui o quadro antigo (1 card por bloco, etapa derivada por datas,
// 5 etapas fixas, sem arraste).
//
// O módulo `etapas_pl` (opt-in) é guardado pelo `RequirePermission` (PageDef.gate): a tela só monta com o módulo ligado.
//
// MOVER:
//  - chave LIGADA: `etapas_pl_mover` (o servidor é a autoridade), toast pela RESPOSTA (`toastDoMoverPl`) e releitura das condições
//    (as que a tela tinha podem estar velhas);
//  - chave DESLIGADA: a RPC recusa (P0001 `etapas_pl_manual`) — a pessoa decide: UPDATE direto de `modelos.status_etapa_pl` (como o
//    Dev com a chave off). ⚠️ O UPDATE direto passa pelo gatilho de página de `modelos` (S3d): quem edita SÓ "PCP > Etapas" (sem
//    Planejamento/Desenvolvimento) recebe 42501 `sem_permissao_pagina` — a mensagem PT aparece no toast.
// A query dos cards NÃO leva os filtros na key (filtra no cliente: digitar na busca não refaz a leitura); `["etapas-pl-cards"]` e
// `["etapas-pl-cond"]` são invalidadas por prefixo ao mover/fechar o Sheet.
export const Route = createFileRoute("/_authenticated/pcp/etapas")({
  component: () => (
    <RequirePermission page="producao_etapas">
      <EtapasPlPage />
    </RequirePermission>
  ),
});

const SORT_NONE = "__none__";
const SORT_OPTS = [
  { key: "ref", label: "REF" },
  { key: "nome", label: "Nome" },
];

function AvisoCarga({ texto, onTentar, tentando }: { texto: string; onTentar: () => void; tentando: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" role="alert">
      <span>{texto}</span>
      <Button type="button" variant="outline" size="sm" onClick={onTentar} disabled={tentando}>
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
    </div>
  );
}

function EtapasPlPage() {
  const fl = useFieldLabels();
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const { canEdit } = useAuth();
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const { cfg, ligado, carregando: cfgCarregando, isError: cfgErro } = useEtapasPlConfig();
  const cfgTentando = useIsFetching({ queryKey: ["tenant-etapas-pl", tenantId] }) > 0;

  // ── Sheet de Serviços (mesmo padrão de pcp.servicos.index.tsx: Sheet + guarda de "não salvo" no pai) ──
  const [overlayModeloId, setOverlayModeloId] = useState<string | null>(null);
  const [overlayDirty, setOverlayDirty] = useState(false);
  const invalidarQuadro = () => {
    qc.invalidateQueries({ queryKey: ["etapas-pl-cards"] });
    qc.invalidateQueries({ queryKey: ["etapas-pl-cond"] });
  };
  const closeOverlay = () => {
    setOverlayDirty(false);
    setOverlayModeloId(null);
    // O Sheet grava por `salvar_terceirizados` (o que mexe nas condições e na posição do card): reler cards E condições.
    invalidarQuadro();
  };
  const { requestClose, confirm } = useUnsavedGuard({ dirty: overlayDirty, onClose: closeOverlay });

  const [busca, setBusca] = useState("");
  const [fColecao, setFColecao] = useFilterState("pcp-etapas", "Coleção", []);
  const [fFornecedor, setFFornecedor] = useFilterState("pcp-etapas", "Fornecedor", []);
  const [fOrigem, setFOrigem] = useFilterState("pcp-etapas", "Origem", []);
  const [fEtapa, setFEtapa] = useFilterState("pcp-etapas", "Etapa PL", []);
  const [sortKey, setSortKey] = useState(SORT_NONE);
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());
  const [minimizedCards, setMinimizedCards] = useState(false);

  // ── Produtos do board (`modelos` com `status_etapa_pl` NÃO nulo) + condições (SÓ com a chave ligada) ──
  const { cardsQ, rows, condQ, condicoesProntas, condErro } = useEtapasPlProdutos(ligado);
  const cardsErro = cardsQ.isError;

  const todos = useMemo(() => (rows ?? []).map((m) => montarProdutoPl(m, hoje, true)), [rows, hoje]);

  const podeMover = podeMoverPl({
    podeEditar: canEdit("producao_etapas"),
    cfgCarregando,
    cfgErro,
    ligado,
    condicoesProntas: condicoesProntas && !condErro,
    cardsErro,
  });

  // ── Opções dos filtros ──
  // [backend F2] opções de Coleção = RPC `opcoes_colecao_modelos()` (rótulo = nome do OTB, senão o texto), sem baixar os cards.
  const { data: colecoes = [] } = useQuery({
    queryKey: ["opt", "colecoes-modelos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await buscarOpcoesColecao()).colecoes,
  });
  const etapaOpts = useMemo(() => etapaPlFiltroOpts(cfg), [cfg]);

  // Cascata Coleção→Fornecedor: as opções de fornecedor saem dos produtos da(s) coleção(ões) escolhida(s).
  const fornecedores = useMemo(() => {
    const base = fColecao.length ? todos.filter((p) => fColecao.includes(p.colecao ?? "")) : todos;
    return Array.from(new Set(base.flatMap((p) => p.fornecedores))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [todos, fColecao]);
  // Poda a seleção de fornecedor que saiu das opções — SÓ com os dados lidos (durante a carga as opções são vazias e a poda
  // apagaria o filtro persistido).
  useEffect(() => {
    if (!rows || cardsErro) return;
    const validos = new Set(fornecedores);
    const podado = fFornecedor.filter((f) => validos.has(f));
    if (podado.length !== fFornecedor.length) setFFornecedor(podado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fornecedores, rows, cardsErro]);

  const produtos = useMemo(() => {
    let list = filtrarProdutosPl(todos, { busca, colecao: fColecao, fornecedor: fFornecedor, origem: fOrigem, etapa: fEtapa }, cfg, ligado);
    if (sortKey !== SORT_NONE) {
      list = [...list].sort((a, b) => {
        const av = (sortKey === "ref" ? a.ref : a.nome) ?? "";
        const bv = (sortKey === "ref" ? b.ref : b.nome) ?? "";
        return av.localeCompare(bv, "pt-BR");
      });
    }
    return list;
  }, [todos, busca, fColecao, fFornecedor, fOrigem, fEtapa, sortKey, cfg, ligado]);

  const contagem = useMemo(() => contarPorEtapaPl(produtos, etapaOpts, cfg, ligado), [produtos, etapaOpts, cfg, ligado]);

  // ── Recolher colunas (as do fluxo; a terminal "Finalizado" tem o colapso próprio dentro do board) ──
  const chavesColunas = useMemo(() => fluxoEtapasPl(cfg), [cfg]);
  const allCollapsed = chavesColunas.length > 0 && chavesColunas.every((k) => collapsedCols.has(k));
  const toggleAllCols = () => setCollapsedCols(allCollapsed ? new Set() : new Set(chavesColunas));
  const toggleCol = (key: string) =>
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ── Mover ──
  const moverMut = useMutation({
    mutationFn: async (v: { id: string; para: string; ligado: boolean }) => {
      if (modoGravarMoverPl(v.ligado) === "rpc") return { r: await etapasPlMover(v.id, v.para), direto: false as const };
      await etapasPlDefinirStatusDireto(v.id, v.para);
      return { r: null, direto: true as const };
    },
    onMutate: async ({ id, para, ligado: lig }) => {
      // Otimista só no UPDATE direto (o status final é o pedido); na RPC o status vem da RESPOSTA.
      if (lig) return { prev: undefined };
      await qc.cancelQueries({ queryKey: ["etapas-pl-cards"] });
      const prev = qc.getQueryData<ModeloPlRow[]>(["etapas-pl-cards", tenantId]);
      qc.setQueryData<ModeloPlRow[]>(["etapas-pl-cards", tenantId], (old) =>
        (old ?? []).map((m) => (m.id === id ? { ...m, status_etapa_pl: para } : m)),
      );
      return { prev };
    },
    onSuccess: (res, { id, para }) => {
      if (res.r) {
        const r = res.r;
        if (r.status) {
          qc.setQueryData<ModeloPlRow[]>(["etapas-pl-cards", tenantId], (old) =>
            (old ?? []).map((m) => (m.id === id ? { ...m, status_etapa_pl: r.status } : m)),
          );
        }
        const t = toastDoMoverPl(r, para, cfg);
        if (t.tipo === "erro") toast.error(t.titulo);
        else if (t.tipo === "ok") toast.success(t.titulo);
        else toast.info(t.titulo);
      }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["etapas-pl-cards", tenantId], ctx.prev);
      // A tela leu a chave "ligada" e o servidor está "desligada" (outra aba/admin mudou): reler a config para o quadro voltar ao
      // caminho manual na próxima interação, em vez de oferecer o arraste que o servidor já recusou.
      if (ehRecusaChaveDesligadaPl(e)) qc.invalidateQueries({ queryKey: ["tenant-etapas-pl"] });
      toast.error(mensagemErro(e, "Erro ao mover o card"));
    },
    // Servidor = autoridade: relê os cards E as condições (as da tela podem estar velhas depois de salvar/mover).
    onSettled: () => invalidarQuadro(),
  });
  const onMover = (produtoId: string, para: string, _previsto: DestinoDropPl | null) => {
    moverMut.mutate({ id: produtoId, para, ligado });
  };

  const carregandoCards = cardsQ.isPending || cfgCarregando;
  const semDados = rows === undefined;

  // Módulo Etapas PL (opt-in): guardado pelo `RequirePermission` (PageDef.gate) — a tela só monta com o módulo ligado.
  return (
    <div className="container mx-auto space-y-4 p-3 sm:p-6">
      <Breadcrumb items={[{ label: "PCP", to: "/pcp" }, { label: "Etapas" }]} />

      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ListChecks className="mt-0.5 h-7 w-7 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight">Etapas — Produção PL</h1>
            <p className="text-sm text-muted-foreground">Quadro de acompanhamento por etapa da confecção PL.</p>
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
                label: "Etapa PL",
                value: fEtapa,
                onChange: setFEtapa,
                options: etapaOpts.map((o) => ({ id: o.id, nome: o.label })),
              },
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
              {
                label: "Origem",
                value: fOrigem,
                onChange: setFOrigem,
                options: [
                  { id: "interno", nome: "Interno" },
                  { id: "revenda", nome: "Revenda" },
                ],
              },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            className="hidden h-9 md:inline-flex"
            onClick={toggleAllCols}
            disabled={chavesColunas.length === 0}
            title={allCollapsed ? "Expandir todas as colunas" : "Recolher todas as colunas"}
          >
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4 sm:mr-1" /> : <ChevronsDownUp className="h-4 w-4 sm:mr-1" />}
            <span className="max-lg:sr-only">{allCollapsed ? "Expandir colunas" : "Recolher colunas"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setMinimizedCards((v) => !v)}
            title={minimizedCards ? "Expandir cards" : "Recolher cards"}
          >
            {minimizedCards ? <Maximize2 className="h-4 w-4 sm:mr-1" /> : <Minimize2 className="h-4 w-4 sm:mr-1" />}
            <span className="max-lg:sr-only">{minimizedCards ? "Expandir cards" : "Recolher cards"}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {produtos.length} PL{produtos.length === 1 ? "" : "s"} ativo{produtos.length === 1 ? "" : "s"}
        </span>
        {contagem.map((c) => (
          <span key={c.id} className="text-sm text-muted-foreground">
            · {c.label}: {c.count}
          </span>
        ))}
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

      {/* P-57: falha de carga NÃO vira "quadro vazio" — avisa, oferece "Tentar de novo" e TRAVA o arraste (`podeMover`). */}
      {cardsErro && (
        <AvisoCarga
          texto="Não foi possível carregar os produtos das Etapas PL. O quadro pode estar incompleto."
          onTentar={() => void cardsQ.refetch()}
          tentando={cardsQ.isFetching}
        />
      )}
      {cfgErro && (
        <AvisoCarga
          texto="Não foi possível carregar a configuração das Etapas PL. O arraste fica travado."
          onTentar={() => qc.invalidateQueries({ queryKey: ["tenant-etapas-pl", tenantId] })}
          tentando={cfgTentando}
        />
      )}
      {condErro && (
        <AvisoCarga
          texto="Não foi possível ler as condições das etapas. O arraste fica travado."
          onTentar={() => void condQ.refetch()}
          tentando={condQ.isFetching}
        />
      )}

      {carregandoCards && semDados ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : semDados || cfgErro ? null : todos.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum PL encontrado.</p>
      ) : (
        <EtapasPlKanban
          produtos={produtos}
          cfg={cfg}
          ligado={ligado}
          satisfeitasPorProduto={ligado ? condQ.data : undefined}
          podeMover={podeMover}
          collapsedCols={collapsedCols}
          onToggleCol={toggleCol}
          onAbrir={setOverlayModeloId}
          onMover={onMover}
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
          {/* Guarda DENTRO do SheetContent (portal) — mesma razão do pcp.servicos.index.tsx: fora do portal o indicador "não salvo"
              não aparecia. */}
          <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nos Serviços." />
        </SheetContent>
      </Sheet>
    </div>
  );
}
