import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Plus, ArrowLeft, Trash2, Check, Printer } from "lucide-react";
import { printWithImages } from "@/lib/print";
import { OcDocumentoPrint, type OcDocModelo, type OcDocGrade } from "@/components/shared/OcDocumentoPrint";
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
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useTenantModules } from "@/hooks/useTenantModules";
import { varianteLabel } from "@/lib/variante";
import { ehGrupoAcessorio, cadeiaValores } from "@/lib/produto-acabado";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { OcPaForm, type Opt, type CatOpt, type SubOpt, type CorApelidoOpt, type ProdutoVinculadoInfo } from "@/components/oc-p-acabado/OcPaForm";
import { OcPaRecebimento, type ColaboradorOpt } from "@/components/oc-p-acabado/OcPaRecebimento";
import {
  emptyDraft, fmtMoney, fmtDate, uploadFile, contarParcelasPrazo, DEFAULT_TAMANHOS, TAM_ACESSORIO,
  type Draft, type GradeDetalhe, type OcPaRow, type OcPaTab, type OcPaStatus,
} from "@/components/oc-p-acabado/shared";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-p-acabado")({
  validateSearch: (s: Record<string, unknown>): { tab?: OcPaTab; oc?: string } => ({
    tab: s.tab === "encomendado" || s.tab === "recebido" || s.tab === "estoque" ? (s.tab as OcPaTab) : undefined,
    // `?oc=<id>` abre a OC direto (deep-link) — usado por "Fazer pedido"/"⧉" do planejador
    // Produto Acabado (Task 6, revenda), que cria/aponta pra uma OC específica.
    oc: typeof s.oc === "string" && s.oc ? s.oc : undefined,
  }),
  // Sem ModuleGuard aqui de propósito — espelha o padrão real do OTB (outro módulo
  // opt-in, `otb.index.tsx`): o gate de módulo é aplicado na SIDEBAR/HUB (PageDef.gate,
  // ver app-sidebar.tsx/SectionHub.tsx) e nas RPCs (`tenant_module_enabled`); a página
  // em si é protegida só por permissão. `ModuleGuard` tem um race real (achado em QA):
  // `useTenantModules().isLoading` é `false` numa render intermediária ANTES do
  // `tenantId` resolver (query fica `enabled:false` → `isPending && isFetching` dá
  // `false` mesmo sem dado), lendo os DEFAULTS (produto_acabado:false) e redirecionando
  // por engano numa navegação direta/F5 — reproduzido com o módulo já ligado no banco.
  component: () => (
    <RequirePermission page="entrada_oc_p_acabado">
      <OcPaPage />
    </RequirePermission>
  ),
});

function OcPaPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  // Mitigação parcial de UI (achado IMPORTANT do review, decisão do controller): módulo OFF
  // ainda é alcançável por URL direta com a permissão de página concedida — RequirePermission
  // não checa gate de módulo (mesmo padrão do OTB) e as RPCs por trás são a guarda de verdade
  // (tenant_module_enabled). O gap de RLS/modgate nas 3 tabelas fica registrado pro review
  // final, NÃO resolvido aqui — isto só evita mostrar a lista/form quando dá pra saber que
  // está desligado.
  const { isModuleEnabled, isLoading: modulesLoading } = useTenantModules();
  // Item 5 (refino onda 2): default "recebido" — espelha OC Aviamento/OC Insumo
  // (`entrada-saida.oc-aviamento.tsx`/`entrada-saida.oc-insumo.tsx`, ambas abrem em
  // "recebido"); a ordem das abas na UI abaixo também virou Recebidas · Encomendadas ·
  // Estoque, pedido explícito do dono.
  const [tab, setTab] = useState<OcPaTab>(search.tab ?? "recebido");
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OcPaRow | null>(null);
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
        .select("id, numero, nome_produto, produto_acabado_id, empresa_id, data_pedido, data_prevista, data_entrega, qtd_total, valor_total_desconto, status")
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // RPC (não .delete() cru): excluir_oc_p_acabado bloqueia (P0001) OC já recebida
      // (materializou cad/CQ) ou com parcela paga — a guarda "só encomendada" no botão
      // (rodapé do OcPaDialog) é só a primeira camada, redundante de propósito; a real
      // é no servidor. Migration 20260807180000 (Task 5 fix round 1).
      const { error } = await supabase.rpc("excluir_oc_p_acabado" as any, { _oc_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  if (modulesLoading) return null; // evita flash de conteúdo antes de carregar a config (padrão ModuleGuard)
  if (!isModuleEnabled("produto_acabado")) {
    return (
      <div className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <ShoppingCart className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Módulo Produto Acabado desativado</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Ative em <Link to="/admin/configuracoes" className="underline underline-offset-2">Config da Loja</Link> para usar OC P. Acabado.
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
            <h1 className="font-display text-xl font-semibold tracking-tight truncate">OC P. Acabado</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de produto acabado (revenda).</p>
          </div>
        </div>
        <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenDialog(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Novo Pedido
        </Button>
      </header>

      {/* Item 5 (refino onda 2): ordem Recebidas · Encomendadas · Estoque (pedido explícito
          do dono) — espelha a ordem já usada em OC Aviamento/OC Insumo. */}
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
            onDelete={(o) => setDeleting(o)}
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
            // Deep-link `?oc=<id>` consumido (FF4): limpa da URL ao fechar — senão um F5/
            // "voltar" do browser reabre a mesma OC sozinha (mantém o resto do search, ex. tab).
            if (search.oc) navigate({ search: (prev) => ({ ...prev, oc: undefined }), replace: true, resetScroll: false });
          }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] })}
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
function OcPaListaTable({
  ocs, empresaMap, isLoading, emptyLabel, status, dataCol, onRowClick, onDelete,
}: {
  ocs: OcPaRow[];
  empresaMap: Record<string, string>;
  isLoading: boolean;
  emptyLabel: string;
  // Item 6a (refino onda 2): status da ABA (não da linha — todas as linhas aqui têm o
  // mesmo `status` de OcPaRow) — alimenta o chip de prazo (`OcPrazoBadge`, mesmo
  // componente compartilhado por OC Tecido/Aviamento/Insumo): atrasada (encomendado +
  // hoje > prevista) / adiantada (recebido + entrega < prevista) / no prazo.
  status: OcPaStatus;
  dataCol: { label: string; get: (o: OcPaRow) => string };
  onRowClick: (id: string) => void;
  onDelete?: (o: OcPaRow) => void;
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
                <TableCell className="w-10 py-0 text-right">
                  {onDelete && (
                    <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete(o); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
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

// ── Sheet/Dialog de edição/criação (OcModalShell — editar=Sheet 70vw, novo=Dialog) ──
function draftFromOc(oc: any): Draft {
  return {
    numero: oc.numero ?? "",
    nome_produto: oc.nome_produto ?? "",
    produto_acabado_id: oc.produto_acabado_id ?? null,
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
    prazo_pagamento: oc.prazo_pagamento ?? "30",
    // Item 2: SEMPRE derivado do prazo_pagamento (nunca confia no valor persistido, que
    // pode ser de antes desta mudança/editado fora do fluxo) — mesma fonte que o
    // onChange do campo usa ao vivo (contarParcelasPrazo, espelha o trigger do banco).
    parcelas_entrega: contarParcelasPrazo(oc.prazo_pagamento ?? "30"),
    grade_proporcao: oc.grade_proporcao ?? {},
    variantes: Array.isArray(oc.variantes) ? oc.variantes : [],
    qtd_total: oc.qtd_total ?? 0,
    valor_unitario: Number(oc.valor_unitario ?? 0),
    desconto_pct: Number(oc.desconto_pct ?? 0),
    data_entrega: oc.data_entrega ?? "",
    nota_fiscal: oc.nota_fiscal ?? "",
    responsavel_recebimento_id: oc.responsavel_recebimento_id ?? null,
    devolucao: oc.devolucao ?? "",
    revisao: oc.revisao ?? "",
    anexo_pedido_url: oc.anexo_pedido_url ?? null,
    anexo_nf_url: oc.anexo_nf_url ?? null,
  };
}

function OcPaDialog({
  ocId, empresas, onClose, onSaved, onDelete,
}: {
  ocId: string | null;
  empresas: { id: string; nome_fantasia: string; representantes: { id: string; nome: string | null }[] }[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: (oc: OcPaRow) => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [grade, setGrade] = useState<GradeDetalhe>({});
  const [status, setStatus] = useState<OcPaStatus>("encomendado");
  const [numeroReal, setNumeroReal] = useState<string | null>(null);
  const [secAtiva, setSecAtiva] = useState("ocpa-sec-pedido");
  const [confirmReceber, setConfirmReceber] = useState(false);

  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, grade });

  // ── Opções (taxonomia, cores, tamanhos, colaboradores) ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id");
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id");
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id");
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id");
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-todos-ocpa"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as ColaboradorOpt[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-ocpa"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_user_tenant_id" as any);
      if (!data) return DEFAULT_TAMANHOS;
      const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
      const raw = (cfg as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });

  // Acessório = grade única "UN" (mesma fonte da Seção 2, OcPaForm) — a Seção 4
  // (Recebimento) tinha ficado com os 6 tamanhos completos mesmo pro grupo Acessórios
  // (achado SPEC GAP do review, fix round 1): as grades Recebida/Defeito e o InfoStrip
  // de somas precisam da MESMA coluna única "UN", senão o usuário digita numa célula
  // (ex. "34|PPP") que a RPC de recebimento ignora (só lê o que bate com a grade pedida).
  const grupoNomeAtual = (grupos as Opt[]).find((g) => g.id === draft.grupo_id)?.nome ?? "";
  const acessorioAtual = ehGrupoAcessorio(grupoNomeAtual);
  const tamanhosAtivos = acessorioAtual ? [TAM_ACESSORIO] : tamanhos;

  const { data: ocQueryData } = useQuery({
    queryKey: ["oc-p-acabado", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ocs_p_acabado" as any).select("*").eq("id", ocId!).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (!ocQueryData) return;
    const freshDraft = draftFromOc(ocQueryData);
    setDraft(freshDraft);
    setGrade((ocQueryData.grade_detalhe ?? {}) as GradeDetalhe);
    setStatus((ocQueryData.status as OcPaStatus) ?? "encomendado");
    setNumeroReal(ocQueryData.numero ?? null);
    resetBaseline({ draft: freshDraft, grade: (ocQueryData.grade_detalhe ?? {}) as GradeDetalhe });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocQueryData]);

  const { data: produtoVinculado } = useQuery({
    queryKey: ["produto-acabado-vinculado", draft.produto_acabado_id],
    enabled: !!draft.produto_acabado_id,
    queryFn: async (): Promise<ProdutoVinculadoInfo> => {
      const { data, error } = await supabase
        .from("produtos_acabados" as any)
        .select("nome, ref, empresa_id")
        .eq("id", draft.produto_acabado_id!)
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
    const { bruto, totalDesc, unitReal } = cadeiaValores(draft.qtd_total, draft.valor_unitario, draft.desconto_pct);
    const gradeDoc: OcDocGrade = {
      produtoTitulo: `Produto: ${draft.nome_produto || produtoVinculado?.nome || "—"}${numeroReal ? ` (REF ${numeroReal})` : ""}`,
      tamanhos: tams,
      proporcao,
      linhas,
      totalPorTamanho,
      totalGeral: geral,
      valores: [{ descricao: draft.nome_produto || "Produto — todas as cores/tamanhos", qtd: `${geral} pç`, precoUnit: fmtMoney(unitReal), subtotal: fmtMoney(totalDesc) }],
    };
    const empresaSelP = empresas.find((e) => e.id === draft.empresa_id);
    const repNomeP = empresaSelP?.representantes?.find((r) => r.id === draft.representante_id)?.nome ?? null;
    return {
      numero: numeroReal || draft.numero || "—",
      familiaLabel: "Produto Acabado (Revenda)",
      emitidoEm: fmtDate(new Date().toISOString()),
      fornecedor: [
        { k: "Empresa", v: empresaSelP?.nome_fantasia ?? "—" },
        { k: "Representante", v: repNomeP ?? "—" },
      ],
      dados: [
        { k: "Data do pedido", v: draft.data_pedido ? fmtDate(draft.data_pedido) : "—" },
        { k: "Entrega prevista", v: draft.data_prevista ? fmtDate(draft.data_prevista) : "—" },
        { k: "Pagamento", v: draft.prazo_pagamento ? `${draft.prazo_pagamento}${draft.parcelas_entrega ? ` · ${draft.parcelas_entrega} parcela(s)` : ""}` : "—" },
      ],
      grade: gradeDoc,
      totalPrevisto: fmtMoney(totalDesc),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, grade, grupos, tamanhos, cores, coresApelido, empresas, produtoVinculado, numeroReal]);

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
    // Item 1: "" vira NULL no servidor (nullif) — auto-gera ao criar / mantém o valor
    // atual ao editar; preenchido bypassa a geração (trigger só gera quando vazio).
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
    prazo_pagamento: draft.prazo_pagamento || null,
    parcelas_entrega: draft.parcelas_entrega,
    grade_proporcao: draft.grade_proporcao,
    variantes: draft.variantes,
    qtd_total: draft.qtd_total,
    valor_unitario: draft.valor_unitario,
    desconto_pct: draft.desconto_pct,
    nota_fiscal: draft.nota_fiscal || null,
    responsavel_recebimento_id: draft.responsavel_recebimento_id,
    devolucao: draft.devolucao || null,
    revisao: draft.revisao || null,
    anexo_pedido_url: draft.anexo_pedido_url,
    anexo_nf_url: draft.anexo_nf_url,
    // produto_acabado_id só é aplicado NA CRIAÇÃO pela RPC (update não toca — decisão da
    // Task 2, ver task-2-report.md): tudo bem mandar sempre, o servidor ignora em update.
    produto_acabado_id: draft.produto_acabado_id,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.nome_produto.trim()) throw erroValidacao("Informe o nome do produto.");
      const { data: savedId, error } = await supabase.rpc("salvar_oc_p_acabado" as any, {
        _id: isEdit ? ocId : null,
        _dados: montarDados(),
        _grade: grade,
      });
      if (error) throw error;
      return savedId as string;
    },
    onSuccess: (savedId) => {
      toast.success("OC salva.");
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
      qc.invalidateQueries({ queryKey: ["oc-p-acabado", savedId] });
      // Paridade com OC Tecido (L1227, review R2): editar data_prevista aqui muda se a OC
      // entra/sai do badge "atrasada" da sidebar — sem isto, o badge só corrige depois do
      // staleTime da query (["sidebar-badges"]) vencer sozinho.
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      // Refino ago/2026: `_salvar_oc_p_acabado_core` sincroniza valor_unitario/desconto_pct
      // no produto vinculado (migração 20260812100000) — sem invalidar aqui, o card do
      // produto (Plan. Produto) só pegaria o valor novo no próximo refetch espontâneo.
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  const receberMutation = useMutation({
    mutationFn: async () => {
      // Recebimento exige a OC já salva (RPC recebe id) — salva primeiro (persiste
      // TODO o rascunho, inclusive edições de seção 2 ainda não gravadas) e então
      // aplica a transição (materializa cad/cad_grades/CQ + parcelas — Task 3).
      const { data: savedId, error: saveErr } = await supabase.rpc("salvar_oc_p_acabado" as any, {
        _id: isEdit ? ocId : null,
        _dados: montarDados(),
        _grade: grade,
      });
      if (saveErr) throw saveErr;
      // O save intermediário JÁ persistiu (savedId existe no servidor com o rascunho
      // atual) mesmo que o passo de recebimento falhe a seguir (ex.: "Crie o card no
      // Planejamento antes de receber") — sem isto, o selo "alterações não salvas"
      // continuava aceso após um save que na verdade teve sucesso (achado em QA).
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
      qc.invalidateQueries({ queryKey: ["oc-p-acabado", savedId] });
      const { error: recErr } = await supabase.rpc("receber_oc_p_acabado" as any, {
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
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
      qc.invalidateQueries({ queryKey: ["oc-p-acabado", savedId] });
      qc.invalidateQueries({ queryKey: ["estoque_p_acabado"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      // O save intermediário (dentro de mutationFn, acima) já passou por
      // `_salvar_oc_p_acabado_core` — mesmo sync de valor_unitario/desconto_pct do produto
      // vinculado que o saveMutation faz (ver comentário lá).
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => { setConfirmReceber(false); toast.error(mensagemErro(e, "Erro ao marcar recebido")); },
  });

  const canMarkReceived = isEdit && status === "encomendado" && !!draft.data_entrega;

  const secoes: SecaoOc[] = [
    { id: "ocpa-sec-pedido", n: 1, label: "Dados do pedido" },
    { id: "ocpa-sec-grade", n: 2, label: "Grade & valores" },
    { id: "ocpa-sec-anexos", n: 3, label: "Anexos" },
    { id: "ocpa-sec-recebimento", n: 4, label: "Recebimento", locked: !isEdit },
  ];
  const irParaSecao = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSecAtiva(id);
  };
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const topo = e.currentTarget.getBoundingClientRect().top;
    let atual = secoes[0]?.id ?? "ocpa-sec-pedido";
    for (const s of secoes) {
      if (s.locked) continue;
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top - topo <= 40) atual = s.id;
    }
    if (atual !== secAtiva) setSecAtiva(atual);
  };

  return (
    <>
      <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de produto acabado.">
        <div className="shrink-0 space-y-1">
          <Breadcrumb items={[{ label: "Entrada e Saída" }, { label: "OC P. Acabado" }, { label: numeroReal ?? draft.nome_produto ?? "OC" }]} />
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{isEdit ? `OC ${numeroReal ?? ""}` : "Novo Pedido"}</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
        </div>

        <div className="flex min-h-0 gap-4">
          <OcAnchorRail secoes={secoes} ativa={secAtiva} onIr={irParaSecao} />
          <div className="min-w-0 flex-1 space-y-6 overflow-y-auto" onScroll={onBodyScroll}>
            <OcPaForm
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
              // Item 4: preço congela ao receber (paridade com a decisão do dono p/
              // tecido) — o servidor já rejeita (P0001, migração 20260811150000); isto
              // só evita o usuário digitar pra descobrir na hora do Salvar.
              valoresTravados={status === "recebido"}
            />

            {!isEdit && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                <span>O <b>Recebimento</b> fica disponível depois de salvar a OC (salvou → reabra e registre a chegada).</span>
              </div>
            )}

            {isEdit && (
              <OcPaRecebimento
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
              onClick={() => onDelete({ id: ocId!, numero: numeroReal, nome_produto: draft.nome_produto, produto_acabado_id: draft.produto_acabado_id, empresa_id: draft.empresa_id, data_pedido: draft.data_pedido, data_prevista: draft.data_prevista, data_entrega: draft.data_entrega, qtd_total: draft.qtd_total, valor_total_desconto: null, status })}
            >
              <Trash2 className="h-4 w-4 md:mr-1" />
              <span className="max-md:sr-only">Excluir</span>
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {canMarkReceived && (
              <Button variant="outline" onClick={() => setConfirmReceber(true)} disabled={receberMutation.isPending}>
                Marcar Recebido
              </Button>
            )}
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
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

// FIX WAVE (B1-irmão): mesmo bug/fix do planejador Produto Acabado (ProdutoAcabadoSheet.tsx)
// — grupo/categoria são gerenciados no Cadastro; staleTime aqui fazia um item recém-criado
// não aparecer no dropdown desta tela (de criar OC avulsa) se reaberta dentro da janela de
// 5min. Sem staleTime = default 0 = sempre refetch no mount, igual às telas irmãs.
function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-ocpa", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string }[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-ocpa-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}
