import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus, Trash2 } from "lucide-react";
import { OcDocumentoPrint, type OcDocModelo } from "@/components/shared/OcDocumentoPrint";
import { OcImprimirLinhaButton } from "@/components/shared/OcImprimirLinhaButton";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { faltaNotaEntrada } from "@/lib/nota-entrada";
import { BolinhaFaltaNota } from "@/components/shared/NotaEntrada";
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
import { contarRecebidos, motivoNaoExcluirOc, produtosTexto, textoProdutosDaOc, textoRecebidos } from "@/lib/oc-multi-itens";
import { textoExcluirOc } from "@/lib/confirmacoes-textos";
import { OcPaDialog } from "@/components/oc-p-acabado/OcPaDialog";
import { montarDocModeloOcPa } from "@/components/oc-p-acabado/doc-modelo";
import { buscarTamanhosLoja, lerOcComItens } from "@/components/oc-p-acabado/queries";
import { fmtMoney, fmtDate, type OcPaRow, type OcPaTab, type OcPaStatus } from "@/components/oc-p-acabado/shared";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-p-acabado")({
  validateSearch: (s: Record<string, unknown>): { tab?: OcPaTab; oc?: string } => ({
    tab: s.tab === "encomendado" || s.tab === "recebido" || s.tab === "estoque" ? (s.tab as OcPaTab) : undefined,
    // `?oc=<id>` abre a OC direto (deep-link) — usado por "Fazer pedido"/"⧉" do planejador
    // Produto Acabado (Task 6, revenda), que cria/aponta pra uma OC específica.
    oc: typeof s.oc === "string" && s.oc ? s.oc : undefined,
  }),
  // O gate de módulo (PageDef.gate = produto_acabado) é aplicado pelo `RequirePermission` (rota guardada, com `pronto`), pela
  // SIDEBAR/HUB e pelas RPCs (`tenant_module_enabled`) — [modularidade F1] a corrida da URL direta (isLoading `false` antes do
  // tenantId resolver) acabou.
  component: () => (
    <RequirePermission page="entrada_oc_p_acabado">
      <OcPaPage />
    </RequirePermission>
  ),
});

// Lista (abas): o produto saiu do cabeçalho (R13) — a coluna "Produtos" vem do embed dos ITENS.
const SELECT_LISTA =
  "id, numero, empresa_id, data_pedido, data_prevista, data_entrega, data_nota_entrada, qtd_total, valor_total_desconto, status, " +
  "itens:ocs_p_acabado_itens(id, ordem, nome_produto, status)";

function OcPaPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  // Item 5 (refino onda 2): default "recebido" — espelha OC Aviamento/OC Insumo; a ordem das abas é Recebidas · Encomendadas · Estoque.
  const [tab, setTab] = useState<OcPaTab>(search.tab ?? "recebido");
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { pedir: pedirConfirmacao, dialog: dialogConfirmacao } = useConfirmacao();
  // Deep-link `?oc=<id>` — abre a OC direto uma vez ao montar (ver Route.validateSearch acima).
  const deepLinkAbertoRef = useRef(false);
  useEffect(() => {
    if (search.oc && !deepLinkAbertoRef.current) {
      deepLinkAbertoRef.current = true;
      setEditingId(search.oc);
      setOpenDialog(true);
    }
  }, [search.oc]);

  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ["ocs_p_acabado", tab],
    enabled: tab !== "estoque",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_p_acabado" as any)
        .select(SELECT_LISTA)
        .eq("status", tab as OcPaStatus)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OcPaRow[];
    },
  });

  const { data: tabCounts } = useQuery({
    queryKey: ["ocs_p_acabado", "tab-counts"],
    queryFn: async () => {
      const [enc, rec] = await Promise.all([
        supabase.from("ocs_p_acabado" as any).select("id", { count: "exact", head: true }).eq("status", "encomendado"),
        supabase.from("ocs_p_acabado" as any).select("id", { count: "exact", head: true }).eq("status", "recebido"),
      ]);
      return { encomendado: enc.count ?? 0, recebido: rec.count ?? 0 };
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "produto-acabado"],
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
    queryKey: ["oc-pa-cores-doc"],
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

  // Monta o documento imprimível de UMA OC de produto acabado: relê a OC COM os itens (grade jsonb de cada produto) e usa o MESMO
  // construtor do Sheet — uma matriz por produto + o total do pedido.
  const montarDocModeloPa = async (ocId: string): Promise<OcDocModelo> => {
    const [dados, tamanhos, grupos] = await Promise.all([
      lerOcComItens(ocId),
      buscarTamanhosLoja(),
      supabase.from("grupos_produto").select("id, nome").then(({ data, error }) => { if (error) throw error; return (data ?? []) as { id: string; nome: string }[]; }),
    ]);
    if (!dados) throw new Error("OC não encontrada.");
    const o = dados.oc;
    const empresa = o.empresa_id ? empresas.find((e) => e.id === o.empresa_id) : null;
    const rep = empresa?.representantes?.find((r) => r.id === o.representante_id)?.nome ?? null;
    return montarDocModeloOcPa({
      numero: o.numero ?? null,
      cabecalho: { data_pedido: o.data_pedido ?? "", data_prevista: o.data_prevista ?? "", prazo_pagamento: o.prazo_pagamento ?? "", parcelas_entrega: o.parcelas_entrega ?? 0 },
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
      // RPC (não .delete() cru): excluir_oc_p_acabado recusa (P0001) OC com QUALQUER produto recebido (materializou cad/CQ) ou com parcela
      // paga — a guarda do botão (desabilitado) é só a primeira camada, redundante de propósito; a real é no servidor.
      const { error } = await supabase.rpc("excluir_oc_p_acabado" as any, { _oc_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] }); // os produtos da OC voltam a ficar sem OC (chip do card)
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });
  const pedirExcluir = (oc: OcPaRow) =>
    pedirConfirmacao({ ...textoExcluirOc(), onConfirmar: () => deleteMutation.mutate(oc.id) });

  // Módulo Produto Acabado: guardado pelo `RequirePermission` (PageDef.gate) — a tela só monta com o módulo ligado.
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ShoppingCart className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight truncate">OC P. Acabado</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de produto acabado (revenda).</p>
          </div>
        </div>
        <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Pedido
        </Button>
      </header>

      {/* Ordem Recebidas · Encomendadas · Estoque (pedido do dono) — espelha OC Aviamento/OC Insumo. OC PARCIALMENTE recebida
          (alguns produtos recebidos, outros não) continua em Encomendadas até o último produto chegar. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as OcPaTab)}>
        <TabsList>
          <TabsTrigger value="recebido">Recebidas{tabCounts ? ` ${tabCounts.recebido}` : ""}</TabsTrigger>
          <TabsTrigger value="encomendado" className="relative">
            Encomendadas{tabCounts ? ` ${tabCounts.encomendado}` : ""}
            <AtrasadasBadge chave="oc_p_acabado_atrasada" />
          </TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
        </TabsList>

        <TabsContent value="recebido" className="mt-4">
          <OcPaListaTable
            ocs={ocs}
            empresaMap={empresaMap}
            isLoading={isLoading}
            emptyLabel="Nenhuma OC recebida."
            status="recebido"
            dataCol={{ label: "Data Entrega", get: (o) => fmtDate(o.data_entrega) }}
            onRowClick={(id) => { setEditingId(id); setOpenDialog(true); }}
            montarDocModelo={montarDocModeloPa}
          />
        </TabsContent>

        <TabsContent value="encomendado" className="mt-4">
          <OcPaListaTable
            ocs={ocs}
            empresaMap={empresaMap}
            isLoading={isLoading}
            emptyLabel="Nenhuma OC encomendada."
            status="encomendado"
            dataCol={{ label: "Data Prevista", get: (o) => fmtDate(o.data_prevista) }}
            onRowClick={(id) => { setEditingId(id); setOpenDialog(true); }}
            montarDocModelo={montarDocModeloPa}
            onDelete={pedirExcluir}
          />
        </TabsContent>

        <TabsContent value="estoque" className="mt-4">
          <EstoquePaTable />
        </TabsContent>
      </Tabs>

      {openDialog && (
        <OcPaDialog
          ocId={editingId}
          empresas={empresas}
          onClose={() => {
            setOpenDialog(false);
            setEditingId(null);
            // Deep-link `?oc=<id>` consumido (FF4): limpa da URL ao fechar — senão um F5/"voltar" do browser reabre a mesma OC sozinha.
            if (search.oc) navigate({ search: (prev) => ({ ...prev, oc: undefined }), replace: true, resetScroll: false });
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] })}
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
function OcPaListaTable({
  ocs, empresaMap, isLoading, emptyLabel, status, dataCol, onRowClick, onDelete, montarDocModelo,
}: {
  ocs: OcPaRow[];
  empresaMap: Record<string, string>;
  isLoading: boolean;
  emptyLabel: string;
  // Status da ABA (não da linha) — alimenta o chip de prazo (`OcPrazoBadge`, compartilhado por OC Tecido/Aviamento/Insumo):
  // atrasada (encomendado + hoje > prevista) / adiantada (recebido + entrega < prevista) / no prazo.
  status: OcPaStatus;
  dataCol: { label: string; get: (o: OcPaRow) => string };
  onRowClick: (id: string) => void;
  onDelete?: (o: OcPaRow) => void;
  montarDocModelo?: (ocId: string) => Promise<OcDocModelo>;
}) {
  // "Vestido Midi +2" + (OC parcialmente recebida) "1 de 3 produtos recebidos".
  const celulaProdutos = (o: OcPaRow) => {
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
  const botaoExcluir = (o: OcPaRow) => {
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
                <span className="font-medium">{o.numero ?? "—"}</span><BolinhaFaltaNota show={faltaNotaEntrada("p_acabado", o)} />
                <OcPrazoBadge dataPrevista={o.data_prevista} dataEntrega={o.data_entrega} status={status} />
              </div>
              <div className="mt-0.5">{celulaProdutos(o)}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {dataCol.label} {dataCol.get(o)} · {fmtMoney(o.valor_total_desconto)}
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
                <TableCell className="font-medium"><span className="inline-flex items-center gap-2">{o.numero ?? "—"}<BolinhaFaltaNota show={faltaNotaEntrada("p_acabado", o)} /></span></TableCell>
                <TableCell className="max-w-[18rem]">{celulaProdutos(o)}</TableCell>
                <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                <TableCell>{dataCol.get(o)}</TableCell>
                <TableCell><OcPrazoBadge dataPrevista={o.data_prevista} dataEntrega={o.data_entrega} status={status} /></TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtMoney(o.valor_total_desconto)}</TableCell>
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

// ── Estoque (estoque_p_acabado RPC) — produto × variante × real/direcionado/em mãos ──
function EstoquePaTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["estoque_p_acabado"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_p_acabado" as any);
      if (error) throw error;
      return (data ?? {}) as Record<string, Record<string, { real: number; direcionado: number; em_maos: number }>>;
    },
  });
  const produtoIds = useMemo(() => Object.keys(data ?? {}), [data]);

  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-acabados-estoque", produtoIds],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_acabados" as any).select("id, nome, ref").in("id", produtoIds);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string; ref: string | null }[];
    },
  });
  const { data: variantes = [] } = useQuery({
    queryKey: ["produto-acabado-variantes-estoque", produtoIds],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produto_acabado_variantes" as any)
        .select("produto_acabado_id, ordem, cor_id, cor_apelido_id, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("produto_acabado_id", produtoIds);
      if (error) throw error;
      return (data ?? []) as unknown as { produto_acabado_id: string; ordem: number; cor?: { nome: string | null } | null; apelido?: { nome: string | null } | null }[];
    },
  });
  const produtoMap = useMemo(() => Object.fromEntries(produtos.map((p) => [p.id, p])), [produtos]);
  const varianteMap = useMemo(() => {
    const m: Record<string, { produto_acabado_id: string; ordem: number; cor?: { nome: string | null } | null; apelido?: { nome: string | null } | null }> = {};
    for (const v of variantes) m[`${v.produto_acabado_id}:${v.ordem}`] = v;
    return m;
  }, [variantes]);

  const rows = useMemo(() => {
    const out: { produtoId: string; produtoNome: string; ref: string | null; variante: string; real: number; direcionado: number; emMaos: number }[] = [];
    for (const [produtoId, porVariante] of Object.entries(data ?? {})) {
      const produto = produtoMap[produtoId];
      for (const [numero, v] of Object.entries(porVariante)) {
        const info = varianteMap[`${produtoId}:${numero}`];
        out.push({
          produtoId,
          produtoNome: produto?.nome ?? "—",
          ref: produto?.ref ?? null,
          variante: `${numero} · ${varianteLabel({ cor: info?.cor?.nome, apelido: info?.apelido?.nome })}`,
          real: v.real,
          direcionado: v.direcionado,
          emMaos: v.em_maos,
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
