import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus, Trash2 } from "lucide-react";
import { OcDocumentoPrint, type OcDocModelo } from "@/components/shared/OcDocumentoPrint";
import { OcImprimirLinhaButton } from "@/components/shared/OcImprimirLinhaButton";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { RequirePermission } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { varianteLabel } from "@/lib/variante";
import { fmtMoeda } from "@/lib/moeda";
import { contarRecebidos, motivoNaoExcluirOc, produtosTexto, textoProdutosDaOc, textoRecebidos } from "@/lib/oc-multi-itens";
import { textoExcluirOc } from "@/lib/confirmacoes-textos";
import { OcImpDialog } from "@/components/oc-p-importado/OcImpDialog";
import { montarDocModeloOcImp } from "@/components/oc-p-importado/doc-modelo";
import { buscarTamanhosLoja, lerOcComItens } from "@/components/oc-p-importado/queries";
import { fmtDate, type OcImportadoRow, type OcImportadoTab, type OcImportadoStatus } from "@/components/oc-p-importado/shared";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-p-importado")({
  validateSearch: (s: Record<string, unknown>): { tab?: OcImportadoTab; oc?: string } => ({
    tab: s.tab === "encomendado" || s.tab === "recebido" || s.tab === "estoque" ? (s.tab as OcImportadoTab) : undefined,
    // `?oc=<id>` abre a OC direto (deep-link) — usado pelo "Fazer pedido" do card
    // Produto Importado, que cria/aponta pra uma OC específica (espelha OC P. Acabado).
    oc: typeof s.oc === "string" && s.oc ? s.oc : undefined,
  }),
  // Sem ModuleGuard aqui de propósito — mesmo precedente do OTB/Produto Acabado: o gate de
  // módulo é aplicado na SIDEBAR/HUB e nas RPCs (`tenant_module_enabled`); a página em si é
  // protegida só por permissão, com empty-state próprio quando o módulo está OFF.
  component: () => (
    <RequirePermission page="entrada_oc_p_importado">
      <OcImpPage />
    </RequirePermission>
  ),
});

// Lista (abas): o produto saiu do cabeçalho (R13) — a coluna "Produtos" vem do embed dos ITENS.
const SELECT_LISTA =
  "id, numero, empresa_id, data_pedido, data_prevista, data_entrega, data_nota_entrada, qtd_total, valor_total_desconto, moeda_compra, status, " +
  "itens:ocs_importado_itens(id, ordem, nome_produto, status)";

function OcImpPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [tab, setTab] = useState<OcImportadoTab>(search.tab ?? "recebido");
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();
  // Deep-link `?oc=<id>` — abre a OC direto.
  const deepLinkAbertoRef = useRef(false);
  useEffect(() => {
    if (search.oc && !deepLinkAbertoRef.current) {
      deepLinkAbertoRef.current = true;
      setEditingId(search.oc);
      setOpenDialog(true);
    }
  }, [search.oc]);

  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ["ocs_importado", tab],
    enabled: tab !== "estoque",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_importado" as any)
        .select(SELECT_LISTA)
        .eq("status", tab as OcImportadoStatus)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OcImportadoRow[];
    },
  });

  const { data: tabCounts } = useQuery({
    queryKey: ["ocs_importado", "tab-counts"],
    queryFn: async () => {
      const [enc, rec] = await Promise.all([
        supabase.from("ocs_importado" as any).select("id", { count: "exact", head: true }).eq("status", "encomendado"),
        supabase.from("ocs_importado" as any).select("id", { count: "exact", head: true }).eq("status", "recebido"),
      ]);
      return { encomendado: enc.count ?? 0, recebido: rec.count ?? 0 };
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "produto-importado-oc"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, representantes(id, nome)")
        .eq("tipo", "material")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as { id: string; nome_fantasia: string; representantes: { id: string; nome: string | null }[] }[];
    },
  });
  const empresaMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  // Cores (base+apelido) p/ resolver o nome das variantes no documento imprimível da linha.
  const { data: coresDoc = {} } = useQuery({
    queryKey: ["oc-imp-cores-doc"],
    queryFn: async () => {
      const [c, ca] = await Promise.all([
        supabase.from("cores").select("id, nome"),
        supabase.from("cores_apelido").select("id, nome"),
      ]);
      const base = Object.fromEntries(((c.data ?? []) as any[]).map((x) => [x.id, x.nome]));
      const apel = Object.fromEntries(((ca.data ?? []) as any[]).map((x) => [x.id, x.nome]));
      return { base, apel } as { base: Record<string, string>; apel: Record<string, string> };
    },
  });

  // Monta o documento imprimível de UMA OC de produto importado: relê a OC COM os itens (grade jsonb de cada produto) e usa o MESMO
  // construtor do Sheet — uma matriz por produto + o total do pedido.
  const montarDocModeloImp = async (ocId: string): Promise<OcDocModelo> => {
    const [dados, tamanhos, grupos] = await Promise.all([
      lerOcComItens(ocId),
      buscarTamanhosLoja(),
      supabase.from("grupos_produto").select("id, nome").then(({ data, error }) => { if (error) throw error; return (data ?? []) as { id: string; nome: string }[]; }),
    ]);
    if (!dados) throw new Error("OC não encontrada.");
    const o = dados.oc;
    const empresa = o.empresa_id ? empresas.find((e) => e.id === o.empresa_id) : null;
    const rep = empresa?.representantes?.find((r) => r.id === o.representante_id)?.nome ?? null;
    return montarDocModeloOcImp({
      numero: o.numero ?? null,
      cabecalho: {
        data_pedido: o.data_pedido ?? "", data_prevista: o.data_prevista ?? "",
        moeda_compra: o.moeda_compra ?? "RMB", moeda_intermediaria: o.moeda_intermediaria ?? null,
      },
      landedUnitarioOc: Number(o.custo_unitario_landed_real ?? 0),
      empresaNome: empresa?.nome_fantasia ?? null,
      representanteNome: rep,
      itens: dados.itens,
      tamanhos,
      grupoNome: (id) => grupos.find((g) => g.id === id)?.nome ?? null,
      corNome: (id) => (coresDoc as any).base?.[id ?? ""] ?? null,
      apelidoNome: (id) => (coresDoc as any).apel?.[id ?? ""] ?? null,
      emitidoEm: fmtDate(new Date().toISOString()),
    });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // RPC (não .delete() cru): excluir_oc_importado recusa (P0001) OC com QUALQUER produto recebido (materializou cad/CQ) ou com parcela
      // paga — a guarda do botão (desabilitado) é só a primeira camada, redundante de propósito; a real é no servidor.
      const { error } = await supabase.rpc("excluir_oc_importado" as any, { _oc_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
      qc.invalidateQueries({ queryKey: ["produtos-importados"] }); // os produtos da OC voltam a ficar sem OC (chip do card)
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });
  const pedirExcluir = (oc: OcImportadoRow) =>
    pedirConfirmacao({ ...textoExcluirOc(), onConfirmar: () => deleteMutation.mutate(oc.id) });

  // Módulo Produto Importado: guardado pelo `RequirePermission` (PageDef.gate) — a tela só monta com o módulo ligado.
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ShoppingCart className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight truncate">OC P. Importado</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de produto importado (exterior).</p>
          </div>
        </div>
        <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Pedido
        </Button>
      </header>

      {/* Ordem Recebidas · Encomendadas · Estoque — espelha a OC P. Acabado. OC PARCIALMENTE recebida (alguns produtos recebidos, outros
          não) continua em Encomendadas até o último produto chegar. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as OcImportadoTab)}>
        <TabsList>
          <TabsTrigger value="recebido">Recebidas{tabCounts ? ` ${tabCounts.recebido}` : ""}</TabsTrigger>
          <TabsTrigger value="encomendado" className="relative">
            Encomendadas{tabCounts ? ` ${tabCounts.encomendado}` : ""}
            <AtrasadasBadge chave="oc_importado_atrasada" />
          </TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
        </TabsList>

        <TabsContent value="recebido" className="mt-4">
          <OcImpListaTable
            ocs={ocs}
            empresaMap={empresaMap}
            isLoading={isLoading}
            emptyLabel="Nenhuma OC recebida."
            status="recebido"
            dataCol={{ label: "Data Entrega", get: (o) => fmtDate(o.data_entrega) }}
            onRowClick={(id) => { setEditingId(id); setOpenDialog(true); }}
            montarDocModelo={montarDocModeloImp}
          />
        </TabsContent>

        <TabsContent value="encomendado" className="mt-4">
          <OcImpListaTable
            ocs={ocs}
            empresaMap={empresaMap}
            isLoading={isLoading}
            emptyLabel="Nenhuma OC encomendada."
            status="encomendado"
            dataCol={{ label: "Data Prevista", get: (o) => fmtDate(o.data_prevista) }}
            onRowClick={(id) => { setEditingId(id); setOpenDialog(true); }}
            montarDocModelo={montarDocModeloImp}
            onDelete={pedirExcluir}
          />
        </TabsContent>

        <TabsContent value="estoque" className="mt-4">
          <EstoqueImpTable />
        </TabsContent>
      </Tabs>

      {openDialog && (
        <OcImpDialog
          ocId={editingId}
          empresas={empresas}
          onClose={() => {
            setOpenDialog(false);
            setEditingId(null);
            if (search.oc) navigate({ search: (prev) => ({ ...prev, oc: undefined }), replace: true, resetScroll: false });
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ocs_importado"] })}
          onDelete={(oc) => {
            setOpenDialog(false);
            setEditingId(null);
            if (search.oc) navigate({ search: (prev) => ({ ...prev, oc: undefined }), replace: true, resetScroll: false });
            pedirExcluir(oc);
          }}
        />
      )}

      {dialogConfirmacao}

      <MobileActionBar>
        <Button className="ml-auto" onClick={() => { setEditingId(null); setOpenDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Pedido
        </Button>
      </MobileActionBar>
    </div>
  );
}

// ── Lista (Encomendadas/Recebidas) — mobile cards + tabela desktop ──
function OcImpListaTable({
  ocs, empresaMap, isLoading, emptyLabel, status, dataCol, onRowClick, onDelete, montarDocModelo,
}: {
  ocs: OcImportadoRow[];
  empresaMap: Record<string, string>;
  isLoading: boolean;
  emptyLabel: string;
  // Status da ABA (não da linha) — alimenta o chip de prazo (`OcPrazoBadge`).
  status: OcImportadoStatus;
  dataCol: { label: string; get: (o: OcImportadoRow) => string };
  onRowClick: (id: string) => void;
  onDelete?: (o: OcImportadoRow) => void;
  montarDocModelo?: (ocId: string) => Promise<OcDocModelo>;
}) {
  // "Vestido Midi +2" + (OC parcialmente recebida) "1 de 3 produtos recebidos".
  const celulaProdutos = (o: OcImportadoRow) => {
    const { recebidos, total } = contarRecebidos(o.itens ?? []);
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="neutral" className="normal-case tracking-normal">{produtosTexto(total)}</StatusBadge>
          <span className="truncate text-sm text-muted-foreground" title={textoProdutosDaOc(o.itens ?? [])}>{textoProdutosDaOc(o.itens ?? [])}</span>
        </div>
        {status === "encomendado" && recebidos > 0 && <div className="mt-0.5 text-xs text-muted-foreground">{textoRecebidos(recebidos, total)}</div>}
      </div>
    );
  };
  // O total da OC é a soma dos itens em M1 — a moeda DA COMPRA (não BRL).
  const valorOc = (o: OcImportadoRow) => fmtMoeda(o.valor_total_desconto, o.moeda_compra);
  const botaoExcluir = (o: OcImportadoRow) => {
    if (!onDelete) return null;
    const motivo = motivoNaoExcluirOc(o.itens ?? []);
    return (
      <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label="Excluir OC"
        disabled={!!motivo} title={motivo ?? "Excluir OC"}
        onClick={(e) => { e.stopPropagation(); onDelete(o); }}>
        <Trash2 className="h-4 w-4" />
      </Button>
    );
  };
  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-2 sm:hidden">
        {!isLoading && ocs.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">{emptyLabel}</Card>
        )}
        {ocs.map((o) => (
          <Card key={o.id} className="p-3 cursor-pointer active:bg-muted/50" onClick={() => onRowClick(o.id)}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{o.numero ?? "—"}</span>
                <OcPrazoBadge dataPrevista={o.data_prevista} dataEntrega={o.data_entrega} status={status} />
              </div>
              <div className="mt-0.5">{celulaProdutos(o)}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {dataCol.label} {dataCol.get(o)} · {valorOc(o)}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Desktop: tabela */}
      <Card className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Produtos</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>{dataCol.label}</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && ocs.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{emptyLabel}</TableCell></TableRow>
            )}
            {ocs.map((o) => (
              <TableRow key={o.id} className="cursor-pointer" onClick={() => onRowClick(o.id)}>
                <TableCell className="font-medium">{o.numero ?? "—"}</TableCell>
                <TableCell className="max-w-[18rem]">{celulaProdutos(o)}</TableCell>
                <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                <TableCell>{dataCol.get(o)}</TableCell>
                <TableCell><OcPrazoBadge dataPrevista={o.data_prevista} dataEntrega={o.data_entrega} status={status} /></TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{valorOc(o)}</TableCell>
                <TableCell className="w-16 py-0 text-right">
                  <div className="flex items-center justify-end">
                  {montarDocModelo && <OcImprimirLinhaButton ocId={o.id} montarModelo={montarDocModelo} />}
                  {botaoExcluir(o)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

// ── Estoque (RPC estoque_p_importado) — produto × variante × real/direcionado/em mãos.
// Espelha EstoquePaTable (revenda): a RPC lê o derivado JÁ materializado (`cad_grades.
// grade_total_real`, gravado por `receber_oc_importado`) e desconta o direcionamento
// (`direcionamento_lojas`, mesma tabela da revenda). em_maos = real − direcionado. ──
function EstoqueImpTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["estoque_p_importado"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_p_importado" as any);
      if (error) throw error;
      return (data ?? {}) as Record<string, Record<string, { real: number; direcionado: number; em_maos: number }>>;
    },
  });
  const produtoIds = useMemo(() => Object.keys(data ?? {}), [data]);
  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-importados-estoque", produtoIds],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_importados" as any).select("id, nome, ref").in("id", produtoIds);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string; ref: string | null }[];
    },
  });
  const { data: variantes = [] } = useQuery({
    queryKey: ["produto-importado-variantes-estoque", produtoIds],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produto_importado_variantes" as any)
        .select("produto_importado_id, ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("produto_importado_id", produtoIds);
      if (error) throw error;
      return (data ?? []) as unknown as { produto_importado_id: string; ordem: number; cor: { nome: string | null } | null; apelido: { nome: string | null } | null }[];
    },
  });
  const produtoMap = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos]);
  const varianteMap = useMemo(
    () => Object.fromEntries(variantes.map((v) => [`${v.produto_importado_id}:${v.ordem}`, v])),
    [variantes],
  );

  const rows = useMemo(() => {
    const out: { produtoId: string; produtoNome: string; ref: string | null; variante: string; real: number; direcionado: number; emMaos: number }[] = [];
    for (const [produtoId, porVariante] of Object.entries(data ?? {})) {
      const produto = produtoMap[produtoId];
      for (const [numero, v] of Object.entries(porVariante)) {
        const info = varianteMap[`${produtoId}:${numero}`];
        out.push({
          produtoId, produtoNome: produto?.nome ?? "—", ref: produto?.ref ?? null,
          variante: `${numero} · ${varianteLabel({ cor: info?.cor?.nome, apelido: info?.apelido?.nome })}`,
          real: v.real, direcionado: v.direcionado, emMaos: v.em_maos,
        });
      }
    }
    return out.sort((a, b) => a.produtoNome.localeCompare(b.produtoNome, "pt-BR"));
  }, [data, produtoMap, varianteMap]);

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead>Variante</TableHead>
            <TableHead className="text-right">Real</TableHead>
            <TableHead className="text-right">Direcionado</TableHead>
            <TableHead className="text-right">Em mãos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!isLoading && rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum produto recebido ainda.</TableCell></TableRow>
          )}
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="font-medium">{r.produtoNome}{r.ref ? <span className="text-muted-foreground"> · {r.ref}</span> : null}</TableCell>
              <TableCell>{r.variante}</TableCell>
              <TableCell className="text-right tabular-nums">{r.real}</TableCell>
              <TableCell className="text-right tabular-nums">{r.direcionado}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{r.emMaos}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
