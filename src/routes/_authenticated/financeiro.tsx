import { createFileRoute } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { SegmentedTabs } from "@/components/dashboard/mobile";
import { MobileFilterSheet } from "@/components/shared/MobileFilterSheet";
// Aliases: `Tooltip` já é importado do recharts (gráfico do Resumo) mais abaixo.
import {
  Tooltip as UiTooltip, TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider, TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import { DollarSign, ChevronLeft, ChevronRight, Upload, Printer, Check, Clock, Circle, ArrowLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, brlAbrev, fmtInt } from "@/lib/format";
import { corApelidoLabel } from "@/lib/variante";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint, REL_COR_SUCESSO, REL_COR_PERIGO } from "@/components/shared/RelatorioPrint";
import { ComprovantePagamentoPrint } from "@/components/financeiro/ComprovantePagamentoPrint";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameMonth, isSameDay, parseISO, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { useAuth } from "@/hooks/useAuth";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

import { RequirePermission } from "@/components/RequirePermission";
import { ModuleGuard } from "@/components/ModuleGuard";
import { FilterButton, filtroAtivoClass } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";
import { alertaBadge } from "@/components/oc-tecido/CqTecido";
import { AlertTriangle } from "lucide-react";
export const Route = createFileRoute("/_authenticated/financeiro")({
  // Aba e status endereçáveis: a Home aponta "Contas atrasadas" p/ ?tab=lista&status=vencido —
  // sem isso o clique caía no Calendário genérico (laudo do time, jul/2026).
  validateSearch: (s: Record<string, unknown>): { tab?: string; status?: string } => ({
    tab: ["calendario", "lista", "servicos", "resumo"].includes(s.tab as string) ? (s.tab as string) : undefined,
    status: ["a_pagar", "pago", "vencido"].includes(s.status as string) ? (s.status as string) : undefined,
  }),
  component: () => (
    <ModuleGuard module="financeiro">
      <RequirePermission anyOf={["financeiro_parcelas","financeiro_calendario","financeiro_resumo"]}>
        <FinanceiroPage />
      </RequirePermission>
    </ModuleGuard>
  ),
});

type Parcela = {
  id: string;
  tipo_oc: string;
  oc_tecido_id: string | null;
  oc_aviamento_id: string | null;
  oc_etiqueta_id: string | null;
  oc_p_acabado_id: string | null;
  empresa_id: string | null;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string | null;
  comprovante_url: string | null;
  empresas?: { nome: string } | null;
  // Empresa/representante crus p/ o card (o `empresas.nome` é o rótulo combinado da tabela/calendário).
  empresaNome?: string | null;
  empresaCnpj?: string | null;
  representanteNome?: string | null;
  representanteCnpj?: string | null;
  ocs_tecido?: { numero_pedido: string | null } | null;
  ocs_aviamento?: { numero_pedido: string | null } | null;
  ocs_etiqueta?: { numero_pedido: string | null } | null;
  ocs_p_acabado?: { numero_pedido: string | null } | null;
  ocBadge?: { label: string; tone: StatusTone } | null;
};

// Parse de "yyyy-MM-dd" como data LOCAL (parseISO trata date-only como UTC → shift de dia em BRT).
function parseLocalDate(s: string | null | undefined): Date {
  const [y, m, d] = (s ?? "").slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

function effectiveStatus(p: Parcela, hoje: string): "pago" | "vencido" | "a_pagar" {
  if (p.status === "pago" || p.data_pagamento) return "pago";
  // Comparação de strings "yyyy-MM-dd" (lexicográfica = cronológica). `hoje` vem no
  // FUSO DA LOJA (todayISOInStoreTZ), não do device — consistente com o resto do app.
  const venc = (p.data_vencimento ?? "").slice(0, 10);
  if (venc && venc < hoje) return "vencido";
  return "a_pagar";
}

/* ---- §Q9/§R3: uma marca de status única (tom + ícone), nunca só cor ---------------- */
// Fundo/tinta SÓ via tokens de tom (--tone-*-bg/-fg de src/styles.css, fórmula §Q9
// color-mix) — nada de hex/hsl solto (anti-drift a/f). Cada estado tem UM tom + UM ícone
// idêntico na célula, na legenda, no popover do dia e nas tabelas (daltonismo-safe).
const TONE_SURFACE: Record<StatusTone, string> = {
  success: "bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]",
  warning: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]",
  danger: "bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]",
  info: "bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]",
  neutral: "bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]",
};

// Ponto sólido por tom (strip do mês, mobile) — cor via token de tinta do tom (§Q9), nunca
// classe de cor solta (green-500…) que o anti-drift/§R proíbem.
const DOT_TONE: Record<StatusTone, string> = {
  success: "bg-[var(--tone-success-fg)]",
  warning: "bg-[var(--tone-warning-fg)]",
  danger: "bg-[var(--tone-danger-fg)]",
  info: "bg-[var(--tone-info-fg)]",
  neutral: "bg-[var(--tone-neutral-fg)]",
};

// Marca visual do calendário — 4 estados (o ≤3d é um REALCE dentro de "a vencer", não muda
// effectiveStatus). Critérios são os REAIS da tela (effectiveStatus + proximidade do venc.).
type VisEstado = "pago" | "vence_breve" | "vencido" | "a_vencer";
type VisMeta = { tone: StatusTone; Icon: LucideIcon; label: string; fill?: boolean };
const VIS_META: Record<VisEstado, VisMeta> = {
  pago: { tone: "success", Icon: Check, label: "Pago" },
  vence_breve: { tone: "warning", Icon: Clock, label: "Vence em ≤ 3 dias" },
  vencido: { tone: "danger", Icon: AlertTriangle, label: "Vencido" },
  a_vencer: { tone: "neutral", Icon: Circle, label: "A vencer", fill: true },
};
const LEGENDA_VIS: VisEstado[] = ["pago", "vence_breve", "vencido", "a_vencer"];

function parcelaVis(p: Parcela, hoje: string, today: Date): VisEstado {
  const st = effectiveStatus(p, hoje);
  if (st === "pago") return "pago";
  if (st === "vencido") return "vencido";
  const diff = differenceInCalendarDays(parseLocalDate(p.data_vencimento), today);
  return diff <= 3 ? "vence_breve" : "a_vencer";
}

// Badge de status das TABELAS (3 estados; sem o realce ≤3d, que é só do calendário).
function StatusParcelaBadge({ st }: { st: "pago" | "vencido" | "a_pagar" }) {
  const meta: VisMeta & { label: string } =
    st === "pago" ? { ...VIS_META.pago }
    : st === "vencido" ? { ...VIS_META.vencido }
    : { ...VIS_META.a_vencer, label: "A pagar" };
  const { tone, Icon, label, fill } = meta;
  return (
    <StatusBadge tone={tone} className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px]">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", fill && "fill-current")} aria-hidden />
      {label}
    </StatusBadge>
  );
}

// Ícone + superfície do tom, num quadradinho (legenda / linha do popover / strip).
function VisBadgeIcon({ vis, className }: { vis: VisEstado; className?: string }) {
  const { tone, Icon, fill } = VIS_META[vis];
  return (
    <span className={cn("inline-flex items-center justify-center rounded-md", TONE_SURFACE[tone], className)}>
      <Icon className={cn("h-3.5 w-3.5", fill && "fill-current")} aria-hidden />
    </span>
  );
}

// Chips de Status (mobile, dentro do bottom sheet de filtros) — mesma marca tom+ícone da
// tela; seleção única (clicar o ativo volta p/ "all"). Alvos ≥ 40px (dentro do sheet 44px).
function StatusFilterChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts: { v: string; vis: VisEstado; label: string }[] = [
    { v: "a_pagar", vis: "a_vencer", label: "A pagar" },
    { v: "pago", vis: "pago", label: "Pago" },
    { v: "vencido", vis: "vencido", label: "Vencido" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map(({ v, vis, label }) => {
        const on = value === v;
        const { Icon, fill } = VIS_META[vis];
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(on ? "all" : v)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 text-xs font-semibold",
              on ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", fill && "fill-current")} aria-hidden /> {label}
          </button>
        );
      })}
    </div>
  );
}

// Permissão de ESCRITA do Financeiro (parcelas a pagar/calendário). Propagada por
// contexto para alcançar os diálogos PORTALIZADOS (ParcelaDetailDialog/PagarDialog,
// que renderizam fora do subtree da página) e as células/botões das tabelas.
// Default false = fail-closed. Corrige: (a) view-only conseguia gravar parcelas e
// (b) editor só de `financeiro_resumo` (aba sem mutação) liberava escrita em Parcelas.
const FinanceiroEditContext = createContext(false);
const usePodeEditarFinanceiro = () => useContext(FinanceiroEditContext);

function FinanceiroPage() {
  const { canEdit } = useAuth();
  // Escrita só com edição na aba que de fato muta (parcelas a pagar / calendário).
  // `financeiro_resumo` é relatório, não concede escrita.
  const podeEditar = canEdit("financeiro_parcelas") || canEdit("financeiro_calendario");
  const search = Route.useSearch();
  const [tab, setTab] = useState(search.tab ?? "calendario");
  const { data: parcelas = [], isLoading } = useQuery({
    queryKey: ["parcelas"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("parcelas")
        .select("*")
        .order("data_vencimento", { ascending: true });
      if (error) throw error;
      const list = (rows ?? []) as unknown as Parcela[];

      const empresaIds = Array.from(new Set(list.map((p) => p.empresa_id).filter(Boolean))) as string[];
      const tecidoIds = Array.from(new Set(list.map((p) => p.oc_tecido_id).filter(Boolean))) as string[];
      const aviamentoIds = Array.from(new Set(list.map((p) => p.oc_aviamento_id).filter(Boolean))) as string[];
      const etiquetaIds = Array.from(new Set(list.map((p) => p.oc_etiqueta_id).filter(Boolean))) as string[];
      const pAcabadoIds = Array.from(new Set(list.map((p) => p.oc_p_acabado_id).filter(Boolean))) as string[];

      const [empresasRes, tecidoRes, aviamentoRes, etiquetaRes, pAcabadoRes] = await Promise.all([
        empresaIds.length
          ? supabase.from("empresas").select("id,nome_fantasia,cnpj").in("id", empresaIds)
          : Promise.resolve({ data: [], error: null } as const),

        tecidoIds.length
          ? supabase.from("ocs_tecido").select("id, numero_pedido, valor_real_total, representante:representante_id(nome,cnpj), ocs_tecido_itens!oc_tecido_id(cq_alerta_status, cancelado)").in("id", tecidoIds)
          : Promise.resolve({ data: [], error: null } as const),
        aviamentoIds.length
          ? supabase.from("ocs_aviamento").select("id,numero_pedido, representante:representante_id(nome,cnpj)").in("id", aviamentoIds)
          : Promise.resolve({ data: [], error: null } as const),
        etiquetaIds.length
          ? supabase.from("ocs_etiqueta" as any).select("id,numero_pedido, representante:representante_id(nome,cnpj)").in("id", etiquetaIds)
          : Promise.resolve({ data: [], error: null } as const),
        // `ocs_p_acabado` está fora do types.ts (feature Revenda, branch não mesclada);
        // a coluna do nº do pedido lá é `numero` (não `numero_pedido`, diferente das demais).
        pAcabadoIds.length
          ? supabase.from("ocs_p_acabado" as any).select("id,numero, empresa_id, representante:representante_id(nome,cnpj)").in("id", pAcabadoIds)
          : Promise.resolve({ data: [], error: null } as const),
      ]);
      if (empresasRes.error) throw empresasRes.error;
      if (tecidoRes.error) throw tecidoRes.error;
      if (aviamentoRes.error) throw aviamentoRes.error;
      if (etiquetaRes.error) throw etiquetaRes.error;
      if (pAcabadoRes.error) throw pAcabadoRes.error;
      const etqData = (etiquetaRes.data ?? []) as any[];
      const pAcData = (pAcabadoRes.data ?? []) as any[];

      const empMap = new Map((empresasRes.data ?? []).map((e: any) => [e.id, e.nome_fantasia as string]));
      // CNPJ da empresa (payee quando a OC é direto no fornecedor, sem representante).
      const empCnpjMap = new Map((empresasRes.data ?? []).map((e: any) => [e.id, (e.cnpj ?? null) as string | null]));
      const tecMap = new Map((tecidoRes.data ?? []).map((o: any) => [o.id, o.numero_pedido as string | null]));
      const aviMap = new Map((aviamentoRes.data ?? []).map((o: any) => [o.id, o.numero_pedido as string | null]));
      const etqMap = new Map(etqData.map((o: any) => [o.id, o.numero_pedido as string | null]));
      const pAcMap = new Map(pAcData.map((o: any) => [o.id, o.numero as string | null]));
      // Representante da OC (se houver): o financeiro paga o rep — distingue "via representante".
      const tecRepMap = new Map((tecidoRes.data ?? []).map((o: any) => [o.id, (o.representante?.nome ?? null) as string | null]));
      const aviRepMap = new Map((aviamentoRes.data ?? []).map((o: any) => [o.id, (o.representante?.nome ?? null) as string | null]));
      const etqRepMap = new Map(etqData.map((o: any) => [o.id, (o.representante?.nome ?? null) as string | null]));
      const pAcRepMap = new Map(pAcData.map((o: any) => [o.id, (o.representante?.nome ?? null) as string | null]));
      // CNPJ do representante da OC (payee quando a compra é via representante).
      const tecRepCnpjMap = new Map((tecidoRes.data ?? []).map((o: any) => [o.id, (o.representante?.cnpj ?? null) as string | null]));
      const aviRepCnpjMap = new Map((aviamentoRes.data ?? []).map((o: any) => [o.id, (o.representante?.cnpj ?? null) as string | null]));
      const etqRepCnpjMap = new Map(etqData.map((o: any) => [o.id, (o.representante?.cnpj ?? null) as string | null]));
      const pAcRepCnpjMap = new Map(pAcData.map((o: any) => [o.id, (o.representante?.cnpj ?? null) as string | null]));
      // Badge de alerta (troca/cancelamento/etc.) por OC de tecido.
      const tecBadge = new Map(
        (tecidoRes.data ?? []).map((o: any) => [o.id, alertaBadge((o.ocs_tecido_itens ?? []).map((it: any) => it.cq_alerta_status))]),
      );
      // OC de tecido "cancelada" = todos os itens cancelados (valor real 0). Some do Financeiro.
      const ocCancelada = new Set(
        (tecidoRes.data ?? []).filter((o: any) => {
          const its = o.ocs_tecido_itens ?? [];
          return its.length > 0 && its.every((it: any) => it.cancelado) ;
        }).map((o: any) => o.id),
      );

      return list
        .filter((p) => !(p.oc_tecido_id && ocCancelada.has(p.oc_tecido_id)))
        .map((p) => {
        const empNome = p.empresa_id ? (empMap.get(p.empresa_id) ?? "—") : null;
        const empCnpj = p.empresa_id ? (empCnpjMap.get(p.empresa_id) ?? null) : null;
        const repNome = p.oc_tecido_id ? tecRepMap.get(p.oc_tecido_id) : p.oc_aviamento_id ? aviRepMap.get(p.oc_aviamento_id) : p.oc_etiqueta_id ? etqRepMap.get(p.oc_etiqueta_id) : p.oc_p_acabado_id ? pAcRepMap.get(p.oc_p_acabado_id) : null;
        const repCnpj = p.oc_tecido_id ? tecRepCnpjMap.get(p.oc_tecido_id) : p.oc_aviamento_id ? aviRepCnpjMap.get(p.oc_aviamento_id) : p.oc_etiqueta_id ? etqRepCnpjMap.get(p.oc_etiqueta_id) : p.oc_p_acabado_id ? pAcRepCnpjMap.get(p.oc_p_acabado_id) : null;
        return {
        ...p,
        empresas: empNome ? { nome: empNome } : null,
        // Campos crus p/ o card/detalhe: empresa e representante separados + o CNPJ certo.
        // payee = representante (se houver), senão a empresa.
        empresaNome: empNome,
        empresaCnpj: empCnpj,
        representanteNome: repNome ?? null,
        representanteCnpj: repCnpj ?? null,
        ocs_tecido: p.oc_tecido_id ? { numero_pedido: tecMap.get(p.oc_tecido_id) ?? null } : null,
        ocs_aviamento: p.oc_aviamento_id ? { numero_pedido: aviMap.get(p.oc_aviamento_id) ?? null } : null,
        ocs_etiqueta: p.oc_etiqueta_id ? { numero_pedido: etqMap.get(p.oc_etiqueta_id) ?? null } : null,
        ocs_p_acabado: p.oc_p_acabado_id ? { numero_pedido: pAcMap.get(p.oc_p_acabado_id) ?? null } : null,
        ocBadge: p.oc_tecido_id ? tecBadge.get(p.oc_tecido_id) ?? null : null,
        };
      });
    },
  });

  // Serviços (Terceirizados) com vencimento preenchido → também aparecem no calendário.
  // Chave distinta da aba Serviços (shape mapeado p/ calendário ≠ shape cru da lista),
  // mas com o mesmo PREFIXO "servicos-financeiro" → as invalidações por prefixo atingem ambas.
  const { data: servicosCal = [] } = useQuery({
    queryKey: ["servicos-financeiro", "calendario"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("servicos_financeiro" as any);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((r) => r.data_vencimento)
        .map((r) => {
          // Payee p/ o rótulo do calendário: empresa + (representante se houver),
          // com fallback ao `responsavel` legado.
          const payee = r.representante_nome ?? r.empresa_nome ?? r.responsavel ?? "—";
          return {
          id: r.parcela_id,
          data_vencimento: r.data_vencimento,
          valor: r.valor_parcela,
          empresas: { nome: `🔧 ${r.servico} · ${payee}` },
          status: r.status,
          data_pagamento: r.data_pagamento,
          _servico: true,
          };
        });
    },
  });
  const parcelasCal = useMemo(() => [...parcelas, ...(servicosCal as any[])] as Parcela[], [parcelas, servicosCal]);

  // Pendências de recebimento: OCs com troca pendente / reposição ainda não recebida.
  const { data: pendencias = [] } = useQuery({
    queryKey: ["financeiro-pendencias-receb"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido")
        .select("id, numero_pedido, ocs_tecido_itens!oc_tecido_id(cq_alerta_status, substitui_item_id, quantidade_recebida)")
        .eq("status", "recebido").eq("is_rolo" as never, false as never);
      if (error) throw error;
      return ((data ?? []) as any[])
        .map((oc) => {
          const its = oc.ocs_tecido_itens ?? [];
          const pend = its.some((it: any) => it.cq_alerta_status === "troca_pendente"
            || (it.substitui_item_id && it.quantidade_recebida == null));
          return pend ? { id: oc.id, numero_pedido: oc.numero_pedido as string | null } : null;
        })
        .filter(Boolean) as { id: string; numero_pedido: string | null }[];
    },
  });

  return (
    <FinanceiroEditContext.Provider value={podeEditar}>
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-start gap-3">
        <DollarSign className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground">Parcelas, calendário e resumo financeiro.</p>
        </div>
      </header>

      {pendencias.length > 0 && (
        <Card className="p-3 border-amber-500/50 bg-amber-500/5">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <b>Pendências de recebimento ({pendencias.length}).</b> Há troca(s) com reposição ainda
              não recebida — o valor da OC pode mudar quando a reposição chegar:{" "}
              <span className="text-muted-foreground">
                {pendencias.map((p) => p.numero_pedido || "—").join(", ")}
              </span>
            </div>
          </div>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        {/* Mobile (<md): abas como pílulas roláveis (SegmentedTabs do dashboard) — substitui
            o Select. Desktop mantém a TabsList (agora ≥md, alinhado à camada mobile). */}
        <div className="md:hidden mb-4">
          <SegmentedTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "calendario", label: "Calendário" },
              { value: "lista", label: "OCs" },
              { value: "servicos", label: "Serviços" },
              { value: "resumo", label: "Resumo" },
            ]}
          />
        </div>
        {/* Abas no nível da página: FORA do card/calendário (antes ficavam embutidas
            no cabeçalho do calendário, parecendo "camufladas" dentro dele). */}
        <TabsList className="mb-2 hidden md:inline-flex md:flex-nowrap">
          <TabsTrigger value="calendario">Calendário</TabsTrigger>
          <TabsTrigger value="lista">OCs</TabsTrigger>
          <TabsTrigger value="servicos">Serviços</TabsTrigger>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
        </TabsList>
        <TabsContent value="calendario" className="mt-4">
          <CalendarioView parcelas={parcelasCal} loading={isLoading} onServico={() => setTab("servicos")} />
        </TabsContent>
        <TabsContent value="lista" className="mt-4">
          <ListaView parcelas={parcelas} loading={isLoading} initialStatus={search.status} />
        </TabsContent>
        <TabsContent value="servicos" className="mt-4">
          <ServicosView />
        </TabsContent>
        <TabsContent value="resumo" className="mt-4">
          <ResumoView parcelas={parcelas} servicos={servicosCal as unknown as Parcela[]} />
        </TabsContent>
      </Tabs>
    </div>
    </FinanceiroEditContext.Provider>
  );
}

/* ============================ CALENDÁRIO ============================ */

function CalendarioView({ parcelas, loading, onServico }: { parcelas: Parcela[]; loading: boolean; onServico?: () => void }) {
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [ocView, setOcView] = useState<{ tipo: string; id: string } | null>(null);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  // Popover "dia aberto" (desktop): a chave do dia (yyyy-MM-dd) cujo popover está aberto.
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Sheet do dia (mobile): estado SEPARADO do popover — as duas superfícies coexistem no DOM
  // (grade `hidden md:grid` vs agenda `md:hidden`) e um Sheet portaliza p/ o body; compartilhar
  // o mesmo estado abriria os dois ao mesmo tempo. Aberto via strip; linhas abrem o detalhe.
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const autoJumped = useRef(false);

  // Quando as parcelas chegarem, se o mês atual estiver vazio, salta para o mês da próxima parcela
  useEffect(() => {
    if (autoJumped.current || parcelas.length === 0) return;
    const now = startOfMonth(new Date());
    const hasCurrent = parcelas.some((p) => isSameMonth(parseLocalDate(p.data_vencimento), now));
    if (hasCurrent) { autoJumped.current = true; return; }
    const future = parcelas
      .map((p) => parseLocalDate(p.data_vencimento))
      .filter((d) => d >= now)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (future) setCursor(startOfMonth(future));
    autoJumped.current = true;
  }, [parcelas]);


  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });


  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const byDay = useMemo(() => {
    const m = new Map<string, Parcela[]>();
    for (const p of parcelas) {
      const k = p.data_vencimento;
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [parcelas]);

  const today = new Date();

  return (
    <Card className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" className="shrink-0" onClick={() => setCursor(addMonths(cursor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="flex-1 text-center text-base font-semibold capitalize sm:text-lg">
          {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
        </h2>
        <Button variant="outline" size="icon" className="shrink-0" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => setCursor(startOfMonth(new Date()))}>Hoje</Button>
      </div>

      <div className="hidden md:grid grid-cols-7 gap-px bg-border text-xs">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div key={d} className="bg-muted text-muted-foreground py-2 text-center font-medium">{d}</div>
        ))}
        {days.map((day) => {
          const k = format(day, "yyyy-MM-dd");
          const items = byDay.get(k) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          const cellCls = cn(
            "bg-background min-h-[98px] p-1.5 text-xs",
            !inMonth && "opacity-40",
            isToday && "ring-1 ring-primary",
          );
          const dayNum = <div className="text-right text-[11px] text-muted-foreground mb-1">{format(day, "d")}</div>;
          if (items.length === 0) {
            return <div key={k} className={cellCls}>{dayNum}</div>;
          }
          const total = items.reduce((s, p) => s + Number(p.valor || 0), 0);
          // Célula tocável = "dia como unidade de ação": abre o popover com TODAS as parcelas
          // do dia. Até 2 chips (tom+ícone+valor abreviado) + "+N · dia R$…" com o total do dia.
          return (
            <Popover key={k} open={openDay === k} onOpenChange={(o) => setOpenDay(o ? k : null)}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(cellCls, "text-left transition-shadow hover:ring-1 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                >
                  {dayNum}
                  <div className="space-y-1">
                    {items.slice(0, 2).map((p) => {
                      const { tone, Icon, fill } = VIS_META[parcelaVis(p, hoje, today)];
                      const nome = p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—";
                      return (
                        <span key={p.id} className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE_SURFACE[tone])}>
                          <Icon className={cn("h-3.5 w-3.5 shrink-0", fill && "fill-current")} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-normal">{nome}</span>
                          <span className="shrink-0 tabular-nums font-semibold">{brlAbrev(Number(p.valor))}</span>
                        </span>
                      );
                    })}
                    {items.length > 2 && (
                      <div className="pl-1 text-[11px] font-medium text-muted-foreground">
                        +{items.length - 2} · dia {brlAbrev(total)}
                      </div>
                    )}
                  </div>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <DiaParcelasList
                  day={day} items={items} hoje={hoje} today={today}
                  onPick={(p) => { setOpenDay(null); (p as any)._servico ? onServico?.() : setDetalheId(p.id); }}
                />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>

      {/* Mobile (<md): mês-grade vira strip navegável + agenda por dia (NN/g · HIG).
          O mês é navegado pela mesma barra de mês acima. */}
      {(() => {
        const diasComParcela = days.filter((day) => isSameMonth(day, cursor) && (byDay.get(format(day, "yyyy-MM-dd"))?.length ?? 0) > 0);
        if (diasComParcela.length === 0) {
          return <p className="md:hidden py-6 text-center text-sm text-muted-foreground">Nenhuma parcela neste mês.</p>;
        }
        const wdShort = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
        const wdLong = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
        return (
          <div className="md:hidden">
            {/* strip: só os dias com parcela (dots por tom), tocar abre o sheet do dia */}
            <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {diasComParcela.map((day) => {
                const k = format(day, "yyyy-MM-dd");
                const items = byDay.get(k) ?? [];
                const isToday = isSameDay(day, today);
                return (
                  <button
                    key={k}
                    type="button"
                    data-qa="strip-day"
                    onClick={() => setSheetDay(k)}
                    className={cn(
                      "flex min-h-[56px] w-11 shrink-0 flex-col items-center gap-1 rounded-xl border bg-card px-1 py-1.5",
                      isToday && "border-primary bg-primary/10",
                    )}
                  >
                    <span className="text-[10px] uppercase text-muted-foreground">{wdShort[day.getDay()]}</span>
                    <span className={cn("text-sm font-bold leading-none", isToday && "text-primary")}>{format(day, "d")}</span>
                    <span className="flex h-1.5 items-center gap-0.5">
                      {items.slice(0, 3).map((p, i) => (
                        <span key={i} className={cn("h-1.5 w-1.5 rounded-full", DOT_TONE[VIS_META[parcelaVis(p, hoje, today)].tone])} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* agenda: grupos por dia (cabeçalho + total), linhas tom+ícone abrem o detalhe */}
            <div className="mt-2 space-y-3">
              {diasComParcela.map((day) => {
                const k = format(day, "yyyy-MM-dd");
                const items = byDay.get(k) ?? [];
                const isToday = isSameDay(day, today);
                const total = items.reduce((s, p) => s + Number(p.valor || 0), 0);
                const diff = differenceInCalendarDays(day, today);
                const rel = isToday ? "hoje" : diff > 0 && diff <= 7 ? `em ${diff} dia${diff > 1 ? "s" : ""}` : null;
                return (
                  <div key={k} data-qa="agenda-day" className={cn("overflow-hidden rounded-xl border", isToday && "ring-1 ring-primary")}>
                    <div className="flex items-baseline justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="text-sm font-semibold">
                        {wdLong[day.getDay()]}, {format(day, "dd/MM")}
                        {rel && <span className="ml-1.5 text-[11px] font-normal text-primary">{rel}</span>}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{brl(total)}</span>
                    </div>
                    <div className="divide-y">
                      {items.map((p) => {
                        const vis = parcelaVis(p, hoje, today);
                        const nome = p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—";
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => (p as any)._servico ? onServico?.() : setDetalheId(p.id)}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted/50"
                          >
                            <VisBadgeIcon vis={vis} className="h-7 w-7 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{nome}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{parcelaOrigemLabel(p)}</span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{brl(Number(p.valor))}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs text-foreground/80">
        {LEGENDA_VIS.map((vis) => (
          <span key={vis} className="inline-flex items-center gap-1.5">
            <VisBadgeIcon vis={vis} className="h-5 w-5" />
            {VIS_META[vis].label}
          </span>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground mt-2">Carregando…</p>}

      {/* Sheet do dia (mobile): parcelas do dia tocado na strip; cada linha abre o detalhe
          (marcar/desmarcar pago, abrir OC, comprovante). Só renderiza quando aberto. */}
      <Sheet open={sheetDay !== null} onOpenChange={(o) => { if (!o) setSheetDay(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl p-0">
          <SheetTitle className="sr-only">Parcelas do dia</SheetTitle>
          {sheetDay && (
            <DiaParcelasList
              day={parseLocalDate(sheetDay)}
              items={byDay.get(sheetDay) ?? []}
              hoje={hoje} today={today}
              onPick={(p) => { setSheetDay(null); (p as any)._servico ? onServico?.() : setDetalheId(p.id); }}
            />
          )}
        </SheetContent>
      </Sheet>

      <ParcelaDetailDialog
        parcela={detalheId ? parcelas.find((p) => p.id === detalheId) ?? null : null}
        onClose={() => setDetalheId(null)}
        onMarkPaid={(id) => { setDetalheId(null); setPagandoId(id); }}
        onOpenOc={(tipo, id) => { setDetalheId(null); setOcView({ tipo, id }); }}
        onVencimentoSaved={(d) => { autoJumped.current = true; setCursor(startOfMonth(parseLocalDate(d))); }}
      />
      <PagarDialog parcelaId={pagandoId} onClose={() => setPagandoId(null)} />
      <OcViewDialog view={ocView} onClose={() => setOcView(null)} />
    </Card>
  );
}

function ParcelaDetailDialog({
  parcela, onClose, onMarkPaid, onOpenOc, onVencimentoSaved,
}: {
  parcela: Parcela | null;
  onClose: () => void;
  onMarkPaid: (id: string) => void;
  onOpenOc: (tipo: string, ocId: string) => void;
  onVencimentoSaved?: (date: string) => void;
}) {
  const qc = useQueryClient();
  const { isAdmin, isSuperAdmin, isTenantAdmin } = useAuth();
  const canRecalc = isAdmin || isSuperAdmin || isTenantAdmin;
  const podeEditar = usePodeEditarFinanceiro();
  const hoje = todayISOInStoreTZ(useStoreTimezone());

  const desmarcarPagoMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      const { error } = await supabase.from("parcelas")
        .update({ status: "a_pagar", data_pagamento: null }).eq("id", parcela.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento desmarcado");
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar")),
  });

  const [vencimento, setVencimento] = useState(parcela?.data_vencimento ?? "");
  useEffect(() => {
    setVencimento(parcela?.data_vencimento ?? "");
  }, [parcela?.id, parcela?.data_vencimento]);

  const updateVencimentoMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      const { error } = await supabase.from("parcelas").update({ data_vencimento: vencimento } as any).eq("id", parcela.id);
      if (error) throw error;
    },
    onMutate: async () => {
      if (!parcela) return {};
      await qc.cancelQueries({ queryKey: ["parcelas"] });
      const prev = qc.getQueryData<any[]>(["parcelas"]);
      qc.setQueryData<any[]>(["parcelas"], (old) => (old ?? []).map((p) =>
        p.id === parcela.id ? { ...p, data_vencimento: vencimento } : p));
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["parcelas"], ctx.prev);
      toast.error(mensagemErro(e, "Erro ao atualizar vencimento"));
    },
    onSuccess: () => {
      toast.success("Vencimento atualizado");
      // Mantém a parcela editada VISÍVEL: salta o calendário para o mês da nova
      // data (senão o chip re-chaveia para um mês fora da vista e parece sumir).
      // O badge já está vermelho aqui — a lógica de status NÃO muda.
      onVencimentoSaved?.(vencimento);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcelas"] }),
  });

  const recalcMut = useMutation({
    mutationFn: async () => {
      if (!parcela) return;
      // `_recalcular_parcelas_core` suporta tecido/aviamento/p_acabado (FF1, ago/2026,
      // migração 20260811100000). Insumo (etiqueta) fica de fora — tem gerador próprio
      // (`recalcular_parcelas_etiqueta`) que já roda automático a cada save da OC; o
      // botão nem aparece pra esse tipo (ver JSX abaixo).
      const ocId = parcela.oc_tecido_id ?? parcela.oc_aviamento_id ?? parcela.oc_p_acabado_id;
      if (!ocId) throw new Error("Parcela sem OC vinculada");
      const { data, error } = await supabase.rpc("recalcular_parcelas" as any, {
        _oc_id: ocId,
        _tipo: parcela.tipo_oc,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Parcelas recalculadas: ${data?.criadas ?? 0} criadas, ${data?.deletadas ?? 0} removidas, ${data?.preservadas_pagas ?? 0} pagas preservadas.`,
      );
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao recalcular")),
  });

  if (!parcela) return null;
  const st = effectiveStatus(parcela, hoje);
  const ocNumero = parcela.ocs_tecido?.numero_pedido ?? parcela.ocs_aviamento?.numero_pedido ?? parcela.ocs_etiqueta?.numero_pedido ?? parcela.ocs_p_acabado?.numero_pedido ?? "—";
  const tipoLabel = parcela.tipo_oc === "tecido" ? "OC de Tecido" : parcela.tipo_oc === "aviamento" ? "OC de Aviamento" : parcela.tipo_oc === "etiqueta" ? "OC de Insumo" : parcela.tipo_oc === "p_acabado" ? "Produto Acabado" : parcela.tipo_oc;
  // O financeiro paga o REPRESENTANTE quando a OC foi via rep; senão, a empresa.
  // O CNPJ mostrado é o do payee (rep se houver, senão a empresa).
  const temRep = !!parcela.representanteNome;
  const payeeCnpj = temRep ? (parcela.representanteCnpj ?? null) : (parcela.empresaCnpj ?? null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Detalhes da Parcela</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Empresa:</span> <b>{parcela.empresaNome ?? parcela.empresas?.nome ?? "—"}</b></div>
          {temRep && (
            <div><span className="text-muted-foreground">Representante:</span> <b>{parcela.representanteNome}</b></div>
          )}
          <div>
            <span className="text-muted-foreground">CNPJ{temRep ? " (representante)" : ""}:</span> {payeeCnpj ?? "—"}
          </div>
          <div className="flex items-center gap-2"><span className="text-muted-foreground">Origem:</span> {tipoLabel} · Nº {ocNumero}
            {parcela.ocBadge && <StatusBadge tone={parcela.ocBadge.tone}>{parcela.ocBadge.label}</StatusBadge>}</div>
          <div><span className="text-muted-foreground">Parcela:</span> {parcela.numero_parcela}</div>
          <div><span className="text-muted-foreground">Valor:</span> <b>{brl(Number(parcela.valor))}</b></div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Vencimento:</span>
            <DateField
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className="w-40"
              disabled={!podeEditar || st === "pago"}
            />
            {podeEditar && vencimento !== parcela.data_vencimento && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateVencimentoMut.mutate()}
                disabled={updateVencimentoMut.isPending}
              >
                Salvar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusParcelaBadge st={st} />
          </div>
          {parcela.data_pagamento && (
            <div><span className="text-muted-foreground">Pago em:</span> {format(parseISO(parcela.data_pagamento), "dd/MM/yyyy")}</div>
          )}
          {parcela.comprovante_url && (
            <div><ComprovanteLink value={parcela.comprovante_url} label="Ver comprovante" className="text-primary" /></div>
          )}
        </div>

        {st === "pago" && (
          <ComprovantePagamentoPrint parcela={parcela} tipoLabel={tipoLabel} ocNumero={ocNumero} />
        )}

        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          {st === "pago" && (
            <Button size="sm" variant="outline" className="hidden md:inline-flex" onClick={() => printWithImages()}>
              <Printer className="h-4 w-4 mr-1" /> Comprovante
            </Button>
          )}
          {(parcela.oc_tecido_id || parcela.oc_aviamento_id || parcela.oc_etiqueta_id || parcela.oc_p_acabado_id) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenOc(parcela.tipo_oc, (parcela.oc_tecido_id ?? parcela.oc_aviamento_id ?? parcela.oc_etiqueta_id ?? parcela.oc_p_acabado_id)!)}
            >
              Abrir OC
            </Button>
          )}
          {canRecalc && (parcela.tipo_oc !== "etiqueta" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm("Recalcular parcelas desta OC? Parcelas pagas serão preservadas; as demais serão regeradas com os valores atuais.")) {
                  recalcMut.mutate();
                }
              }}
              disabled={recalcMut.isPending}
            >
              Recalcular
            </Button>
          ) : (
            // Insumo (etiqueta): sem recálculo manual — `recalcular_parcelas_etiqueta` já
            // roda automático via trigger a cada save da OC/itens (FF1, ago/2026).
            <UiTooltipProvider>
              <UiTooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover. */}
                <UiTooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" variant="outline" disabled>Recalcular</Button>
                  </span>
                </UiTooltipTrigger>
                <UiTooltipContent>Recalculado automaticamente ao editar a OC.</UiTooltipContent>
              </UiTooltip>
            </UiTooltipProvider>
          ))}
          {podeEditar && (st === "pago" ? (
            <Button size="sm" variant="destructive" onClick={() => desmarcarPagoMut.mutate()} disabled={desmarcarPagoMut.isPending}>
              Desmarcar pago
            </Button>
          ) : (
            <Button size="sm" onClick={() => onMarkPaid(parcela.id)}>Marcar pago</Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComprovanteLink({ value, label, className }: { value: string; label: string; className?: string }) {
  // Compat: registros antigos guardavam a signed URL inteira; novos guardam o path do bucket.
  const isPath = !value.startsWith("http");
  const signedUrl = useSignedUrl(isPath ? value : null, "comprovantes");
  const href = isPath ? signedUrl : value;
  if (!href) return null;
  return <a href={href} target="_blank" rel="noreferrer" className={className}>{label}</a>;
}

// Origem legível de uma parcela (rótulo do tipo de OC · Nº · parcela), p/ o sublabel das
// linhas do dia. Serviços (calendário) não têm tipo_oc/ocs_* — caem no ramo _servico.
function parcelaOrigemLabel(p: Parcela): string {
  if ((p as any)._servico) return "Serviço · abrir na aba Serviços";
  const tipoLabel =
    p.tipo_oc === "tecido" ? "OC de Tecido"
    : p.tipo_oc === "aviamento" ? "OC de Aviamento"
    : p.tipo_oc === "etiqueta" ? "OC de Insumo"
    : p.tipo_oc === "p_acabado" ? "Produto Acabado"
    : (p.tipo_oc ?? "OC");
  const num = p.ocs_tecido?.numero_pedido ?? p.ocs_aviamento?.numero_pedido ?? p.ocs_etiqueta?.numero_pedido ?? p.ocs_p_acabado?.numero_pedido ?? "—";
  return `${tipoLabel} · Nº ${num} · parc. ${p.numero_parcela}`;
}

// Lista das parcelas de UM dia — cabeçalho (dia + total) + uma linha por parcela (tom+ícone,
// payee, origem, valor). Cada linha chama `onPick` (abre o detalhe = TODAS as ações da tela:
// marcar/desmarcar pago, abrir OC, comprovante). Compartilhada: popover do dia (desktop) e
// sheet do dia (mobile).
function DiaParcelasList({
  day, items, hoje, today, onPick,
}: {
  day: Date;
  items: Parcela[];
  hoje: string;
  today: Date;
  onPick: (p: Parcela) => void;
}) {
  const total = items.reduce((s, p) => s + Number(p.valor || 0), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2.5">
        <span className="text-sm font-semibold capitalize">{format(day, "EEEE, dd/MM/yyyy", { locale: ptBR })}</span>
        <span className="shrink-0 text-sm font-bold tabular-nums">{brl(total)}</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {items.map((p) => {
          const vis = parcelaVis(p, hoje, today);
          const nome = p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—";
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <VisBadgeIcon vis={vis} className="h-6 w-6 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{nome}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{parcelaOrigemLabel(p)}</span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums">{brl(Number(p.valor))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== LISTA ============================== */

// Célula de vencimento com estado local. Salva no onChange do DateField — que só
// EMITE quando o ISO está completo/válido (ou vazio), nunca a cada tecla. Antes salvava
// no blur do input, mas ESCOLHER no calendário não dispara blur (o foco fica no popover),
// então a data mudava na tela mas NÃO persistia e voltava ao antigo no próximo refetch.
function VencimentoCell({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const podeEditar = usePodeEditarFinanceiro();
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <DateField
      value={v}
      onChange={(e) => {
        const iso = e.target.value;
        setV(iso);
        if (iso && iso !== value) onSave(iso);
      }}
      className="w-36"
      disabled={!podeEditar || disabled}
    />
  );
}

function ListaView({ parcelas, loading, initialStatus }: { parcelas: Parcela[]; loading: boolean; initialStatus?: string }) {
  const qc = useQueryClient();
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const podeEditar = usePodeEditarFinanceiro();
  const [fornecedor, setFornecedor] = useState("all");
  const [status, setStatus] = useState(initialStatus ?? "all");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tipo, setTipo] = useState("all"); // separa OCs por tipo: tecido / aviamento / etiqueta(insumo)
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  const [ocView, setOcView] = useState<{ tipo: string; id: string } | null>(null);
  // Card/detalhe da parcela: a LINHA inteira abre (não só o nº do pedido).
  const [detalheId, setDetalheId] = useState<string | null>(null);
  // Realce transitório da linha recém-editada: como a lista é ordenada por
  // data_vencimento, mudar a data faz a linha SALTAR de posição no re-sort —
  // o realce ajuda o usuário a seguir para onde ela foi (e ver o novo status).
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const desmarcarMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("parcelas")
        .update({ status: "a_pagar", data_pagamento: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pagamento desmarcado");
      qc.invalidateQueries({ queryKey: ["parcelas"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar")),
  });

  const updateVencimentoMut = useMutation({
    // Só grava a DATA. O status "Vencido/A pagar" é DERIVADO da data (effectiveStatus),
    // então não precisa (e não deve) ser persistido aqui — evita falha de update.
    mutationFn: async ({ id, data }: { id: string; data: string }) => {
      const { error } = await supabase.from("parcelas").update({ data_vencimento: data } as any).eq("id", id);
      if (error) throw error;
    },
    // Atualização otimista: a badge recalcula na hora pela nova data.
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["parcelas"] });
      const prev = qc.getQueryData<any[]>(["parcelas"]);
      qc.setQueryData<any[]>(["parcelas"], (old) => (old ?? []).map((p) =>
        p.id === id ? { ...p, data_vencimento: data } : p));
      return { prev };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["parcelas"], ctx.prev);
      toast.error(mensagemErro(e, "Erro ao atualizar vencimento"));
    },
    onSuccess: (_data, vars) => {
      toast.success("Vencimento atualizado");
      setHighlightId(vars.id);
      setTimeout(() => setHighlightId((cur) => (cur === vars.id ? null : cur)), 2500);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcelas"] }),
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of parcelas) if (p.empresa_id) m.set(p.empresa_id, p.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [parcelas]);

  const filtered = useMemo(() => {
    return parcelas.filter((p) => {
      if (tipo !== "all" && p.tipo_oc !== tipo) return false;
      if (fornecedor !== "all" && p.empresa_id !== fornecedor) return false;
      if (status !== "all" && effectiveStatus(p, hoje) !== status) return false;
      if (dataIni && p.data_vencimento < dataIni) return false;
      if (dataFim && p.data_vencimento > dataFim) return false;
      return true;
    });
  }, [parcelas, tipo, fornecedor, status, dataIni, dataFim]);

  const ocNumero = (p: Parcela) => p.ocs_tecido?.numero_pedido ?? p.ocs_aviamento?.numero_pedido ?? p.ocs_etiqueta?.numero_pedido ?? p.ocs_p_acabado?.numero_pedido ?? "—";

  // Ordena pelo valor CRU (nº do pedido, valor numérico, data ISO de vencimento, etc.),
  // não pelo texto formatado exibido nas células.
  const sortState = useSort(filtered, {
    accessors: {
      fornecedor: (p: Parcela) => p.empresas?.nome ?? "",
      oc: (p: Parcela) => ocNumero(p),
      parcela: (p: Parcela) => p.numero_parcela,
      valor: (p: Parcela) => Number(p.valor),
      vencimento: (p: Parcela) => p.data_vencimento,
    },
  });
  const sorted = sortState.sorted;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Separa as OCs por tipo (Serviços têm aba própria). */}
        <div className="flex rounded-md border p-0.5 overflow-x-auto">
          {[
            { v: "all", l: "Todas" },
            { v: "tecido", l: "Tecidos" },
            { v: "aviamento", l: "Aviamentos" },
            { v: "etiqueta", l: "Insumos" },
            { v: "p_acabado", l: "Produto Acabado" },
          ].map((o) => (
            <Button key={o.v} size="sm" variant={tipo === o.v ? "secondary" : "ghost"} onClick={() => setTipo(o.v)}>{o.l}</Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        {/* Desktop: FilterButton (popover). Mobile: mesmo estado num bottom sheet 44px. */}
        <span className="hidden md:inline-flex">
        <FilterButton
          activeCount={[fornecedor !== "all", status !== "all", !!dataIni, !!dataFim].filter(Boolean).length}
          onClear={() => { setFornecedor("all"); setStatus("all"); setDataIni(""); setDataFim(""); }}
        >
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Select value={fornecedor} onValueChange={setFornecedor}>
                <SelectTrigger className={`h-8 text-sm ${filtroAtivoClass(fornecedor !== "all")}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className={`h-8 text-sm ${filtroAtivoClass(status !== "all")}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="a_pagar">A pagar</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <DateField value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <DateField value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
        </FilterButton>
        </span>
        <MobileFilterSheet
          className="md:hidden"
          activeCount={[fornecedor !== "all", status !== "all", !!dataIni, !!dataFim].filter(Boolean).length}
          onClear={() => { setFornecedor("all"); setStatus("all"); setDataIni(""); setDataFim(""); }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={fornecedor} onValueChange={setFornecedor}>
              <SelectTrigger className={`h-11 text-sm ${filtroAtivoClass(fornecedor !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <StatusFilterChips value={status} onChange={setStatus} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Vencimento</Label>
            <div className="flex gap-2">
              <DateField value={dataIni} onChange={(e) => setDataIni(e.target.value)} className="flex-1" />
              <DateField value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="flex-1" />
            </div>
          </div>
        </MobileFilterSheet>
        </div>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table fin-table">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <SortTh label="Empresa / Representante" sortKey="fornecedor" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Nº Pedido" sortKey="oc" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Parcela" sortKey="parcela" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Valor" sortKey="valor" sortState={sortState} className="py-2 pr-3 text-right" align="right" />
                <SortTh label="Vencimento" sortKey="vencimento" sortState={sortState} className="py-2 pr-3" />
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Pagamento</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const st = effectiveStatus(p, hoje);
                // Impede que clicar/teclar num controle interno (botão, data, link) também
                // abra o card da linha. Só o "espaço vazio" da linha abre o detalhe.
                const stop = (e: SyntheticEvent) => e.stopPropagation();
                return (
                  <tr
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Detalhes da parcela ${p.numero_parcela} de ${p.empresas?.nome ?? "—"}`}
                    onClick={() => setDetalheId(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetalheId(p.id); }
                    }}
                    className={`border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${p.id === highlightId ? "bg-primary/10" : ""}`}
                  >
                    <td className="py-2 pr-3">{p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—"}</td>
                    <td className="py-2 pr-3" data-label="Nº Pedido">
                      <span className="inline-flex items-center gap-2">
                        {(p.oc_tecido_id || p.oc_aviamento_id || p.oc_etiqueta_id || p.oc_p_acabado_id) ? (
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={(e) => { stop(e); setOcView({ tipo: p.tipo_oc, id: (p.oc_tecido_id ?? p.oc_aviamento_id ?? p.oc_etiqueta_id ?? p.oc_p_acabado_id)! }); }}
                          >
                            {ocNumero(p)}
                          </button>
                        ) : ocNumero(p)}
                        {p.ocBadge && <StatusBadge tone={p.ocBadge.tone}>{p.ocBadge.label}</StatusBadge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3" data-label="Parcela">{p.numero_parcela}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" data-label="Valor">{brl(Number(p.valor))}</td>
                    <td className="py-2 pr-3" data-label="Vencimento" onClick={stop} onKeyDown={stop}>
                      <VencimentoCell
                        value={p.data_vencimento}
                        onSave={(v) => updateVencimentoMut.mutate({ id: p.id, data: v })}
                        disabled={st === "pago"}
                      />
                    </td>
                    <td className="py-2 pr-3" data-label="Status">
                      <StatusParcelaBadge st={st} />
                    </td>
                    <td className="py-2 pr-3" data-label="Pagamento">{p.data_pagamento ? format(parseISO(p.data_pagamento), "dd/MM/yyyy") : "—"}</td>
                    <td className="py-2 pr-3" data-label="" onClick={stop} onKeyDown={stop}>
                      {podeEditar && (st !== "pago" ? (
                        <Button size="sm" onClick={() => setPagandoId(p.id)}>Marcar pago</Button>
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => desmarcarMut.mutate(p.id)} disabled={desmarcarMut.isPending}>Desmarcar</Button>
                      ))}
                      {p.comprovante_url && (
                        <ComprovanteLink value={p.comprovante_url} label="comprovante" className="text-xs text-primary ml-2" />
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Nenhuma parcela.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ParcelaDetailDialog
        parcela={detalheId ? filtered.find((p) => p.id === detalheId) ?? null : null}
        onClose={() => setDetalheId(null)}
        onMarkPaid={(id) => { setDetalheId(null); setPagandoId(id); }}
        onOpenOc={(tipo, id) => { setDetalheId(null); setOcView({ tipo, id }); }}
      />
      <PagarDialog parcelaId={pagandoId} onClose={() => setPagandoId(null)} />
      <OcViewDialog view={ocView} onClose={() => setOcView(null)} />

      {!ocView && !detalheId && <RelatorioPrint
        titulo="Contas a Pagar"
        subtitulo={`${filtered.length} parcela(s)${dataIni || dataFim ? ` · ${dataIni || "…"} a ${dataFim || "…"}` : ""}`}
        dataStr={new Date().toLocaleDateString("pt-BR")}
        kpis={[
          { label: "Total", valor: brl(filtered.reduce((s, p) => s + Number(p.valor || 0), 0)) },
          { label: "Vencido", valor: brl(filtered.filter((p) => effectiveStatus(p, hoje) === "vencido").reduce((s, p) => s + Number(p.valor || 0), 0)), cor: REL_COR_PERIGO },
          { label: "Pago", valor: brl(filtered.filter((p) => effectiveStatus(p, hoje) === "pago").reduce((s, p) => s + Number(p.valor || 0), 0)), cor: REL_COR_SUCESSO },
        ]}
        colunas={[
          { key: "fornecedor", label: "Fornecedor" },
          { key: "oc", label: "Nº Pedido" },
          { key: "parcela", label: "Parcela" },
          { key: "valor", label: "Valor", align: "right" },
          { key: "vencimento", label: "Vencimento" },
          { key: "status", label: "Status" },
          { key: "pagamento", label: "Pagamento" },
        ]}
        linhas={filtered.map((p) => ({
          fornecedor: p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—",
          oc: ocNumero(p),
          parcela: p.numero_parcela,
          valor: brl(Number(p.valor)),
          vencimento: p.data_vencimento ? p.data_vencimento.slice(0, 10).split("-").reverse().join("/") : "—",
          status: effectiveStatus(p, hoje) === "pago" ? "Pago" : effectiveStatus(p, hoje) === "vencido" ? "Vencido" : "A pagar",
          pagamento: p.data_pagamento ? p.data_pagamento.slice(0, 10).split("-").reverse().join("/") : "—",
        }))}
        rodape={`Total: ${brl(filtered.reduce((s, p) => s + Number(p.valor || 0), 0))}`}
      />}
    </div>
  );
}

/* ===== Aba Serviços: parcelas de serviço (Terceirizados) a pagar ===== */

function ServicosView() {
  const qc = useQueryClient();
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const podeEditar = usePodeEditarFinanceiro();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["servicos-financeiro", "lista"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("servicos_financeiro" as any);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Filtro por FORNECEDOR (empresa). Antes filtrava por "responsável" (texto legado);
  // agora o dono quer ver empresa/representante. Filtra pelo nome da empresa, com
  // fallback ao `responsavel` quando a parcela não tem empresa (dado legado).
  const [fornecedor, setFornecedor] = useState("all");
  const [status, setStatus] = useState("all");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [detalhe, setDetalhe] = useState<any | null>(null);
  const [pagandoId, setPagandoId] = useState<string | null>(null);

  const stOf = (r: any) => {
    if (r.status === "pago" || r.data_pagamento) return "pago";
    if (r.data_vencimento && r.data_vencimento < hoje) return "vencido";
    return "a_pagar";
  };
  const fmtD = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
  // Chave/rótulo da empresa da parcela (fallback ao responsável legado).
  const empresaDe = (r: any) => (r.empresa_nome ?? r.responsavel ?? "—") as string;

  const fornecedores = useMemo(
    () => Array.from(new Set(rows.map(empresaDe).filter((n) => n && n !== "—"))) as string[],
    [rows],
  );
  const filtered = useMemo(() => rows.filter((r) => {
    if (fornecedor !== "all" && empresaDe(r) !== fornecedor) return false;
    if (status !== "all" && stOf(r) !== status) return false;
    if (dataIni && (r.data_vencimento ?? "") < dataIni) return false;
    if (dataFim && (r.data_vencimento ?? "") > dataFim) return false;
    return true;
  }), [rows, fornecedor, status, dataIni, dataFim]);

  const updVenc = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: string }) => {
      const { error } = await supabase.from("parcelas_servico" as any).update({ data_vencimento: data || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["servicos-financeiro"] }),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar vencimento")),
  });
  const togglePago = useMutation({
    mutationFn: async ({ id, pago }: { id: string; pago: boolean }) => {
      const payload = pago ? { status: "pago", data_pagamento: hoje } : { status: "a_pagar", data_pagamento: null };
      const { error } = await supabase.from("parcelas_servico" as any).update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["servicos-financeiro"] }); toast.success("Atualizado"); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });
  // Data de pagamento editável: informar a data marca como pago (e registra QUANDO foi pago).
  const updPag = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: string }) => {
      const { error } = await supabase.from("parcelas_servico" as any)
        .update({ data_pagamento: data || null, status: data ? "pago" : "a_pagar" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["servicos-financeiro"] }); toast.success("Pagamento atualizado"); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar pagamento")),
  });

  const total = filtered.reduce((s, r) => s + Number(r.valor_parcela || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <span className="hidden md:inline-flex">
        <FilterButton
          activeCount={[fornecedor !== "all", status !== "all", !!dataIni, !!dataFim].filter(Boolean).length}
          onClear={() => { setFornecedor("all"); setStatus("all"); setDataIni(""); setDataFim(""); }}
        >
          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Fornecedor</Label>
              <Select value={fornecedor} onValueChange={setFornecedor}>
                <SelectTrigger className={`h-8 text-sm ${filtroAtivoClass(fornecedor !== "all")}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {fornecedores.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className={`h-8 text-sm ${filtroAtivoClass(status !== "all")}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="a_pagar">A pagar</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <DateField value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <DateField value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>
        </FilterButton>
        </span>
        <MobileFilterSheet
          className="md:hidden"
          activeCount={[fornecedor !== "all", status !== "all", !!dataIni, !!dataFim].filter(Boolean).length}
          onClear={() => { setFornecedor("all"); setStatus("all"); setDataIni(""); setDataFim(""); }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={fornecedor} onValueChange={setFornecedor}>
              <SelectTrigger className={`h-11 text-sm ${filtroAtivoClass(fornecedor !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fornecedores.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <StatusFilterChips value={status} onChange={setStatus} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Vencimento</Label>
            <div className="flex gap-2">
              <DateField value={dataIni} onChange={(e) => setDataIni(e.target.value)} className="flex-1" />
              <DateField value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="flex-1" />
            </div>
          </div>
        </MobileFilterSheet>
      </div>
      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table fin-table">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Serviço</th>
                <th className="py-2 pr-3">Empresa / Representante</th>
                <th className="py-2 pr-3">Parcela</th>
                <th className="py-2 pr-3 text-right">Valor parcela</th>
                <th className="py-2 pr-3">Vencimento</th>
                <th className="py-2 pr-3">Pagamento</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = stOf(r);
                const stop = (e: SyntheticEvent) => e.stopPropagation();
                return (
                  <tr
                    key={r.parcela_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Detalhes do serviço ${r.servico} — parcela ${r.numero_parcela}/${r.numero_parcelas}`}
                    onClick={() => setDetalhe(r)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetalhe(r); } }}
                    className="border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  >
                    <td className="py-2 pr-3">{r.servico}{r.ref ? ` · ${r.ref}` : ""}</td>
                    <td className="py-2 pr-3" data-label="Empresa / Representante">
                      {r.representante_nome ?? r.empresa_nome ?? r.responsavel ?? "—"}
                    </td>
                    <td className="py-2 pr-3" data-label="Parcela">{r.numero_parcela}/{r.numero_parcelas}</td>
                    <td className="py-2 pr-3 text-right font-medium tabular-nums" data-label="Valor parcela">{brl(Number(r.valor_parcela))}</td>
                    <td className="py-2 pr-3" data-label="Vencimento" onClick={stop} onKeyDown={stop}>
                      <VencimentoCell value={r.data_vencimento ?? ""} onSave={(data) => updVenc.mutate({ id: r.parcela_id, data })} disabled={st === "pago"} />
                    </td>
                    <td className="py-2 pr-3" data-label="Pagamento" onClick={stop} onKeyDown={stop}>
                      <VencimentoCell value={r.data_pagamento ?? ""} onSave={(data) => updPag.mutate({ id: r.parcela_id, data })} />
                    </td>
                    <td className="py-2 pr-3" data-label="Status">
                      <StatusParcelaBadge st={st} />
                    </td>
                    <td className="py-2 pr-3" data-label="" onClick={stop} onKeyDown={stop}>
                      {podeEditar && (st === "pago" ? (
                        <Button size="sm" variant="destructive" onClick={() => togglePago.mutate({ id: r.parcela_id, pago: false })} disabled={togglePago.isPending}>Desmarcar</Button>
                      ) : (
                        <Button size="sm" onClick={() => setPagandoId(r.parcela_id)}>Marcar pago</Button>
                      ))}
                      {r.comprovante_url && (
                        <ComprovanteLink value={r.comprovante_url} label="comprovante" className="text-xs text-primary ml-2" />
                      )}
                    </td>
                  </tr>
                );
              })}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Nenhum serviço a pagar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <p className="mt-3 text-sm text-right text-muted-foreground">Total a pagar (parcelas): <b className="text-foreground">{brl(total)}</b></p>
        )}
      </Card>

      <ServicoDetailDialog
        row={detalhe}
        stLabel={detalhe ? (stOf(detalhe) === "a_pagar" ? "A pagar" : stOf(detalhe) === "pago" ? "Pago" : "Vencido") : ""}
        stVariant={detalhe ? (stOf(detalhe) === "pago" ? "default" : stOf(detalhe) === "vencido" ? "destructive" : "secondary") : "secondary"}
        fmtD={fmtD}
        canPay={podeEditar}
        onTogglePago={(pago) => {
          if (!detalhe) return;
          if (pago) { setPagandoId(detalhe.parcela_id); setDetalhe(null); }
          else togglePago.mutate({ id: detalhe.parcela_id, pago: false });
        }}
        toggling={togglePago.isPending}
        onClose={() => setDetalhe(null)}
      />
      <PagarDialog
        parcelaId={pagandoId}
        table="parcelas_servico"
        invalidateKey={["servicos-financeiro"]}
        onClose={() => setPagandoId(null)}
      />

      <RelatorioPrint
        titulo="Serviços a Pagar"
        subtitulo={`${filtered.length} parcela(s) de serviço`}
        dataStr={new Date().toLocaleDateString("pt-BR")}
        kpis={[
          { label: "Total a pagar", valor: brl(total) },
          { label: "Parcelas", valor: String(filtered.length) },
          { label: "Pagas", valor: String(filtered.filter((r) => stOf(r) === "pago").length), cor: REL_COR_SUCESSO },
        ]}
        colunas={[
          { key: "servico", label: "Serviço" },
          { key: "empresa", label: "Empresa / Representante" },
          { key: "parcela", label: "Parcela" },
          { key: "bruto", label: "Bruto", align: "right" },
          { key: "desconto", label: "Desconto", align: "right" },
          { key: "multa", label: "Multa", align: "right" },
          { key: "liquido", label: "Líquido", align: "right" },
          { key: "valor", label: "Valor parcela", align: "right" },
          { key: "entrega", label: "Entrega" },
          { key: "vencimento", label: "Vencimento" },
          { key: "status", label: "Status" },
        ]}
        linhas={filtered.map((r) => ({
          servico: `${r.servico}${r.ref ? ` · ${r.ref}` : ""}`,
          empresa: r.representante_nome ? `${r.empresa_nome ?? r.responsavel ?? "—"} · via ${r.representante_nome}` : (r.empresa_nome ?? r.responsavel ?? "—"),
          parcela: `${r.numero_parcela}/${r.numero_parcelas}`,
          bruto: brl(Number(r.custo_bruto)),
          desconto: brl(Number(r.desconto)),
          multa: brl(Number(r.multa)),
          liquido: brl(Number(r.custo_liquido)),
          valor: brl(Number(r.valor_parcela)),
          entrega: fmtD(r.data_entrega),
          vencimento: fmtD(r.data_vencimento),
          status: stOf(r) === "pago" ? "Pago" : stOf(r) === "vencido" ? "Vencido" : "A pagar",
        }))}
        rodape={`Total: ${brl(total)}`}
      />
    </div>
  );
}

/* ===== Card/detalhe de uma parcela de SERVIÇO (terceirizado) ===== */

function ServicoDetailDialog({
  row, stLabel, stVariant, fmtD, canPay, onTogglePago, toggling, onClose,
}: {
  row: any | null;
  stLabel: string;
  stVariant: "default" | "destructive" | "secondary";
  fmtD: (d: string | null) => string;
  canPay: boolean;
  onTogglePago: (pago: boolean) => void;
  toggling: boolean;
  onClose: () => void;
}) {
  if (!row) return null;
  // O payee é o representante (se houver) ou a empresa. Mostra o CNPJ do payee.
  const temRep = !!row.representante_nome;
  const payeeCnpj = temRep ? (row.representante_cnpj ?? null) : (row.empresa_cnpj ?? null);
  const isPago = stLabel === "Pago";
  const stRaw: "pago" | "vencido" | "a_pagar" = isPago ? "pago" : stLabel === "Vencido" ? "vencido" : "a_pagar";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Detalhes do Serviço</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div><span className="text-muted-foreground">Serviço:</span> <b>{row.servico}</b>{row.ref ? ` · ${row.ref}` : ""}</div>
          {row.modelo_nome && (
            <div><span className="text-muted-foreground">Modelo:</span> {row.modelo_nome}</div>
          )}
          <div><span className="text-muted-foreground">Empresa:</span> <b>{row.empresa_nome ?? row.responsavel ?? "—"}</b></div>
          {temRep && (
            <div><span className="text-muted-foreground">Representante:</span> <b>{row.representante_nome}</b></div>
          )}
          <div><span className="text-muted-foreground">CNPJ{temRep ? " (representante)" : ""}:</span> {payeeCnpj ?? "—"}</div>
          <div className="mt-2 border-t pt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Bruto:</span> {brl(Number(row.custo_bruto))}</div>
            <div><span className="text-muted-foreground">Desconto:</span> {brl(Number(row.desconto))}</div>
            <div><span className="text-muted-foreground">Multa:</span> {brl(Number(row.multa))}</div>
            <div><span className="text-muted-foreground">Líquido:</span> {brl(Number(row.custo_liquido))}</div>
          </div>
          <div className="border-t pt-2">
            <span className="text-muted-foreground">Parcela:</span> {row.numero_parcela}/{row.numero_parcelas} ·{" "}
            <span className="text-muted-foreground">Valor:</span> <b>{brl(Number(row.valor_parcela))}</b>
          </div>
          <div><span className="text-muted-foreground">Entrega:</span> {fmtD(row.data_entrega)}</div>
          <div><span className="text-muted-foreground">Vencimento:</span> {fmtD(row.data_vencimento)}</div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <StatusParcelaBadge st={stRaw} />
          </div>
          {row.data_pagamento && (
            <div><span className="text-muted-foreground">Pago em:</span> {fmtD(row.data_pagamento)}</div>
          )}
          {row.comprovante_url && (
            <div><ComprovanteLink value={row.comprovante_url} label="Ver comprovante" className="text-primary" /></div>
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2">
          {canPay && (isPago ? (
            <Button size="sm" variant="destructive" onClick={() => onTogglePago(false)} disabled={toggling}>Desmarcar pago</Button>
          ) : (
            <Button size="sm" onClick={() => onTogglePago(true)} disabled={toggling}>Marcar pago</Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ===== Janela read-only da OC (acessível pelas parcelas) ===== */

function OcViewDialog({ view, onClose }: { view: { tipo: string; id: string } | null; onClose: () => void }) {
  const { data: oc, isLoading } = useQuery({
    queryKey: ["oc-view", view?.tipo, view?.id],
    enabled: !!view?.id,
    queryFn: async () => {
      if (view!.tipo === "tecido") {
        const { data } = await supabase
          .from("ocs_tecido")
          .select("*, empresas:empresa_id(nome_fantasia), ocs_tecido_itens(quantidade_pedida, quantidade_recebida, artigos:artigo_id(nome), variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
          .eq("id", view!.id)
          .maybeSingle();
        return data as any;
      }
      if (view!.tipo === "etiqueta") {
        const { data } = await supabase
          .from("ocs_etiqueta" as any)
          .select("*, empresas:empresa_id(nome_fantasia), ocs_etiqueta_itens(quantidade_pedida, quantidade_recebida, etiquetas:etiqueta_id(nome), variantes_etiqueta:variante_etiqueta_id(tamanho, cor:cor_id(nome)))")
          .eq("id", view!.id)
          .maybeSingle();
        return data as any;
      }
      if (view!.tipo === "p_acabado") {
        // Fora do types.ts (feature Revenda). Sem tabela de itens filha — a grade mora em
        // `grade_detalhe` jsonb ({ordem:{tamanho:{pedida,recebida,defeito}}}); `numero`/
        // `data_prevista` são aliased pra `numero_pedido`/`data_prevista_entrega` (nomes
        // genéricos usados pelo resto deste componente p/ tecido/aviamento/etiqueta).
        const { data } = await supabase
          .from("ocs_p_acabado" as any)
          .select("*, empresas:empresa_id(nome_fantasia)")
          .eq("id", view!.id)
          .maybeSingle();
        if (!data) return null;
        const d = data as any;
        return { ...d, numero_pedido: d.numero, data_prevista_entrega: d.data_prevista } as any;
      }
      const { data } = await supabase
        .from("ocs_aviamento")
        .select("*, empresas:empresa_id(nome_fantasia), ocs_aviamento_itens(quantidade_pedida, quantidade_recebida, aviamentos:aviamento_id(codigo_nome))")
        .eq("id", view!.id)
        .maybeSingle();
      return data as any;
    },
  });

  // p_acabado não tem tabela de itens filha: achata `grade_detalhe` (ordem×tamanho) em
  // linhas {pedida,recebida} — mesmo shape {quantidade_pedida,quantidade_recebida} das demais.
  const itensPAcabado = useMemo(() => {
    if (view?.tipo !== "p_acabado" || !oc?.grade_detalhe) return [];
    return Object.entries(oc.grade_detalhe as Record<string, Record<string, { pedida?: number; recebida?: number }>>)
      .flatMap(([ordem, porTamanho]) =>
        Object.entries(porTamanho ?? {}).map(([tamanho, g]) => ({
          _nome: `${oc?.nome_produto ?? "—"} · variante ${ordem}${tamanho && tamanho !== "UN" ? ` · ${tamanho}` : ""}`,
          quantidade_pedida: Number(g?.pedida ?? 0),
          quantidade_recebida: Number(g?.recebida ?? 0),
        })),
      );
  }, [view?.tipo, oc]);

  const itens: any[] = view?.tipo === "tecido" ? (oc?.ocs_tecido_itens ?? []) : view?.tipo === "etiqueta" ? (oc?.ocs_etiqueta_itens ?? []) : view?.tipo === "p_acabado" ? itensPAcabado : (oc?.ocs_aviamento_itens ?? []);
  const tipoTxt = view?.tipo === "tecido" ? "de Tecido" : view?.tipo === "etiqueta" ? "de Insumo" : view?.tipo === "p_acabado" ? "de Produto Acabado" : "de Aviamento";
  const itemNome = (it: any) =>
    view?.tipo === "tecido"
      ? `${it.artigos?.nome ?? "—"}${it.variantes_tecido?.cor?.nome ? ` · ${corApelidoLabel(it.variantes_tecido.cor.nome, it.variantes_tecido.apelido?.nome)}` : it.variantes_tecido?.nome_variante ? ` · ${it.variantes_tecido.nome_variante}` : ""}`
      : view?.tipo === "etiqueta"
        ? [it.etiquetas?.nome ?? "—", it.variantes_etiqueta?.cor?.nome, it.variantes_etiqueta?.tamanho?.replace("|", " ")].filter(Boolean).join(" · ")
        : view?.tipo === "p_acabado"
          ? (it._nome ?? "—")
          : (it.aviamentos?.codigo_nome ?? "—");
  const fmtD = (d: string | null) => (d ? format(parseISO(d), "dd/MM/yyyy") : "—");

  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            OC {tipoTxt} {oc?.numero_pedido ? `· Nº ${oc.numero_pedido}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && oc && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Fornecedor:</span> <b>{oc.empresas?.nome_fantasia ?? "—"}</b></div>
              <div><span className="text-muted-foreground">Status:</span> {oc.status ?? "—"}</div>
              <div><span className="text-muted-foreground">Data do Pedido:</span> {fmtD(oc.data_pedido)}</div>
              <div><span className="text-muted-foreground">Prevista:</span> {fmtD(oc.data_prevista_entrega)}</div>
              <div><span className="text-muted-foreground">Entrega:</span> {fmtD(oc.data_entrega)}</div>
              <div><span className="text-muted-foreground">Prazo de Pagamento:</span> {oc.prazo_pagamento ?? "—"}</div>
            </div>
            <div className="border-t pt-2">
              <p className="font-medium mb-1">Itens</p>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-2">Item</th>
                      <th className="py-1 pr-2 text-right">Pedida</th>
                      <th className="py-1 pr-2 text-right">Recebida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.length === 0 && (
                      <tr><td colSpan={3} className="py-2 text-muted-foreground">Sem itens.</td></tr>
                    )}
                    {itens.map((it, i) => {
                      const nome = itemNome(it);
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 pr-2">{nome}</td>
                          <td className="py-1 pr-2 text-right">{Number(it.quantidade_pedida ?? 0)}</td>
                          <td className="py-1 pr-2 text-right">{Number(it.quantidade_recebida ?? 0)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {!isLoading && !oc && <p className="text-sm text-muted-foreground">OC não encontrada.</p>}

        {!isLoading && oc && (
          <RelatorioPrint
            titulo={`Extrato da OC ${tipoTxt}${oc.numero_pedido ? ` · Nº ${oc.numero_pedido}` : ""}`}
            subtitulo={`Fornecedor: ${oc.empresas?.nome_fantasia ?? "—"} · Pedido: ${fmtD(oc.data_pedido)} · Entrega: ${fmtD(oc.data_entrega)} · Prazo: ${oc.prazo_pagamento ?? "—"}`}
            dataStr={new Date().toLocaleDateString("pt-BR")}
            colunas={[
              { key: "item", label: "Item" },
              { key: "pedida", label: "Pedida", align: "right" },
              { key: "recebida", label: "Recebida", align: "right" },
            ]}
            linhas={itens.map((it) => ({
              item: itemNome(it),
              pedida: String(Number(it.quantidade_pedida ?? 0)),
              recebida: String(Number(it.quantidade_recebida ?? 0)),
            }))}
          />
        )}

        <DialogFooter>
          {!isLoading && oc && (
            <Button variant="outline" className="hidden md:inline-flex" onClick={() => printWithImages()}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PagarDialog({ parcelaId, onClose, table = "parcelas", invalidateKey = ["parcelas"] }: { parcelaId: string | null; onClose: () => void; table?: string; invalidateKey?: (string | number)[] }) {
  const qc = useQueryClient();
  const podeEditar = usePodeEditarFinanceiro();
  const [dataPag, setDataPag] = useState(todayISOInStoreTZ(useStoreTimezone()));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const mut = useMutation({
    mutationFn: async () => {
      if (!parcelaId) return;
      setUploading(true);
      let path: string | null = null;
      if (file) {
        const { tenantPrefix } = await import("@/lib/storage-tenant");
        const tenant = await tenantPrefix();
        const ext = file.name.split(".").pop() ?? "bin";
        path = `${tenant}/${parcelaId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprovantes").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
      }
      const { error } = await supabase
        .from(table as any)
        .update({ status: "pago", data_pagamento: dataPag, ...(path ? { comprovante_url: path } : {}) })
        .eq("id", parcelaId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Parcela marcada como paga");
      qc.invalidateQueries({ queryKey: invalidateKey });
      setFile(null);
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
    onSettled: () => setUploading(false),
  });

  return (
    <Dialog open={!!parcelaId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Marcar como pago</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Data do pagamento</Label>
            <DateField value={dataPag} onChange={(e) => setDataPag(e.target.value)} />
          </div>
          <div>
            <Label>Comprovante (opcional)</Label>
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="text-xs text-muted-foreground mt-1"><Upload className="inline h-3 w-3 mr-1" />{file.name}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button onClick={() => mut.mutate()} disabled={uploading || mut.isPending || !podeEditar}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== RESUMO ============================== */

type StatusSel = "a_pagar" | "pago" | "vencido";

function ResumoView({ parcelas, servicos }: { parcelas: Parcela[]; servicos: Parcela[] }) {
  const hoje = todayISOInStoreTZ(useStoreTimezone());
  const [fFornecedor, setFFornecedor] = useState("all");
  const [fMes, setFMes] = useState("");   // yyyy-MM
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const [selected, setSelected] = useState<StatusSel | null>(null);
  const [fOrigem, setFOrigem] = useState<string>("all"); // all | tecido | aviamento | etiqueta | servico

  // Parcelas de OC + parcelas de serviço (terceirizados) num só conjunto: o Resumo
  // contabiliza AMBOS (antes só somava as de OC, por isso os serviços não apareciam).
  // Serviços (servicosCal) já chegam com data_vencimento garantida e sem empresa_id
  // (o filtro por fornecedor naturalmente os ignora — serviços usam "responsável").
  // Cada item ganha `_origem` p/ separar o Resumo por tipo: as OCs pelo seu `tipo_oc`
  // (tecido/aviamento/etiqueta=Insumo) e os terceirizados como "servico".
  const items = useMemo(() => [
    ...parcelas.map((p) => ({ ...p, _origem: (p.tipo_oc || "oc") as string })),
    ...servicos.map((p) => ({ ...p, _origem: "servico" as string })),
  ], [parcelas, servicos]);

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of items) if (p.empresa_id) m.set(p.empresa_id, p.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [items]);

  // Conjunto-base após os filtros (fornecedor, mês, intervalo de datas).
  const base = useMemo(() => items.filter((p) => {
    if (fOrigem !== "all" && p._origem !== fOrigem) return false;
    if (fFornecedor !== "all" && p.empresa_id !== fFornecedor) return false;
    if (fMes && p.data_vencimento.slice(0, 7) !== fMes) return false;
    if (fDe && p.data_vencimento < fDe) return false;
    if (fAte && p.data_vencimento > fAte) return false;
    return true;
  }), [items, fOrigem, fFornecedor, fMes, fDe, fAte]);

  const sumBy = (st: StatusSel) => base.filter((p) => effectiveStatus(p, hoje) === st).reduce((s, p) => s + Number(p.valor), 0);
  const totalAPagar = sumBy("a_pagar");
  const totalPago = sumBy("pago");
  const totalVencido = sumBy("vencido");
  // Mobile "resumo primeiro": contagens + próximas parcelas (não-pagas, mais urgentes primeiro).
  const today = new Date();
  const countBy = (st: StatusSel) => base.filter((p) => effectiveStatus(p, hoje) === st).length;
  const countAPagar = countBy("a_pagar");
  const countVencido = countBy("vencido");
  const proximas = useMemo(
    () => base.filter((p) => effectiveStatus(p, hoje) !== "pago")
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento))
      .slice(0, 6),
    [base, hoje],
  );

  const chartData = useMemo(() => {
    const m = new Map<string, { mes: string; ord: string; pago: number; a_pagar: number; vencido: number }>();
    for (const p of base) {
      const k = p.data_vencimento.slice(0, 7);
      let row = m.get(k);
      if (!row) {
        row = { mes: format(parseLocalDate(p.data_vencimento), "MMM/yy", { locale: ptBR }), ord: k, pago: 0, a_pagar: 0, vencido: 0 };
        m.set(k, row);
      }
      row[effectiveStatus(p, hoje)] += Number(p.valor);
    }
    return Array.from(m.values()).sort((a, b) => a.ord.localeCompare(b.ord));
  }, [base]);

  const activeCount = (fFornecedor !== "all" ? 1 : 0) + (fMes ? 1 : 0) + (fDe ? 1 : 0) + (fAte ? 1 : 0);
  const clearFilters = () => { setFFornecedor("all"); setFMes(""); setFDe(""); setFAte(""); };
  const toggle = (s: StatusSel) => setSelected((cur) => (cur === s ? null : s));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Origem: ver o gráfico + totais por OC, por Serviço, ou ambos. */}
        <div className="mr-auto flex rounded-md border p-0.5 overflow-x-auto">
          {([["all", "Todos"], ["tecido", "Tecidos"], ["aviamento", "Aviamentos"], ["etiqueta", "Insumos"], ["p_acabado", "Produto Acabado"], ["servico", "Serviços"]] as const).map(([o, lbl]) => (
            <Button key={o} type="button" size="sm" variant={fOrigem === o ? "secondary" : "ghost"} className="h-7 px-3 text-xs" onClick={() => setFOrigem(o)}>
              {lbl}
            </Button>
          ))}
        </div>
        <span className="hidden md:inline-flex">
        <FilterButton activeCount={activeCount} onClear={clearFilters}>
          <div className="grid gap-1">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={fFornecedor} onValueChange={setFFornecedor}>
              <SelectTrigger className={`h-8 text-sm ${filtroAtivoClass(fFornecedor !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Mês</Label>
            <Input type="month" className={`h-8 text-sm ${filtroAtivoClass(!!fMes)}`} value={fMes} onChange={(e) => setFMes(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">De</Label>
            <DateField value={fDe} onChange={(e) => setFDe(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Até</Label>
            <DateField value={fAte} onChange={(e) => setFAte(e.target.value)} />
          </div>
        </FilterButton>
        </span>
        <MobileFilterSheet className="md:hidden" activeCount={activeCount} onClear={clearFilters}>
          <div className="space-y-1.5">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={fFornecedor} onValueChange={setFFornecedor}>
              <SelectTrigger className={`h-11 text-sm ${filtroAtivoClass(fFornecedor !== "all")}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mês</Label>
            <Input type="month" className={`h-11 text-sm ${filtroAtivoClass(!!fMes)}`} value={fMes} onChange={(e) => setFMes(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Vencimento</Label>
            <div className="flex gap-2">
              <DateField value={fDe} onChange={(e) => setFDe(e.target.value)} className="flex-1" />
              <DateField value={fAte} onChange={(e) => setFAte(e.target.value)} className="flex-1" />
            </div>
          </div>
        </MobileFilterSheet>
      </div>

      {/* Mobile: resumo primeiro (Wroblewski) — total pendente + Vencido/A vencer + próximas.
          Os 3 cards interativos + gráfico ficam no ≥md. */}
      <div className="md:hidden space-y-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total pendente</div>
          <div className="mt-0.5 text-3xl font-bold tabular-nums">{brl(totalAPagar + totalVencido)}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--tone-danger-fg)]" aria-hidden /> Vencido
              </div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-[var(--tone-danger-fg)]">{brlAbrev(totalVencido)}</div>
              <div className="text-[11px] text-muted-foreground">{countVencido} parcela{countVencido === 1 ? "" : "s"}</div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Circle className="h-3.5 w-3.5 fill-current text-muted-foreground" aria-hidden /> A vencer
              </div>
              <div className="mt-0.5 text-base font-bold tabular-nums">{brlAbrev(totalAPagar)}</div>
              <div className="text-[11px] text-muted-foreground">{countAPagar} parcela{countAPagar === 1 ? "" : "s"}</div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <div className="text-xs text-muted-foreground">Total pago</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-[var(--tone-success-fg)]">{brl(totalPago)}</div>
        </div>
        {proximas.length > 0 && (
          <div>
            <div className="px-0.5 pb-1 pt-1 text-xs font-bold text-muted-foreground">Próximas parcelas</div>
            <div className="space-y-2">
              {proximas.map((p) => {
                const vis = parcelaVis(p, hoje, today);
                const nome = p.representanteNome ?? p.empresaNome ?? p.empresas?.nome ?? "—";
                return (
                  <div key={p.id} className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5">
                    <VisBadgeIcon vis={vis} className="h-7 w-7 shrink-0" />
                    <span className="w-11 shrink-0 text-sm font-bold tabular-nums">{format(parseLocalDate(p.data_vencimento), "dd/MM")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{nome}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{parcelaOrigemLabel(p)}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{brl(Number(p.valor))}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="hidden gap-4 sm:grid-cols-3 md:grid">
        <SummaryCard title="Total a pagar" value={brl(totalAPagar)} accent="text-[var(--tone-warning-fg)]"
          active={selected === "a_pagar"} onClick={() => toggle("a_pagar")} />
        <SummaryCard title="Total pago" value={brl(totalPago)} accent="text-[var(--tone-success-fg)]"
          active={selected === "pago"} onClick={() => toggle("pago")} />
        <SummaryCard title="Total vencido" value={brl(totalVencido)} accent="text-[var(--tone-danger-fg)]"
          active={selected === "vencido"} onClick={() => toggle("vencido")} />
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Evolução mensal</h3>
          {selected && (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(null)}>
              Mostrar todos
            </button>
          )}
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => fmtInt(Number(v))} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
              <Legend />
              {/* Status = tom semântico §Q9 (pago=sucesso · a pagar=alerta · vencido=perigo),
                  via token — nunca hsl solto (anti-drift regra f). O nome de cada série na
                  legenda dá o rótulo (cor nunca é o único sinal). */}
              {(!selected || selected === "pago") && <Bar dataKey="pago" name="Pago" fill="var(--success)" />}
              {(!selected || selected === "a_pagar") && <Bar dataKey="a_pagar" name="A pagar" fill="var(--warning)" />}
              {(!selected || selected === "vencido") && <Bar dataKey="vencido" name="Vencido" fill="var(--destructive)" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({ title, value, accent, active, onClick }: { title: string; value: string; accent: string; active?: boolean; onClick?: () => void }) {
  return (
    <Card
      className={cn("p-5", onClick && "cursor-pointer transition-shadow hover:shadow-md", active && "ring-2 ring-primary")}
      onClick={onClick}
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className={cn("text-2xl font-bold mt-1 tabular-nums", accent)}>{value}</p>
    </Card>
  );
}
