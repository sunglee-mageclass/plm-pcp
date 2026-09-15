import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus, ArrowLeft, Trash2, Check, Printer } from "lucide-react";
import { printWithImages } from "@/lib/print";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { OcModalShell } from "@/components/shared/OcModalShell";
import { OcAnchorRail, type SecaoOc } from "@/components/shared/OcAnchorRail";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { mergeGradeGenerico, type GradeGenerica } from "@/lib/colab/merge-grade-generico";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useTenantModules } from "@/hooks/useTenantModules";
import { varianteLabel } from "@/lib/variante";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { fmtMoeda, custoLanded, type EntradaLanded, type EtapaPagamento } from "@/lib/moeda";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { OcImpForm, type Opt, type CatOpt, type SubOpt, type CorApelidoOpt, type ProdutoVinculadoInfo } from "@/components/oc-p-importado/OcImpForm";
import { OcImpRecebimento, type ColaboradorOpt } from "@/components/oc-p-importado/OcImpRecebimento";
import {
  emptyDraft, fmtMoney, fmtDate, uploadFile, DEFAULT_TAMANHOS, TAM_ACESSORIO,
  type Draft, type GradeDetalhe, type CelulaGrade, type OcImportadoRow, type OcImportadoTab, type OcImportadoStatus,
} from "@/components/oc-p-importado/shared";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";

// Campos da célula da grade `grade_detalhe` (mesma da OC P.Acabado). Parametrizam o
// mergeGradeGenerico (o mergeGrade do CQ é hard-coded aos 4 campos dele).
const CAMPOS_GRADE_PA = ["pedida", "recebida", "defeito"] as const;

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

function OcImpPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const { isModuleEnabled, isLoading: modulesLoading } = useTenantModules();
  const [tab, setTab] = useState<OcImportadoTab>(search.tab ?? "recebido");
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OcImportadoRow | null>(null);
  // Deep-link `?oc=<id>` — abre a OC direto ao montar.
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
        .select("id, numero, nome_produto, produto_importado_id, empresa_id, data_pedido, data_prevista, data_entrega, qtd_total, valor_total_desconto, status")
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

  // Monta o documento imprimível de UMA OC de produto importado (busca a OC completa — grade jsonb).
  const montarDocModeloImp = async (ocId: string): Promise<OcDocModelo> => {
    const { data: oc, error } = await supabase.from("ocs_importado" as any).select("*, grupo:grupo_id(nome)").eq("id", ocId).maybeSingle();
    if (error) throw error;
    const o = oc as any;
    const acessorioP = ehGrupoAcessorio(o?.grupo?.nome ?? null);
    const tams: string[] = acessorioP ? [TAM_ACESSORIO] : DEFAULT_TAMANHOS;
    const variantes = (o?.variantes ?? []) as { ordem: number; cor_id: string | null; cor_apelido_id: string | null }[];
    const gradeD = (o?.grade_detalhe ?? {}) as Record<string, Record<string, { pedida?: number }>>;
    const linhas = variantes.map((v) => {
      const g = gradeD[String(v.ordem)] ?? {};
      const celulas: Record<string, React.ReactNode> = {};
      let totalLin = 0;
      for (const t of tams) { const ped = Number(g[t]?.pedida ?? 0); celulas[t] = ped || "—"; totalLin += ped; }
      const nome = varianteLabel({ cor: (coresDoc as any).base?.[v.cor_id ?? ""] ?? null, apelido: (coresDoc as any).apel?.[v.cor_apelido_id ?? ""] ?? null });
      return { cor: nome || `Variante ${v.ordem}`, celulas, total: totalLin };
    });
    const totalPorTamanho: Record<string, React.ReactNode> = {};
    let geral = 0;
    for (const t of tams) { let s = 0; for (const v of variantes) s += Number(gradeD[String(v.ordem)]?.[t]?.pedida ?? 0); totalPorTamanho[t] = s; geral += s; }
    const proporcao: Record<string, React.ReactNode> = {};
    const gp = (o?.grade_proporcao ?? {}) as Record<string, number>;
    for (const t of tams) proporcao[t] = gp[t] ?? "—";
    const empresa = o?.empresa_id ? empresas.find((e) => e.id === o.empresa_id) : null;
    const rep = empresa?.representantes?.find((r) => r.id === o?.representante_id)?.nome ?? null;
    return {
      numero: o?.numero || "—",
      familiaLabel: "Produto Importado",
      emitidoEm: fmtDate(new Date().toISOString()),
      fornecedor: [{ k: "Empresa", v: empresa?.nome_fantasia ?? "—" }, { k: "Representante", v: rep ?? "—" }],
      dados: [
        { k: "Data do pedido", v: o?.data_pedido ? fmtDate(o.data_pedido) : "—" },
        { k: "Entrega prevista", v: o?.data_prevista ? fmtDate(o.data_prevista) : "—" },
        { k: "Custo landed unit.", v: fmtMoeda(Number(o?.custo_unitario_landed_real ?? 0), "BRL") },
      ],
      grade: {
        produtoTitulo: `Produto: ${o?.nome_produto || "—"}${o?.numero ? ` (REF ${o.numero})` : ""}`,
        tamanhos: tams, proporcao, linhas, totalPorTamanho, totalGeral: geral,
        valores: [{ descricao: o?.nome_produto || "Produto — todas as cores/tamanhos", qtd: `${geral} pç`, precoUnit: fmtMoeda(Number(o?.valor_unitario_real ?? 0), "BRL"), subtotal: fmtMoeda(Number(o?.valor_total_desconto ?? 0), "BRL") }],
      },
      totalPrevisto: fmtMoeda(Number(o?.valor_total_desconto ?? 0), "BRL"),
    };
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // RPC (não .delete() cru): excluir_oc_importado bloqueia (P0001) OC já recebida
      // (materializou cad/CQ) ou com parcela paga — espelha excluir_oc_p_acabado.
      const { error } = await supabase.rpc("excluir_oc_importado" as any, { _oc_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  if (modulesLoading) return null; // evita flash de conteúdo antes de carregar a config (padrão ModuleGuard)
  if (!isModuleEnabled("produto_importado")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <ShoppingCart className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Produto Importado desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em <Link to="/admin/configuracoes" className="underline underline-offset-2">Config da Loja</Link> para usar OC P. Importado.
        </p>
      </div>
    );
  }

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
            onDelete={(o) => setDeleting(o)}
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
            setDeleting(oc);
            if (search.oc) navigate({ search: (prev) => ({ ...prev, oc: undefined }), replace: true, resetScroll: false });
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir OC?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A OC "{deleting?.numero || deleting?.nome_produto || "sem número"}" será removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  status: OcImportadoStatus;
  dataCol: { label: string; get: (o: OcImportadoRow) => string };
  onRowClick: (id: string) => void;
  onDelete?: (o: OcImportadoRow) => void;
  montarDocModelo?: (ocId: string) => Promise<OcDocModelo>;
}) {
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
              <div className="text-sm text-muted-foreground truncate mt-0.5">{o.nome_produto}</div>
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
              <TableHead>Produto</TableHead>
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
                <TableCell className="max-w-[16rem] truncate" title={o.nome_produto}>{o.nome_produto}</TableCell>
                <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                <TableCell>{dataCol.get(o)}</TableCell>
                <TableCell><OcPrazoBadge dataPrevista={o.data_prevista} dataEntrega={o.data_entrega} status={status} /></TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{fmtMoney(o.valor_total_desconto)}</TableCell>
                <TableCell className="w-16 py-0 text-right">
                  <div className="flex items-center justify-end">
                  {montarDocModelo && <OcImprimirLinhaButton ocId={o.id} montarModelo={montarDocModelo} />}
                  {onDelete && (
                    <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(o); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
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

// ── Sheet/Dialog de edição/criação (OcModalShell — editar=Sheet 70vw, novo=Dialog) ──
function draftFromOc(oc: any): Draft {
  return {
    numero: oc.numero ?? "",
    nome_produto: oc.nome_produto ?? "",
    produto_importado_id: oc.produto_importado_id ?? null,
    grupo_id: oc.grupo_id ?? null,
    categoria_id: oc.categoria_id ?? null,
    subcategoria1_id: oc.subcategoria1_id ?? null,
    subcategoria2_id: oc.subcategoria2_id ?? null,
    empresa_id: oc.empresa_id ?? null,
    representante_id: oc.representante_id ?? null,
    ref_fornecedor: oc.ref_fornecedor ?? "",
    composicao: oc.composicao ?? "",
    data_pedido: oc.data_pedido ?? "",
    data_prevista: oc.data_prevista ?? "",
    grade_proporcao: oc.grade_proporcao ?? {},
    variantes: Array.isArray(oc.variantes) ? oc.variantes : [],
    qtd_total: oc.qtd_total ?? 0,
    moeda_compra: oc.moeda_compra ?? "RMB",
    moeda_intermediaria: oc.moeda_intermediaria ?? null,
    valor_unitario_m1: Number(oc.valor_unitario_m1 ?? 0),
    cotacao_ref: Number(oc.cotacao_ref ?? 0),
    peso_kg: Number(oc.peso_kg ?? 0),
    transporte_m2: Number(oc.transporte_m2 ?? 0),
    desconto_pct: Number(oc.desconto_pct ?? 0),
    cotacao_final: Number(oc.cotacao_final ?? 0),
    etapas: [],
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
    responsavel_recebimento_id: oc.responsavel_recebimento_id ?? null,
    devolucao: oc.devolucao ?? "",
    revisao: oc.revisao ?? "",
    anexo_pedido_url: oc.anexo_pedido_url ?? null,
    anexo_nf_url: oc.anexo_nf_url ?? null,
  };
}

function OcImpDialog({
  ocId, empresas, onClose, onSaved, onDelete,
}: {
  ocId: string | null;
  empresas: { id: string; nome_fantasia: string; representantes: { id: string; nome: string | null }[] }[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (oc: OcImportadoRow) => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [campoFocadoColab, setCampoFocadoColab] = useState<string | null>(null);
  const colabScopeRef = useRef<HTMLDivElement>(null);
  const [draft, setDraftRaw] = useState<Draft>(emptyDraft());
  const [grade, setGradeRaw] = useState<GradeDetalhe>({});
  const [status, setStatus] = useState<OcImportadoStatus>("encomendado");
  const [numeroReal, setNumeroReal] = useState<string | null>(null);
  const [secAtiva, setSecAtiva] = useState("ocimp-sec-pedido");
  const [confirmReceber, setConfirmReceber] = useState(false);

  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, grade });

  // ── Colaboração em tempo real (merge de AGREGADO + GRADE) — gêmeo da OC P.Acabado ────────────
  // Cabeçalho escalar funde por `mergeDraft` (as ETAPAS de pagamento entram como array GRÃO-GROSSO
  // dentro do draft: conflito = "o cronograma inteiro divergiu", resolução all-or-nothing — elas
  // não têm chave estável, o servidor faz delete+reinsert). A grade jsonb NA RAIZ funde POR CÉLULA
  // por `mergeGradeGenerico`. base = último visto do servidor · touched(Ref/GradeRef) = o que EU
  // editei · revRef = rev da OC · conflitos barram Salvar/Receber.
  const touchedRef = useRef<Set<string>>(new Set());
  const touchedGradeRef = useRef<Set<string>>(new Set());
  const baseRef = useRef<{ draft: Draft; grade: GradeDetalhe } | null>(null);
  const revRef = useRef<number | null>(null);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  // Espelhos SEMPRE atualizados p/ o merge no onError do save (roda após await; a closure
  // descartaria teclas digitadas na janela). Espelha OC P.Acabado.
  const draftLiveRef = useRef(draft); draftLiveRef.current = draft;
  const gradeLiveRef = useRef(grade); gradeLiveRef.current = grade;

  // setDraft rastreado: difere prev→next e marca o campo tocado. `etapas` (array) é tratado como
  // um único campo grão-grosso — qualquer mudança no cronograma marca `etapas` como tocado.
  const setDraft: typeof setDraftRaw = (upd) =>
    setDraftRaw((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Draft) => Draft)(prev) : upd;
      for (const k of Object.keys(next) as (keyof Draft)[])
        if (next[k] !== prev[k]) touchedRef.current.add(String(k));
      return next;
    });

  // setGrade rastreado: difere célula a célula (por ordem×tam×campo) e marca o path tocado ANTES de
  // aplicar (path `grade:${ordem}:${tam}:${campo}` — MESMA ordem que o mergeGradeGenerico usa).
  const CAMPOS_CEL: (keyof CelulaGrade)[] = ["pedida", "recebida", "defeito"];
  const setGrade: typeof setGradeRaw = (upd) =>
    setGradeRaw((prev) => {
      const next = typeof upd === "function" ? (upd as (p: GradeDetalhe) => GradeDetalhe)(prev) : upd;
      const ordens = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
      for (const ordem of ordens) {
        const tams = new Set<string>([...Object.keys(prev[ordem] ?? {}), ...Object.keys(next[ordem] ?? {})]);
        for (const tam of tams) {
          for (const campo of CAMPOS_CEL) {
            const a = Number(prev[ordem]?.[tam]?.[campo] ?? 0);
            const b = Number(next[ordem]?.[tam]?.[campo] ?? 0);
            if (a !== b) touchedGradeRef.current.add(`grade:${ordem}:${tam}:${campo}`);
          }
        }
      }
      return next;
    });

  const { presentes: presentesColab } = useColabRegistro({
    canal: ocId ? `colab:oc-imp:${ocId}` : null,
    tabela: "ocs_importado",
    registroId: ocId ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["oc-importado", ocId] }),
    campoFocado: campoFocadoColab,
  });

  // ── Opções (taxonomia, cores, tamanhos, colaboradores) ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id");
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id");
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id");
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id");
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-todos-ocimp"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as ColaboradorOpt[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-ocimp"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_user_tenant_id" as any);
      if (!data) return DEFAULT_TAMANHOS;
      const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
      const raw = (cfg as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });

  const grupoNomeAtual = (grupos as Opt[]).find((g) => g.id === draft.grupo_id)?.nome ?? "";
  const acessorioAtual = ehGrupoAcessorio(grupoNomeAtual);
  const tamanhosAtivos = acessorioAtual ? [TAM_ACESSORIO] : tamanhos;

  // A query só BUSCA (retorna a OC crua + etapas embed); o seed/merge acontece no useEffect abaixo
  // (padrão OC P.Acabado) — assim um refetch alheio (Realtime) faz MERGE em vez de sobrescrever.
  const { data: ocQueryData } = useQuery({
    queryKey: ["oc-importado", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ocs_importado" as any).select("*, etapas:ocs_importado_etapas(*)").eq("id", ocId!).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Monta o draft COMPLETO (cabeçalho + etapas ordenadas do embed) a partir da OC crua. As etapas
  // entram no draft como array — o mergeDraft as compara por valor (grão-grosso).
  const draftCompletoFromOc = (oc: any): Draft => {
    const d = draftFromOc(oc);
    d.etapas = Array.isArray(oc.etapas)
      ? [...oc.etapas].sort((a: any, b: any) => a.ordem - b.ordem).map((e: any) => ({
          ordem: e.ordem, rotulo: e.rotulo ?? "", base: e.base, percentual: Number(e.percentual) || 0,
          data_vencimento: e.data_vencimento ?? null, cotacao: Number(e.cotacao) || 0,
        }))
      : [];
    return d;
  };

  // Seed (1ª carga) OU merge combinado (refetch alheio): cabeçalho+etapas por `mergeDraft`, grade
  // por `mergeGradeGenerico`. Espelha o padrão da OC P.Acabado.
  useEffect(() => {
    if (!ocQueryData) return;
    const freshDraft = draftCompletoFromOc(ocQueryData);
    const freshGrade = (ocQueryData.grade_detalhe ?? {}) as GradeDetalhe;
    revRef.current = (ocQueryData as any).rev ?? null;

    if (!baseRef.current) {
      // 1ª carga: seed normal (setters CRUS — não marcar nada como tocado).
      baseRef.current = { draft: freshDraft, grade: freshGrade };
      setDraftRaw(freshDraft);
      setGradeRaw(freshGrade);
      setStatus((ocQueryData.status as OcImportadoStatus) ?? "encomendado");
      setNumeroReal(ocQueryData.numero ?? null);
      touchedRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      resetBaseline({ draft: freshDraft, grade: freshGrade });
      return;
    }

    // Refetch: MERGE em vez de sobrescrever. Cabeçalho+etapas por mergeDraft, grade por célula.
    const md = mergeDraft({ base: baseRef.current.draft, draft, fresh: freshDraft, touched: touchedRef.current });
    const mg = mergeGradeGenerico({ base: baseRef.current.grade as unknown as GradeGenerica, meu: grade as unknown as GradeGenerica, fresh: freshGrade as unknown as GradeGenerica, tocadas: touchedGradeRef.current, campos: CAMPOS_GRADE_PA });
    const semResultado =
      md.atualizados.length === 0 && md.conflitos.length === 0 &&
      mg.atualizados.length === 0 && mg.conflitos.length === 0;
    if (semResultado) {
      // No-op (inclui o refetch que o onError do P0409 já processou): não tocar em nenhum state.
      baseRef.current = { draft: freshDraft, grade: freshGrade };
      return;
    }
    if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraftRaw(md.valor);
    if (mg.atualizados.length > 0 || mg.conflitos.length > 0) setGradeRaw(mg.valor as unknown as GradeDetalhe);
    const todosConflitos = [...md.conflitos, ...mg.conflitos];
    conflitosRef.current = todosConflitos;
    setConflitos(todosConflitos);
    setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todosConflitos });
    baseRef.current = { draft: freshDraft, grade: freshGrade };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocQueryData]);

  const { data: produtoVinculado } = useQuery({
    queryKey: ["produto-importado-vinculado", draft.produto_importado_id],
    enabled: !!draft.produto_importado_id,
    queryFn: async (): Promise<ProdutoVinculadoInfo> => {
      const { data, error } = await supabase
        .from("produtos_importados" as any)
        .select("nome, ref, empresa_id")
        .eq("id", draft.produto_importado_id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const empresaId = (data as any).empresa_id as string | null;
      const fornecedor = empresaId ? empresas.find((e) => e.id === empresaId)?.nome_fantasia ?? null : null;
      return { nome: (data as any).nome, ref: (data as any).ref, fornecedor };
    },
  });

  // Documento imprimível da OC (pedido pro fornecedor) — grade matriz + proporção + valores.
  const docModelo: OcDocModelo = useMemo(() => {
    const acessorioP = ehGrupoAcessorio(grupos.find((g) => g.id === draft.grupo_id)?.nome ?? null);
    const tams = acessorioP ? [TAM_ACESSORIO] : tamanhos;
    const corNomeP = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
    const apelidoNomeP = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;
    const linhas = draft.variantes.map((v) => {
      const g = grade[String(v.ordem)] ?? {};
      const celulas: Record<string, React.ReactNode> = {};
      let totalLin = 0;
      for (const t of tams) { const ped = Number(g[t]?.pedida ?? 0); celulas[t] = ped || "—"; totalLin += ped; }
      return { cor: varianteLabel({ cor: corNomeP(v.cor_id), apelido: apelidoNomeP(v.cor_apelido_id) }) || `Variante ${v.ordem}`, celulas, total: totalLin };
    });
    const totalPorTamanho: Record<string, React.ReactNode> = {};
    let geral = 0;
    for (const t of tams) { let s = 0; for (const v of draft.variantes) s += Number(grade[String(v.ordem)]?.[t]?.pedida ?? 0); totalPorTamanho[t] = s; geral += s; }
    const proporcao: Record<string, React.ReactNode> = {};
    for (const t of tams) proporcao[t] = draft.grade_proporcao[t] ?? "—";
    const etapasLanded: EtapaPagamento[] = draft.etapas.map((e) => ({ base: e.base, percentual: e.percentual, cotacao: e.cotacao }));
    const entradaLanded: EntradaLanded = {
      valorUnitarioM1: draft.valor_unitario_m1,
      qtdTotal: draft.qtd_total,
      freteUnitarioM2: (Number(draft.peso_kg) || 0) * (Number(draft.transporte_m2) || 0),
      descontoPct: draft.desconto_pct,
      etapas: etapasLanded,
      cotacaoFinal: draft.cotacao_final,
    };
    const landed = custoLanded(entradaLanded);
    const empresaSelP = empresas.find((e) => e.id === draft.empresa_id);
    const repNomeP = empresaSelP?.representantes?.find((r) => r.id === draft.representante_id)?.nome ?? null;
    return {
      numero: numeroReal || draft.numero || "—",
      familiaLabel: "Produto Importado",
      emitidoEm: fmtDate(new Date().toISOString()),
      fornecedor: [
        { k: "Empresa", v: empresaSelP?.nome_fantasia ?? "—" },
        { k: "Representante", v: repNomeP ?? "—" },
      ],
      dados: [
        { k: "Data do pedido", v: draft.data_pedido ? fmtDate(draft.data_pedido) : "—" },
        { k: "Entrega prevista", v: draft.data_prevista ? fmtDate(draft.data_prevista) : "—" },
        { k: "Custo landed unit.", v: fmtMoeda(landed.unitarioBrl, "BRL") },
      ],
      grade: {
        produtoTitulo: `Produto: ${draft.nome_produto || produtoVinculado?.nome || "—"}${numeroReal ? ` (REF ${numeroReal})` : ""}`,
        tamanhos: tams,
        proporcao,
        linhas,
        totalPorTamanho,
        totalGeral: geral,
        valores: [{ descricao: draft.nome_produto || "Produto — todas as cores/tamanhos", qtd: `${geral} pç`, precoUnit: fmtMoeda(landed.unitarioBrl, "BRL"), subtotal: fmtMoeda(landed.totalBrl, "BRL") }],
      },
      totalPrevisto: fmtMoeda(landed.totalBrl, "BRL"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, grade, grupos, tamanhos, cores, coresApelido, empresas, produtoVinculado, numeroReal]);

  // ── Resolução de conflito (ColabBanner) ──────────────────────────────────────
  const CAMPO_PT: Record<string, string> = { pedida: "Pedida", recebida: "Recebida", defeito: "Defeito" };
  const ROTULO_CONFLITO_IMP: Record<string, string> = {
    numero: "Número", nome_produto: "Nome do Produto", grupo_id: "Grupo", categoria_id: "Categoria",
    subcategoria1_id: "Subcategoria 1", subcategoria2_id: "Subcategoria 2", empresa_id: "Fornecedor",
    representante_id: "Representante", ref_fornecedor: "Ref. Fornecedor", composicao: "Composição",
    data_pedido: "Data do Pedido", data_prevista: "Data Prevista", grade_proporcao: "Proporção da grade",
    variantes: "Variantes", qtd_total: "Quantidade total", moeda_compra: "Moeda de compra",
    moeda_intermediaria: "Moeda intermediária", valor_unitario_m1: "Valor unitário (M1)",
    cotacao_ref: "Cotação ref.", peso_kg: "Peso (kg)", transporte_m2: "Transporte (m²)",
    desconto_pct: "Desconto (%)", cotacao_final: "Cotação final", etapas: "Etapas de pagamento",
    data_entrega: "Data de Entrega", nota_fiscal: "Nota Fiscal", devolucao: "Devolução",
    revisao: "Revisão", anexo_pedido_url: "Anexo do pedido", anexo_nf_url: "Anexo da NF",
  };
  const rotuloConflito = (path: string) => {
    if (path.startsWith("grade:")) {
      const [, vid, tam, campo] = path.split(":");
      return `${CAMPO_PT[campo] ?? campo} · ${tam} (var ${vid})`;
    }
    return ROTULO_CONFLITO_IMP[path] ?? path;
  };
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitosRef.current.find((x) => x.path === path);
    if (c && escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        setGradeRaw((prev) => {
          const linha = { ...(prev[vid] ?? {}) };
          linha[tam] = { ...(linha[tam] ?? { pedida: 0, recebida: 0, defeito: 0 }), [campo]: Number(c.dele) || 0 };
          return { ...prev, [vid]: linha };
        });
        touchedGradeRef.current.delete(path);
      } else {
        setDraftRaw((d) => ({ ...d, [path]: c.dele as any }));
        touchedRef.current.delete(path);
      }
    }
    conflitosRef.current = conflitosRef.current.filter((x) => x.path !== path);
    setConflitos(conflitosRef.current);
    if (conflitosRef.current.length === 0) setUltimoMerge(null);
  };
  const temConflito = conflitos.length > 0;

  // Reconcilia um P0409 (alguém salvou no meio): recarrega o servidor (com etapas) e funde.
  // Compartilhado pelo save e pelo receber (cujo save intermediário também pode tomar P0409).
  const reconciliarP0409 = async () => {
    toast.warning("Alguém salvou esta OC agora — confira os itens em conflito.");
    const { data: oc } = await supabase.from("ocs_importado" as any).select("*, etapas:ocs_importado_etapas(*)").eq("id", ocId!).maybeSingle();
    if (!oc) return;
    const freshDraft = draftCompletoFromOc(oc);
    const freshGrade = ((oc as any).grade_detalhe ?? {}) as GradeDetalhe;
    const base = baseRef.current ?? { draft: freshDraft, grade: freshGrade };
    const md = mergeDraft({ base: base.draft, draft: draftLiveRef.current, fresh: freshDraft, touched: touchedRef.current });
    const mg = mergeGradeGenerico({ base: base.grade as unknown as GradeGenerica, meu: gradeLiveRef.current as unknown as GradeGenerica, fresh: freshGrade as unknown as GradeGenerica, tocadas: touchedGradeRef.current, campos: CAMPOS_GRADE_PA });
    setDraftRaw(md.valor);
    setGradeRaw(mg.valor as unknown as GradeDetalhe);
    const todos = [...md.conflitos, ...mg.conflitos];
    conflitosRef.current = todos;
    setConflitos(todos);
    setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todos });
    baseRef.current = { draft: freshDraft, grade: freshGrade };
    revRef.current = (oc as any).rev ?? null;
  };

  const handleUpload = async (file: File, key: "anexo_pedido_url" | "anexo_nf_url") => {
    try {
      const path = await uploadFile(file, key);
      setDraft((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) {
      toast.error(mensagemErro(e));
    }
  };

  const montarDados = () => ({
    numero: draft.numero || null,
    nome_produto: draft.nome_produto,
    grupo_id: draft.grupo_id,
    categoria_id: draft.categoria_id,
    subcategoria1_id: draft.subcategoria1_id,
    subcategoria2_id: draft.subcategoria2_id,
    empresa_id: draft.empresa_id,
    representante_id: draft.representante_id,
    ref_fornecedor: draft.ref_fornecedor || null,
    composicao: draft.composicao || null,
    data_pedido: draft.data_pedido || null,
    data_prevista: draft.data_prevista || null,
    grade_proporcao: draft.grade_proporcao,
    variantes: draft.variantes,
    qtd_total: draft.qtd_total,
    moeda_compra: draft.moeda_compra,
    moeda_intermediaria: draft.moeda_intermediaria,
    valor_unitario_m1: draft.valor_unitario_m1,
    cotacao_ref: draft.cotacao_ref,
    peso_kg: draft.peso_kg,
    transporte_m2: draft.transporte_m2,
    desconto_pct: draft.desconto_pct,
    cotacao_final: draft.cotacao_final,
    nota_fiscal: draft.nota_fiscal || null,
    responsavel_recebimento_id: draft.responsavel_recebimento_id,
    devolucao: draft.devolucao || null,
    revisao: draft.revisao || null,
    anexo_pedido_url: draft.anexo_pedido_url,
    anexo_nf_url: draft.anexo_nf_url,
    // produto_importado_id só é aplicado NA CRIAÇÃO pela RPC (update não toca) — espelha
    // o mesmo comportamento de `salvar_oc_p_acabado`.
    produto_importado_id: draft.produto_importado_id,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Guard SÍNCRONO contra salvar com conflito pendente (o disabled do botão é state async).
      if (conflitosRef.current.length > 0)
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de salvar.");
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
      const { data: savedId, error } = await supabase.rpc("salvar_oc_importado" as any, {
        _id: isEdit ? ocId : null,
        _dados: montarDados(),
        _grade: grade,
        _etapas: draft.etapas,
        _rev_base: isEdit ? revRef.current : null, // P0409 se outra pessoa salvou no meio
      });
      if (error) throw error;
      return savedId as string;
    },
    onSuccess: (savedId) => {
      toast.success("OC salva.");
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
      qc.invalidateQueries({ queryKey: ["oc-importado", savedId] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      qc.invalidateQueries({ queryKey: ["produtos-importados"] });
      onSaved();
      onClose();
    },
    onError: async (e: any) => {
      if (e?.code === "P0409") await reconciliarP0409();
      else toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  const receberMutation = useMutation({
    mutationFn: async () => {
      // Guard SÍNCRONO: não receber com conflito pendente (senão o save intermediário sobrescreveria).
      if (conflitosRef.current.length > 0)
        throw erroValidacao("Resolva os conflitos listados no aviso no topo antes de receber.");
      // Recebimento exige a OC já salva (RPC recebe id) — salva primeiro (persiste TODO o
      // rascunho, inclusive edições ainda não gravadas) e então aplica a transição
      // (materializa cad/cad_grades/CQ — espelha receber_oc_p_acabado).
      const { data: savedId, error: saveErr } = await supabase.rpc("salvar_oc_importado" as any, {
        _id: isEdit ? ocId : null,
        _dados: montarDados(),
        _grade: grade,
        _etapas: draft.etapas,
        _rev_base: isEdit ? revRef.current : null,
      });
      if (saveErr) throw saveErr;
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
      qc.invalidateQueries({ queryKey: ["oc-importado", savedId] });
      const { error: recErr } = await supabase.rpc("receber_oc_importado" as any, {
        _oc_id: savedId,
        _dados: {
          data_entrega: draft.data_entrega || null,
          nota_fiscal: draft.nota_fiscal || null,
          responsavel_recebimento_id: draft.responsavel_recebimento_id,
          devolucao: draft.devolucao || null,
          revisao: draft.revisao || null,
        },
        _grade: grade,
      });
      if (recErr) throw recErr;
      return savedId as string;
    },
    onSuccess: (savedId) => {
      toast.success("OC marcada como recebida.");
      setConfirmReceber(false);
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_importado"] });
      qc.invalidateQueries({ queryKey: ["oc-importado", savedId] });
      qc.invalidateQueries({ queryKey: ["estoque_p_importado"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      qc.invalidateQueries({ queryKey: ["produtos-importados"] });
      onSaved();
      onClose();
    },
    onError: async (e: any) => {
      setConfirmReceber(false);
      if (e?.code === "P0409") {
        // P0409 do SAVE intermediário (alguém salvou de verdade no meio): funde + banner.
        await reconciliarP0409();
        return;
      }
      toast.error(mensagemErro(e, "Erro ao marcar recebido"));
      // Save intermediário OK mas a TRANSIÇÃO (receber_oc_importado) falhou → o servidor já bumpou
      // o rev, mas revRef ficou velho. Sem re-baselinar, a próxima tentativa tomaria P0409 espúrio
      // contra o próprio save (achado da revisão adversarial do P.Acabado). Invalida p/ o
      // refetch→useEffect re-baselinar (o guard `semResultado` evita reintroduzir estado velho).
      if (ocId) qc.invalidateQueries({ queryKey: ["oc-importado", ocId] });
    },
  });

  const canMarkReceived = isEdit && status === "encomendado" && !!draft.data_entrega;

  const secoes: SecaoOc[] = [
    { id: "ocimp-sec-pedido", n: 1, label: "Dados do pedido" },
    { id: "ocimp-sec-cambio", n: 2, label: "Moedas & câmbio" },
    { id: "ocimp-sec-grade", n: 3, label: "Grade & variantes" },
    { id: "ocimp-sec-etapas", n: 4, label: "Etapas de pagamento" },
    { id: "ocimp-sec-anexos", n: 5, label: "Anexos" },
    { id: "ocimp-sec-recebimento", n: 6, label: "Recebimento", locked: !isEdit },
  ];
  const irParaSecao = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSecAtiva(id);
  };
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const topo = e.currentTarget.getBoundingClientRect().top;
    let atual = secoes[0]?.id ?? "ocimp-sec-pedido";
    for (const s of secoes) {
      if (s.locked) continue;
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top - topo <= 40) atual = s.id;
    }
    if (atual !== secAtiva) setSecAtiva(atual);
  };

  return (
    <>
      <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de produto importado.">
        <div className="shrink-0 space-y-1">
          <Breadcrumb items={[{ label: "Entrada e Saída" }, { label: "OC P. Importado" }, { label: numeroReal ?? draft.nome_produto ?? "OC" }]} />
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{isEdit ? `OC ${numeroReal ?? ""}` : "Novo Pedido"}</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          {/* Banner de colaboração: presença + "alguém salvou agora" + resolução de conflito. */}
          <ColabBanner
            presentes={presentesColab}
            ultimoMerge={ultimoMerge}
            conflitos={conflitos}
            onResolver={resolverPorPath}
            rotulo={rotuloConflito}
          />
        </div>

        <div className="flex min-h-0 gap-4">
          <OcAnchorRail secoes={secoes} ativa={secAtiva} onIr={irParaSecao} />
          <div
            ref={colabScopeRef}
            className="min-w-0 flex-1 space-y-6 overflow-y-auto"
            onScroll={onBodyScroll}
            onFocusCapture={(e) => {
              const scope = colabScopeRef.current;
              setCampoFocadoColab(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
            }}
            onBlurCapture={() => setCampoFocadoColab(null)}
          >
            <ColabPresenceOverlay presentes={presentesColab} scopeRef={colabScopeRef} />
            <OcImpForm
              draft={draft}
              setDraft={setDraft}
              grade={grade}
              setGrade={setGrade}
              empresas={empresas}
              grupos={grupos as Opt[]}
              categorias={categorias as CatOpt[]}
              subcats1={subcats1 as SubOpt[]}
              subcats2={subcats2 as SubOpt[]}
              cores={cores as Opt[]}
              coresApelido={coresApelido as CorApelidoOpt[]}
              tamanhos={tamanhos}
              produtoVinculado={produtoVinculado ?? null}
              handleUpload={handleUpload}
              isEdit={isEdit}
              // Item 4 (paridade OC P. Acabado): preço congela ao receber — o servidor já
              // rejeita (P0001), isto só evita o usuário digitar pra descobrir na hora do Salvar.
              valoresTravados={status === "recebido"}
            />

            {!isEdit && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                <span>O <b>Recebimento</b> fica disponível depois de salvar a OC (salvou → reabra e registre a chegada).</span>
              </div>
            )}

            {isEdit && (
              <OcImpRecebimento
                draft={draft}
                setDraft={setDraft}
                grade={grade}
                setGrade={setGrade}
                tamanhos={tamanhosAtivos}
                cores={cores as Opt[]}
                coresApelido={coresApelido as CorApelidoOpt[]}
                colaboradores={colaboradores}
                readOnly={status === "recebido"}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t bg-background -mx-6 -mb-6 px-6 py-3 max-md:-mx-4 max-md:-mb-4 max-md:px-4 max-md:shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <Button variant="outline" onClick={onClose} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 md:mr-1" />
            <span className="max-md:sr-only">Voltar</span>
          </Button>
          <Button variant="outline" onClick={() => printWithImages()} aria-label="Imprimir pedido">
            <Printer className="h-4 w-4 md:mr-1" />
            <span className="max-md:sr-only">Imprimir</span>
          </Button>
          {isEdit && status === "encomendado" && (
            <Button
              variant="destructive"
              aria-label="Excluir"
              onClick={() => onDelete({ id: ocId!, numero: numeroReal, nome_produto: draft.nome_produto, produto_importado_id: draft.produto_importado_id, empresa_id: draft.empresa_id, data_pedido: draft.data_pedido, data_prevista: draft.data_prevista, data_entrega: draft.data_entrega, qtd_total: draft.qtd_total, valor_total_desconto: null, status })}
            >
              <Trash2 className="h-4 w-4 md:mr-1" />
              <span className="max-md:sr-only">Excluir</span>
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {canMarkReceived && (
              <Button variant="outline" onClick={() => setConfirmReceber(true)} disabled={receberMutation.isPending || temConflito} title={temConflito ? "Resolva os conflitos antes de receber" : undefined}>
                Marcar Recebido
              </Button>
            )}
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || temConflito} title={temConflito ? "Resolva os conflitos antes de salvar" : undefined}>
              <Check className="h-4 w-4 mr-1" />
              Salvar
            </Button>
          </div>
        </div>
        <OcDocumentoPrint modelo={docModelo} />
      </OcModalShell>

      <AlertDialog open={confirmReceber} onOpenChange={(o) => !o && setConfirmReceber(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como recebido?</AlertDialogTitle>
            <AlertDialogDescription>
              Isto salva a OC, registra a entrada e libera o CQ/Direcionamento para este produto. A grade real vira recebida − defeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => receberMutation.mutate()} disabled={receberMutation.isPending}>
              Confirmar recebimento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-ocimp", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string }[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-ocimp-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
