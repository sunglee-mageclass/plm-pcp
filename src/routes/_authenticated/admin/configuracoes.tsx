import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Plus, GripVertical, Trash2, Save, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TIMEZONE_OPTIONS } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { resolveStatusKey } from "@/lib/kanban-status";
import { isServicoConfeccao } from "@/lib/servico-confeccao";
import { RequisitosStatusButton } from "@/components/admin/RequisitosStatusDialog";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: ConfiguracoesLojaPage,
});

const FIELD_LABEL_DEFAULTS: Record<string, string> = {
  colecao: "Coleção",
  ref: "REF",
  estilista: "Estilista",
  modelista: "Modelista",
  piloteiro: "Piloteiro",
  linha: "Linha",
};

// Campos personalizáveis que aparecem em cada módulo (chaves de campos_editaveis).
const MODULE_FIELD_KEYS: Record<string, string[]> = {
  cadastro: ["colecao", "ref", "linha"],
  criacao: ["colecao", "ref", "linha", "estilista", "modelista", "piloteiro"],
  producao: ["ref", "colecao", "linha"],
  entrada_saida: [],
  financeiro: [],
  dashboard: [],
};

const DEFAULTS = {
  timezone: "America/Sao_Paulo" as string,
  etapas_acabamento: ["Caseado", "Botão", "Passadoria"],
  tamanhos_grade: ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"],
  status_kanban: [
    "Em Modelagem",
    "Corte de Piloto I",
    "Corte de Piloto II",
    "Corte de Piloto III",
    "Em Pilotagem",
    "Prova de Roupa I",
    "Prova de Roupa II",
    "Prova de Roupa III",
    "Prova de Roupa IV",
    "Prova de Roupa V",
    "Em Ajuste",
    "Stand By",
    "Reprovado",
    "Aprovado",
  ],
  campos_editaveis: {} as Record<string, string>,
  modo_baixa_estoque: "por_oc" as "por_oc" | "automatico",
  modo_oc_rolo: "ambos" as "oc" | "rolo" | "ambos",
  // Requisitos de entrada por status do kanban: { status_key: [chave_condicao] }.
  kanban_requisitos: {} as Record<string, string[]>,
  // Leadtime: etapas acompanhadas na aba Leadtime do Dashboard + ideal (dias) de cada.
  // Vazio = a aba mostra TODAS as etapas com o default. Ordem = ordem de exibição.
  // slaServico = etapa cujo prazo (na matriz do Leadtime) vem do "SLA de Serviços" da
  // Subcategoria 1 do item (servicos = bloco todo, ou servico_cat:<id> de confecção). null = off.
  leadtime: {
    etapas: [] as { key: string; tipo: "macro" | "kanban" | "servico"; idealDias: number }[],
    slaServico: null as string | null,
  },
};

type ConfigState = typeof DEFAULTS;

const MODULE_LABELS: { key: string; label: string }[] = [
  { key: "cadastro", label: "Cadastro" },
  { key: "criacao", label: "Criação" },
  { key: "otb", label: "OTB" },
  { key: "entrada_saida", label: "Entrada e Saída" },
  { key: "producao", label: "Produção" },
  { key: "financeiro", label: "Financeiro" },
  { key: "dashboard", label: "Dashboard" },
];

function ConfiguracoesLojaPage() {
  const { user, isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const { modules, isStockOnly } = useTenantModules();
  const [cfg, setCfg] = useState<ConfigState>(DEFAULTS);
  // Salvar configurações afeta dados de toda a loja (modo OC/Rolo, grade, kanban,
  // acabamento, baixa) — confirma antes de gravar.
  const [confirmSalvar, setConfirmSalvar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-config", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: u } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      const tenantId = u?.tenant_id;
      if (!tenantId) return { tenantId: null, cfg: null };
      const { data: row } = await supabase
        .from("tenant_config")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return { tenantId, cfg: row };
    },
  });

  useEffect(() => {
    if (!data?.cfg) return;
    const r = data.cfg as any;
    setCfg({
      timezone: r.timezone ?? DEFAULTS.timezone,
      etapas_acabamento: Array.isArray(r.etapas_acabamento)
        ? r.etapas_acabamento
        : DEFAULTS.etapas_acabamento,
      tamanhos_grade: Array.isArray(r.tamanhos_grade)
        ? r.tamanhos_grade
        : DEFAULTS.tamanhos_grade,
      status_kanban: Array.isArray(r.status_kanban)
        ? r.status_kanban
        : DEFAULTS.status_kanban,
      campos_editaveis:
        r.campos_editaveis && typeof r.campos_editaveis === "object" && !Array.isArray(r.campos_editaveis)
          ? (r.campos_editaveis as Record<string, string>)
          : DEFAULTS.campos_editaveis,
      modo_baixa_estoque: r.modo_baixa_estoque ?? DEFAULTS.modo_baixa_estoque,
      modo_oc_rolo: (r as any).modo_oc_rolo ?? DEFAULTS.modo_oc_rolo,
      kanban_requisitos:
        (r as any).kanban_requisitos && typeof (r as any).kanban_requisitos === "object" && !Array.isArray((r as any).kanban_requisitos)
          ? ((r as any).kanban_requisitos as Record<string, string[]>)
          : DEFAULTS.kanban_requisitos,
      leadtime:
        (r as any).leadtime && Array.isArray((r as any).leadtime.etapas)
          ? { etapas: (r as any).leadtime.etapas, slaServico: (r as any).leadtime.slaServico ?? null }
          : DEFAULTS.leadtime,
    });
  }, [data?.cfg]);

  const save = useMutation({
    mutationFn: async () => {
      if (!data?.tenantId) throw new Error("Loja não identificada para este usuário.");
      // campos_editaveis (janela Nomenclaturas), tamanhos_grade e etapas_acabamento
      // (agora em Cadastro > Atributos) NÃO são salvos aqui, p/ não sobrescrever o que
      // foi editado nesses outros lugares.
      const { campos_editaveis: _ce, tamanhos_grade: _tg, etapas_acabamento: _ea, ...cfgRest } = cfg;
      const payload = { tenant_id: data.tenantId, ...cfgRest };
      const { error } = await supabase
        .from("tenant_config")
        .upsert(payload as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      // Invalida TODA leitura de config para refletir na hora. As leituras usam
      // prefixos divergentes (tenant_config, tenant-config-grade, cad-tenant-config-grade,
      // tenant-config-threshold, tenant-status-kanban, ft-tamanhos…), então casamos
      // por predicate em vez de prefixo único.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("tenant") || k.includes("tamanhos"));
        },
      });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/" />;

  return (
    <div className="space-y-6 max-w-4xl max-sm:pb-24">
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Settings className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Configurações da Loja</h1>
            <p className="text-sm text-muted-foreground">
              Parâmetros usados em todo o fluxo de produção.
            </p>
          </div>
        </div>
        <Button className="max-sm:hidden shrink-0" onClick={() => setConfirmSalvar(true)} disabled={save.isPending || isLoading}>
          <Save className="h-4 w-4 mr-2" />
          {save.isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </header>

      {/* Modo só-estoque: só Nomenclaturas + Módulos da loja. O restante (produção,
          fuso, baixa, OC/rolo, ERP) fica escondido. */}
      {!isStockOnly && (<>
      {/* Serviços (categorias), Acabamento e Grade de Tamanhos migraram p/ Cadastro > Atributos.
          A Config NÃO gerencia mais esses campos (ver exclusão no payload do save). */}
      <SortableListCard
        title="Status do Kanban"
        description="Colunas do painel de Desenvolvimento. Em cada status, defina os Requisitos: o que um card precisa ter preenchido para poder ENTRAR nele."
        items={cfg.status_kanban}
        onChange={(items) => setCfg({ ...cfg, status_kanban: items })}
        placeholder="Ex: Em Modelagem"
        renderItemExtra={(label) => {
          const key = resolveStatusKey(label);
          return (
            <RequisitosStatusButton
              label={label}
              requisitos={cfg.kanban_requisitos?.[key] ?? []}
              onChange={(next) =>
                setCfg((c) => {
                  const map = { ...(c.kanban_requisitos ?? {}) };
                  if (next.length) map[key] = next; else delete map[key];
                  return { ...c, kanban_requisitos: map };
                })
              }
            />
          );
        }}
      />

      <LeadtimeConfigCard
        tenantId={data?.tenantId ?? null}
        statusKanban={cfg.status_kanban}
        value={cfg.leadtime}
        onChange={(leadtime) => setCfg((c) => ({ ...c, leadtime }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Data e Hora</CardTitle>
          <CardDescription>
            Fuso horário da loja. Afeta o relógio do topo e as mensagens de
            prazo/atraso/adiantado das ordens de compra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Fuso horário (GMT)</Label>
          <Select
            value={cfg.timezone}
            onValueChange={(v) => setCfg({ ...cfg, timezone: v })}
          >
            <SelectTrigger className="w-full md:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Baixa de Estoque</CardTitle>
          <CardDescription>
            Como o tecido sai do estoque quando um CAD é enviado ao corte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Modo de baixa</Label>
          <Select
            value={cfg.modo_baixa_estoque}
            onValueChange={(v) =>
              setCfg({ ...cfg, modo_baixa_estoque: v as ConfigState["modo_baixa_estoque"] })
            }
          >
            <SelectTrigger className="w-full md:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="por_oc">Por OC (respeita o vínculo modelo↔OC)</SelectItem>
              <SelectItem value="automatico">Automático (FIFO — estoque mais velho primeiro)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            "Por OC" baixa primeiro das OCs vinculadas no Desenvolvimento e usa FIFO no restante.
            "Automático" ignora os vínculos e consome sempre o lote mais antigo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OC e Rolo</CardTitle>
          <CardDescription>
            Como a loja trabalha o tecido — define o que aparece para vincular no Desenvolvimento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Trabalhar com</Label>
          <Select
            value={cfg.modo_oc_rolo}
            onValueChange={(v) => setCfg({ ...cfg, modo_oc_rolo: v as ConfigState["modo_oc_rolo"] })}
          >
            <SelectTrigger className="w-full md:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ambos">Ambos (OC e Rolo)</SelectItem>
              <SelectItem value="oc">Somente OC</SelectItem>
              <SelectItem value="rolo">Somente Rolo</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            No Desenvolvimento, ao vincular tecido por variante: "Somente OC" mostra só OCs;
            "Somente Rolo" mostra só rolos; "Ambos" mostra os dois. Vínculos já feitos continuam aparecendo.
          </p>
        </CardContent>
      </Card>
      </>)}

      <Card>
        <CardHeader>
          <CardTitle>Módulos da loja</CardTitle>
          <CardDescription>
            Módulos habilitados para a sua loja. Para contratar ou desabilitar um módulo, fale com o suporte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {MODULE_LABELS.map((m) => {
              const on = !!(modules as any)[m.key];
              return (
                <Badge key={m.key} variant={on ? "default" : "secondary"} className={on ? "" : "opacity-60"}>
                  {m.label}: {on ? "Ativo" : "Inativo"}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nomenclaturas</CardTitle>
          <CardDescription>
            Renomeie as abas do menu (módulos e páginas) e os campos de cada módulo.
            Deixe em branco para manter o nome padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NomesDasAbasDialog tenantId={data?.tenantId ?? null} modules={(data?.cfg as any)?.modules ?? {}} />
        </CardContent>
      </Card>

      {/* Integração com ERP: OCULTO por ora (a pedido do dono), inclusive p/ super_admin.
          Para reexibir, troque `false &&` por `isSuperAdmin &&`. */}
      {false && isSuperAdmin && !isStockOnly && (
      <Card>
        <CardHeader>
          <CardTitle>Integração com ERP</CardTitle>
          <CardDescription>Como um ERP externo lê os dados desta loja, com segurança.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">
            <div><span className="text-muted-foreground">REST:</span> {(import.meta.env.VITE_SUPABASE_URL ?? "—") + "/rest/v1/<tabela>"}</div>
            <div><span className="text-muted-foreground">RPC:</span> {(import.meta.env.VITE_SUPABASE_URL ?? "—") + "/rest/v1/rpc/<funcao>"}</div>
          </div>
          <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
            <li><b className="text-foreground">Um usuário de integração por loja (JWT)</b> — a RLS isola o tenant automaticamente. Evite a <code>service_role</code> key (ignora a RLS e vê todas as lojas).</li>
            <li>Dê a esse usuário as <b className="text-foreground">permissões certas</b> (ex.: <code>dashboard_financeiro</code> para as RPCs de dashboard protegidas).</li>
            <li><b className="text-foreground">Leia no gate certo</b>: quase tudo em desenvolvimento/CAD é planejado; "produzido" só após o <b className="text-foreground">CQ confirmado</b>. Ler cedo devolve planejamento.</li>
            <li>Use <b className="text-foreground">chaves naturais</b> (<code>cad_id, variante_numero</code>), nunca o <code>id</code> (várias tabelas são recriadas a cada save).</li>
            <li>Duas bases de unidade: <b className="text-foreground">financeiro</b> = qtd×preço (bruto); <b className="text-foreground">estoque</b> = qtd×rendimento (metros). Não cruzar.</li>
            <li>Filtrar <code>cancelado</code>/<code>estoque_zerado</code>/<code>is_rolo</code>; parcelas a pagar ≠ parcelas de recebimento; "vencido" é derivado.</li>
            <li>Teste a integração contra uma <b className="text-foreground">cópia</b> do banco, nunca em produção.</li>
          </ol>
          <p className="text-muted-foreground">
            Crie um <b className="text-foreground">usuário de integração</b> dedicado para esta loja em{" "}
            <Link to="/admin/usuarios" className="text-primary underline">Usuários</Link> (papel "Usuário"),
            e ajuste as permissões dele em Usuários da Loja.
          </p>
        </CardContent>
      </Card>
      )}

      <MobileActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Button className="ml-auto" onClick={() => setConfirmSalvar(true)} disabled={save.isPending || isLoading}>
          <Save className="h-4 w-4 mr-2" />
          {save.isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </MobileActionBar>

      {/* Confirmação: salvar config afeta dados de toda a loja. */}
      <AlertDialog open={confirmSalvar} onOpenChange={setConfirmSalvar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar as configurações da loja?</AlertDialogTitle>
            <AlertDialogDescription>
              Estas configurações afetam dados de <strong>toda a loja</strong> — modo
              OC/Rolo, grade de tamanhos, status do kanban, acabamento e baixa de estoque.
              Alterar algo que já está em uso pode deixar registros existentes
              inconsistentes e, em casos extremos, exigir reiniciar a loja por completo.
              Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setConfirmSalvar(false); save.mutate(); }}
              disabled={save.isPending}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Config do Leadtime: escolher quais etapas a aba Leadtime acompanha + o ideal (dias)
// de cada. Etapas MACRO (fixas) + Desenvolvimento por COLUNA do kanban (da própria loja).
// Nenhuma marcada = a aba mostra todas com o default. As keys casam com a RPC
// dashboard_leadtime (macro: cad_corte/servicos/cq/direcionamento/lancamento;
// kanban: "kanban:" + chave snake da coluna).
// Planejamento é o 1º passo do fluxo (card criado → ordem de criação enviada). Macro
// própria, exibida antes do Desenvolvimento.
const LEADTIME_PLANEJAMENTO = { key: "planejamento", label: "Planejamento" };
const LEADTIME_MACRO: { key: string; label: string }[] = [
  { key: "cad_corte", label: "CAD → Corte" },
  { key: "servicos", label: "Produção (Serviços)" },
  { key: "cq", label: "CQ" },
  { key: "direcionamento", label: "Direcionamento" },
  { key: "lancamento", label: "Lançamento" },
];

type LtTipo = "macro" | "kanban" | "servico";
type LtEtapa = { key: string; tipo: LtTipo; idealDias: number };
type LtConfig = { etapas: LtEtapa[]; slaServico: string | null };
type LtItem = { key: string; tipo?: LtTipo; label?: string; indent?: boolean; caption?: string };

function LeadtimeConfigCard({
  tenantId,
  statusKanban,
  value,
  onChange,
}: {
  tenantId: string | null;
  statusKanban: string[];
  value: LtConfig;
  onChange: (leadtime: LtConfig) => void;
}) {
  // Categorias de serviço da loja — p/ acompanhar Serviços "micro" (por categoria).
  const { data: servCats = [] } = useQuery({
    queryKey: ["leadtime-servico-cats", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome, ordem")
        .eq("tenant_id", tenantId!)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Produção em ordem de fluxo; sob "Produção (Serviços)", as categorias como micro.
  const servItens: LtItem[] = (servCats as any[]).map((c) => ({
    key: "servico_cat:" + c.id, tipo: "servico" as const, label: c.nome, indent: true,
  }));
  const producaoItens: LtItem[] = [];
  for (const m of LEADTIME_MACRO) {
    producaoItens.push({ key: m.key, tipo: "macro", label: m.label });
    if (m.key === "servicos" && servItens.length) {
      producaoItens.push({ key: "__servcap__", caption: "Ou detalhe por categoria (micro), no lugar do Serviços acima:" });
      producaoItens.push(...servItens);
    }
  }

  // Lista ordenada de etapas disponíveis, na ORDEM DO FLUXO (define a ordem salva):
  // Planejamento → Desenvolvimento (kanban) → Produção (macro + serviços-micro).
  const disponiveis: { key: string; tipo: LtTipo; label: string }[] = [
    { ...LEADTIME_PLANEJAMENTO, tipo: "macro" as const },
    ...statusKanban.map((label) => ({ key: "kanban:" + resolveStatusKey(label), tipo: "kanban" as const, label })),
    ...producaoItens.filter((it) => !it.caption).map((it) => ({ key: it.key, tipo: it.tipo!, label: it.label! })),
  ];
  const sel = new Map(value.etapas.map((e) => [e.key, e]));

  // Reescreve a seleção sempre na ordem canônica da lista de disponíveis (preserva slaServico).
  function commit(next: Map<string, LtEtapa>) {
    onChange({ ...value, etapas: disponiveis.filter((d) => next.has(d.key)).map((d) => next.get(d.key)!) });
  }
  function toggle(d: { key: string; tipo: LtTipo }, on: boolean) {
    const m = new Map(sel);
    if (on) m.set(d.key, { key: d.key, tipo: d.tipo, idealDias: sel.get(d.key)?.idealDias ?? (d.tipo === "kanban" ? 5 : 7) });
    else m.delete(d.key);
    commit(m);
  }
  function setIdeal(key: string, tipo: LtTipo, dias: number) {
    const m = new Map(sel);
    m.set(key, { key, tipo, idealDias: Math.max(0, dias || 0) });
    commit(m);
  }

  // Serviços de confecção (oficina/costura/PL) — opções p/ o SLA da Subcategoria medir contra.
  const confeccao = (servCats as any[]).filter((c) => isServicoConfeccao(c.nome));
  const nSel = value.etapas.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leadtime</CardTitle>
        <CardDescription>
          Quais etapas a aba <span className="font-medium">Leadtime</span> do Dashboard acompanha e o
          tempo <span className="font-medium">ideal</span> (em dias) de cada. Marque para acompanhar.
          {nSel === 0 && " Nenhuma marcada = a aba mostra todas as etapas com o padrão."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Ordem do fluxo: Planejamento → Desenvolvimento → Produção. */}
        <LeadtimeGrupo
          titulo="Planejamento"
          itens={disponiveis.filter((d) => d.key === "planejamento")}
          sel={sel}
          onToggle={toggle}
          onIdeal={setIdeal}
        />
        <LeadtimeGrupo
          titulo="Desenvolvimento · colunas do kanban"
          itens={disponiveis.filter((d) => d.tipo === "kanban")}
          sel={sel}
          onToggle={toggle}
          onIdeal={setIdeal}
        />
        <LeadtimeGrupo
          titulo="Produção"
          itens={producaoItens}
          sel={sel}
          onToggle={toggle}
          onIdeal={setIdeal}
        />

        {/* Prazo de Serviços vindo do "SLA de Serviços" da Subcategoria 1 do item (varia por
            produto). Opções filtradas aos serviços de confecção (oficina/costura/PL). */}
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Prazo de Serviços pelo SLA da Subcategoria</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No detalhamento por item, o prazo (ideal) da etapa abaixo usa o <span className="font-medium">SLA
            de Serviços</span> cadastrado na Subcategoria 1 do item, em vez do número fixo.
          </p>
          <Select
            value={value.slaServico ?? "off"}
            onValueChange={(v) => onChange({ ...value, slaServico: v === "off" ? null : v })}
          >
            <SelectTrigger className="mt-2 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Não usar (prazo fixo da etapa)</SelectItem>
              <SelectItem value="servicos">Bloco todo (Produção · Serviços)</SelectItem>
              {confeccao.map((c) => (
                <SelectItem key={c.id} value={"servico_cat:" + c.id}>{c.nome} (confecção)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadtimeGrupo({
  titulo,
  itens,
  sel,
  onToggle,
  onIdeal,
}: {
  titulo: string;
  itens: LtItem[];
  sel: Map<string, LtEtapa>;
  onToggle: (d: { key: string; tipo: LtTipo }, on: boolean) => void;
  onIdeal: (key: string, tipo: LtTipo, dias: number) => void;
}) {
  if (itens.filter((i) => !i.caption).length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <div className="space-y-1.5">
        {itens.map((d) => {
          if (d.caption) {
            return <p key={d.key} className="pl-1 pt-1 text-xs text-muted-foreground">{d.caption}</p>;
          }
          const on = sel.has(d.key);
          return (
            <div
              key={d.key}
              className={
                "flex items-center gap-3 rounded-md border px-3 py-2" +
                (d.indent ? " ml-4 border-l-2 border-l-muted-foreground/30" : "")
              }
            >
              <Switch checked={on} onCheckedChange={(v) => onToggle({ key: d.key, tipo: d.tipo! }, v)} />
              <span className="flex-1 truncate text-sm">{d.label}</span>
              {on && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">ideal</span>
                  <NumberInput
                    integer
                    value={sel.get(d.key)!.idealDias}
                    onChange={(e) => onIdeal(d.key, d.tipo!, Number(e.target.value))}
                    className="h-8 w-16 text-right"
                  />
                  <span className="text-xs text-muted-foreground">dias</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableListCard({
  title,
  description,
  items,
  onChange,
  placeholder,
  renderItemExtra,
}: {
  title: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  renderItemExtra?: (label: string, index: number) => React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ids = items.map((label, idx) => `${idx}::${label}`);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(items, oldIndex, newIndex));
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      toast.error("Item já existe.");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  };

  const update = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add} variant="secondary">
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((label, idx) => (
                <SortableItem
                  key={ids[idx]}
                  id={ids[idx]}
                  value={label}
                  onChange={(v) => update(idx, v)}
                  onRemove={() => remove(idx)}
                  extra={renderItemExtra?.(label, idx)}
                />
              ))}
              {items.length === 0 && (
                <li className="text-sm text-muted-foreground italic">Nenhum item ainda.</li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function SortableItem({
  id,
  value,
  onChange,
  onRemove,
  extra,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  extra?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-card p-2"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 border-0 shadow-none focus-visible:ring-1"
      />
      {extra}
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}

// Editor das nomenclaturas por módulo: nomes das abas (módulo + páginas) e dos
// campos. O usuário escolhe UM módulo por vez.
function NomesDasAbasDialog({ tenantId, modules }: { tenantId: string | null; modules: Record<string, boolean> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const enabledModules = PAGES_CATALOG.filter((m) => modules[m.module] !== false);
  const [selModule, setSelModule] = useState<string>(enabledModules[0]?.module ?? "");

  const { data: current } = useQuery({
    queryKey: ["tenant_config", "nomenclaturas_edit"],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tab_labels, campos_editaveis").eq("tenant_id", tenantId!).maybeSingle();
      return {
        tab_labels: ((data as any)?.tab_labels ?? {}) as Record<string, string>,
        campos_editaveis: ((data as any)?.campos_editaveis ?? {}) as Record<string, string>,
      };
    },
  });

  useEffect(() => {
    if (open && current && !hydrated) {
      setTabs(current.tab_labels);
      setCampos(current.campos_editaveis);
      if (!selModule && enabledModules[0]) setSelModule(enabledModules[0].module);
      setHydrated(true);
    }
    if (!open) setHydrated(false);
  }, [open, current, hydrated, enabledModules, selModule]);

  const mod = PAGES_CATALOG.find((m) => m.module === selModule);
  const fieldKeys = MODULE_FIELD_KEYS[selModule] ?? [];

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Loja não identificada.");
      const cleanTabs: Record<string, string> = {};
      Object.entries(tabs).forEach(([k, v]) => { if (v && v.trim()) cleanTabs[k] = v.trim(); });
      const cleanCampos: Record<string, string> = {};
      Object.entries(campos).forEach(([k, v]) => { if (v && v.trim()) cleanCampos[k] = v.trim(); });
      // upsert (não update): loja sem linha de config não perde a gravação em silêncio.
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, tab_labels: cleanTabs, campos_editaveis: cleanCampos } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nomenclaturas salvas");
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("tenant") || k.includes("tamanhos"));
        },
      });
      setOpen(false);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={!tenantId}>
          <Settings className="h-4 w-4 mr-2" /> Editar nomenclaturas por módulo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nomenclaturas</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
          <Label className="text-sm font-semibold">Módulo a editar</Label>
          <Select value={selModule} onValueChange={setSelModule}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {enabledModules.map((m) => <SelectItem key={m.module} value={m.module}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {mod && (
          <div className="space-y-4">
            {/* Nomes das abas (módulo + páginas) */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Nomes das abas (menu)</p>
              <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
                <Label className="text-sm">{mod.label} <span className="text-muted-foreground">(módulo)</span></Label>
                <Input placeholder={mod.label} value={tabs[mod.module] ?? ""} onChange={(e) => setTabs((t) => ({ ...t, [mod.module]: e.target.value }))} />
              </div>
              {mod.pages.map((p) => (
                <div key={p.key} className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2 md:pl-4">
                  <Label className="text-xs text-muted-foreground">{p.label}</Label>
                  <Input className="h-8" placeholder={p.label} value={tabs[p.key] ?? ""} onChange={(e) => setTabs((t) => ({ ...t, [p.key]: e.target.value }))} />
                </div>
              ))}
            </div>

            {/* Nomes de campos do módulo */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Nomes de campos</p>
              {fieldKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhum campo personalizável neste módulo.</p>
              ) : (
                fieldKeys.map((k) => (
                  <div key={k} className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
                    <Label className="text-xs text-muted-foreground">{FIELD_LABEL_DEFAULTS[k] ?? k}</Label>
                    <Input className="h-8" placeholder={FIELD_LABEL_DEFAULTS[k] ?? k} value={campos[k] ?? ""} onChange={(e) => setCampos((c) => ({ ...c, [k]: e.target.value }))} />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">Em branco = nome padrão.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Categorias de Terceirizado (mesma lista usada em Cadastro → Serviço → Terceirizados).
// Mesmo padrão visual do card de Acabamento, mas persiste direto na tabela
// `categorias_terceirizado` (cada ação salva na hora, não depende do botão "Salvar").
function ServicosCard({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; nome: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ["categorias_terceirizado", "config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome, ordem")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string; ordem: number }[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categorias_terceirizado", "config"] });
    // Mesma lista consumida no cadastro de Terceirizados.
    qc.invalidateQueries({ queryKey: ["cat-terceirizado-options"] });
    qc.invalidateQueries({ queryKey: ["categorias_terceirizado"] });
  };

  const reorderMut = useMutation({
    // `prev` é o snapshot do cache antes do update otimista, para rollback no erro.
    mutationFn: async ({ ordered }: { ordered: { id: string }[]; prev: typeof categorias }) => {
      // UPDATE por id tocando SÓ em `ordem`. Não usar `.upsert`: o PostgREST gera
      // INSERT ... ON CONFLICT, e o Postgres valida o NOT NULL de `nome` (e demais
      // colunas) na linha de INSERT proposta ANTES de resolver o conflito, então o
      // upsert sem `nome` falha com not-null violation e a branch de UPDATE nunca roda.
      for (const [i, c] of ordered.entries()) {
        const { error } = await supabase
          .from("categorias_terceirizado")
          .update({ ordem: i })
          .eq("id", c.id);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (e: any, vars) => {
      // Reverte o update otimista do cache; senão a tela mostra a nova ordem (mentira)
      // enquanto o banco mantém a antiga até o próximo refetch.
      qc.setQueryData(["categorias_terceirizado", "config"], vars.prev);
      toast.error(mensagemErro(e, "Erro ao reordenar."));
    },
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = categorias.findIndex((c) => c.id === active.id);
    const newIndex = categorias.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const prev = categorias;
    const next = arrayMove(categorias, oldIndex, newIndex);
    qc.setQueryData(["categorias_terceirizado", "config"], next); // otimista
    reorderMut.mutate({ ordered: next, prev });
  };

  const addMut = useMutation({
    mutationFn: async (nome: string) => {
      // tenant_id é preenchido pelo trigger set_tenant_id.
      const { error } = await supabase.from("categorias_terceirizado").insert({ nome, ordem: categorias.length } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Categoria já existe." : mensagemErro(e, "Erro ao adicionar.")),
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await supabase
        .from("categorias_terceirizado")
        .update({ nome })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Categoria já existe." : mensagemErro(e, "Erro ao renomear.")),
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categorias_terceirizado").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(
        e?.code === "23503"
          ? "Categoria em uso por serviços. Remova os vínculos antes."
          : mensagemErro(e, "Erro ao excluir."),
      ),
  });

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (categorias.some((c) => c.nome.toLowerCase() === v.toLowerCase())) {
      toast.error("Categoria já existe.");
      return;
    }
    addMut.mutate(v);
  };

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Serviços</CardTitle>
        <CardDescription>Categorias dos serviços executados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Ex: Estamparia"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            disabled={!tenantId}
          />
          <Button
            type="button"
            onClick={add}
            variant="secondary"
            disabled={!tenantId || addMut.isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground italic">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categorias.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {categorias.map((c) => (
                  <ServicoRow
                    key={c.id}
                    id={c.id}
                    nome={c.nome}
                    onRename={(nome) => renameMut.mutate({ id: c.id, nome })}
                    onRemove={() => setRemoveTarget(c)}
                  />
                ))}
                {categorias.length === 0 && (
                  <li className="text-sm text-muted-foreground italic">Nenhuma categoria ainda.</li>
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>

    <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir o serviço “{removeTarget?.nome}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta categoria de serviço sai da loja. Se já estiver em uso por algum
            serviço, a exclusão será bloqueada. Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => { e.preventDefault(); if (removeTarget) removeMut.mutate(removeTarget.id); setRemoveTarget(null); }}
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function ServicoRow({
  id,
  nome,
  onRename,
  onRemove,
}: {
  id: string;
  nome: string;
  onRename: (nome: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(nome);
  useEffect(() => setValue(nome), [nome]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const commit = () => {
    const v = value.trim();
    if (!v) {
      setValue(nome); // não permite vazio: reverte
      return;
    }
    if (v !== nome) onRename(v);
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border bg-card p-2">
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 border-0 shadow-none focus-visible:ring-1"
      />
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}
