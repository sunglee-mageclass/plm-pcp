import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Plus, GripVertical, Trash2, Save, Loader2, ArrowLeft, Send, Tag, Hand, Zap, LogIn, Lock } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTenantModules, type ModuleKey } from "@/hooks/useTenantModules";
import { blocosConfigVisiveis } from "@/lib/config-loja-blocos";
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
import { FormatoSkuCard } from "@/components/configuracoes/FormatoSkuCard";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { resolveStatusKey, normalizeKanbanStatuses, APROVADO_KEY } from "@/lib/kanban-status";
import { matchesTable } from "@/lib/realtime-invalidation-map";
import { isServicoConfeccao } from "@/lib/servico-confeccao";
import { etapaLeadtimeVisivel } from "@/lib/leadtime";
import { RequisitosStatusButton } from "@/components/admin/RequisitosStatusDialog";
import { ETAPAS_DEFAULT, type EtapaCfg } from "@/lib/pcp-etapas";
import { REVENDA_COND_NA, requisitosHerdados, condicoesForaDoModulo } from "@/lib/kanban-condicoes";
import { REVENDA_CAMPO_KEYS, REVENDA_SECAO_KEYS, REVENDA_CAMPOS_DEFAULT_OFF } from "@/lib/revenda-config";
import { problemaFormatoRef, type RefConfig } from "@/lib/ref-montar";
import { FormatoRefCard } from "@/components/configuracoes/FormatoRefCard";
import { RefRevelarDialog } from "@/components/admin/RefRevelarDialog";
import {
  etapaRefComKanban, etapaRefNoSalvar, motivoPreviaRef, refPreviaRevelar, TEXTO_REF_ETAPA_COM_KANBAN, toastRefsReveladas,
  type PreviaRefRevelar,
} from "@/lib/ref-revelar";
import { keywordsDoServidor } from "@/lib/config-keywords";
import { mergeDraft, igual, type Conflito } from "@/lib/colab/merge";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { LojaErroAviso } from "@/components/shared/LojaErroAviso";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { useColabPresencaPagina } from "@/hooks/useColabPresencaPagina";
import {
  COLUNAS_NOMENCLATURAS, COLUNAS_PAGINA, colunasDoErro, limparNomes, mesclarNomes, montarMudancas, rebasearBaseRaw, rotuloColuna,
  serializarColuna, type ColunaNomenclatura, type ConflitoNome,
} from "@/lib/config-loja-colab";
import type { PresencaColab } from "@/hooks/useColabRegistro";
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { KanbanAutomaticoBloco, KanbanSalvarDialog } from "@/components/admin/KanbanAutomaticoDialog";
import { kanbanPreviaRecalculo } from "@/lib/kanban-auto-rpc";
import { boardDaLoja, fluxoDoModelo, lerKanbanAutoConfig } from "@/lib/kanban-auto";
import { modoColuna, motorKanbanDisponivel, MOTIVO_REPROVADO_MANUAL, type PreviaRecalculo } from "@/lib/kanban-auto-ui";
import {
  conflitoKanban, descreverMudancasKanban, diffKanban, diffMudouDesdeAPrevia, jsonCanonico, juntarLista, KANBAN_COLS, mensagemConflitoKanban,
  MENSAGEM_CHAVE_KANBAN_MUDOU, MENSAGEM_PREVIA_KANBAN_MUDOU, normalizarKanbanDefaults, pickKanban, resolverEcoKanban, revendaSemRequisitos,
  type KanbanCol, type KanbanColsValor,
} from "@/lib/kanban-auto-config";

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
  // CASCATA: exceções por etapa — herdados que o admin desligou naquela etapa (com alerta).
  // Vazio = cascata pura (cada etapa herda os requisitos das anteriores na ordem do board).
  kanban_requisitos_excecoes: {} as Record<string, string[]>,
  // Etapa (KEY snake da coluna do kanban) A PARTIR da qual um modelo pode ser enviado à
  // Explosão. "" ⇒ ausente ⇒ 'aprovado' (histórico). Semântica "a partir da etapa": na
  // etapa escolhida OU em qualquer posterior. Ver kanban-status.ts `podeEnviarExplosao`.
  explosao_envio_status: "" as string,
  // Etapa (KEY snake) A PARTIR da qual o campo REF passa a APARECER no card de
  // Desenvolvimento (e a REF automática é revelada `ref_auto → ref`). "" ⇒ ausente ⇒
  // 'aprovado' (histórico). Mesma régua de `refCampoVisivel`/`_ref_exibir_gate`.
  ref_exibir_status: "" as string,
  // Toggle opt-in: mostra no Sheet do Planejamento os 2 blocos de análise de markup por faixa
  // ("Preço por faixa" + "M.O. que cabe"). Default OFF — a Fase A (faixas no bloco Markup) NÃO
  // depende disto. Lido em PlanejamentoDetail (ramo manufaturado).
  markup_analise_faixa: false as boolean,
  // Leadtime: etapas acompanhadas na aba Leadtime do Dashboard + ideal (dias) de cada.
  // Vazio = a aba mostra TODAS as etapas com o default. Ordem = ordem de exibição.
  // slaServico = etapa cujo prazo (na matriz do Leadtime) vem do "SLA de Serviços" da
  // Subcategoria 1 do item (servicos = bloco todo, ou servico_cat:<id> de confecção). null = off.
  leadtime: {
    etapas: [] as { key: string; tipo: "macro" | "kanban" | "servico"; idealDias: number }[],
    slaServico: null as string | null,
  },
  // Etapas PL (kanban, módulo opt-in etapas_pl): as 5 etapas fixas (renomeáveis/
  // ativa-desativa, SEM reordenar/adicionar). Vazio ⇒ usa ETAPAS_DEFAULT.
  pcp_etapas: [] as EtapaCfg[],
  // Fluxo de Revenda (módulo opt-in produto_acabado) — config PRÓPRIA do kanban/campos
  // dos modelos `origem==='revenda'` (ver invariante #13 + src/lib/revenda-config.ts).
  // KEYS de coluna permitidas ([] = todas). Requisitos por coluna (keys de CONDICOES).
  revenda_kanban_colunas: [] as string[],
  revenda_kanban_requisitos: {} as Record<string, string[]>,
  // Campo/seção key → visível p/ revenda. De fábrica semeia os 12 OFF (9 campos de Info
  // Básicas + seções prova/s2/s-cad), p/ revenda já pular esses campos numa loja nova.
  revenda_campos: Object.fromEntries(REVENDA_CAMPOS_DEFAULT_OFF.map((k) => [k, false])) as Record<string, boolean>,
  // Formato da REF (montagem + siglas + dígitos/início do número) — ver src/lib/ref-montar.ts.
  // null = loja não configurou; usa o comportamento HISTÓRICO do banco (fallback derivado).
  ref_config: null as RefConfig | null,
  // F3.6 (dono 25/set, R39): Keywords da loja — texto livre (`tenant_config.keywords`); p/ uma tela FUTURA do super admin.
  keywords: "" as string,
};

type ConfigState = typeof DEFAULTS;

// Linha CRUA de tenant_config → estado da TELA (fallback de DEFAULTS por coluna). Loja SEM linha
// (`row` null) = DEFAULTS puros. Extraída do efeito de hidratação (T3 da Config colaborativa) p/ o
// onError do P0409 também conseguir mostrar o valor "do outro" na mesma régua da tela.
function normalizarConfig(row: Record<string, unknown> | null | undefined): ConfigState {
  const r = (row ?? {}) as any;
  return {
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
    kanban_requisitos_excecoes:
      (r as any).kanban_requisitos_excecoes && typeof (r as any).kanban_requisitos_excecoes === "object" && !Array.isArray((r as any).kanban_requisitos_excecoes)
        ? ((r as any).kanban_requisitos_excecoes as Record<string, string[]>)
        : DEFAULTS.kanban_requisitos_excecoes,
    explosao_envio_status: (r as any).explosao_envio_status ?? DEFAULTS.explosao_envio_status,
    ref_exibir_status: (r as any).ref_exibir_status ?? DEFAULTS.ref_exibir_status,
    markup_analise_faixa: !!r.markup_analise_faixa,
    leadtime:
      (r as any).leadtime && Array.isArray((r as any).leadtime.etapas)
        ? { etapas: (r as any).leadtime.etapas, slaServico: (r as any).leadtime.slaServico ?? null }
        : DEFAULTS.leadtime,
    pcp_etapas:
      Array.isArray((r as any).pcp_etapas) && (r as any).pcp_etapas.length
        ? ((r as any).pcp_etapas as EtapaCfg[])
        : DEFAULTS.pcp_etapas,
    revenda_kanban_colunas: Array.isArray((r as any).revenda_kanban_colunas)
      ? ((r as any).revenda_kanban_colunas as string[])
      : DEFAULTS.revenda_kanban_colunas,
    revenda_kanban_requisitos:
      (r as any).revenda_kanban_requisitos && typeof (r as any).revenda_kanban_requisitos === "object" && !Array.isArray((r as any).revenda_kanban_requisitos)
        ? ((r as any).revenda_kanban_requisitos as Record<string, string[]>)
        : DEFAULTS.revenda_kanban_requisitos,
    revenda_campos:
      (r as any).revenda_campos && typeof (r as any).revenda_campos === "object" && !Array.isArray((r as any).revenda_campos)
        ? ((r as any).revenda_campos as Record<string, boolean>)
        : DEFAULTS.revenda_campos,
    ref_config:
      (r as any).ref_config && typeof (r as any).ref_config === "object" && !Array.isArray((r as any).ref_config)
        ? ((r as any).ref_config as RefConfig)
        : DEFAULTS.ref_config,
    keywords: keywordsDoServidor((r as any).keywords),
  };
}

const MODULE_LABELS: { key: string; label: string }[] = [
  { key: "cadastro", label: "Cadastro" },
  { key: "criacao", label: "Estilo & Engenharia" },
  { key: "otb", label: "OTB" },
  { key: "entrada_saida", label: "Entrada e Saída" },
  { key: "producao", label: "PCP" },
  { key: "financeiro", label: "Financeiro" },
  { key: "dashboard", label: "Dashboard" },
  // produto_acabado (opt-in): badge só-leitura, igual aos outros 7 — o toggle mora em
  // Gerenciar Lojas (super_admin), não mais aqui (decisão do dono, ago/2026).
  { key: "produto_acabado", label: "Produto Acabado" },
  // etapas_pl (opt-in, Fase 1 ago/2026): mesmo padrão — badge só-leitura aqui, toggle em
  // Gerenciar Lojas; a config das 5 etapas (renomear/ativa) é o Card "Etapas do PCP" abaixo.
  { key: "etapas_pl", label: "Etapas PL" },
];

// Linha CRUA de tenant_config (RP3: conferir, antes de gravar o kanban, que ninguém o mudou depois que a tela abriu).
async function lerConfigServidor(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Record<string, unknown> | null;
}

// T3 (Config colaborativa): as colunas GERAIS da página (as 16 de `COLUNAS_PAGINA` menos as 5 do
// kanban, que têm régua própria — `rebasearKanban`/`kanbanBase`).
const COLUNAS_GERAIS_PAGINA: ReadonlySet<string> = new Set(
  COLUNAS_PAGINA.filter((k) => !(KANBAN_COLS as readonly string[]).includes(k)),
);

// O valor CRU (sem fallback de DEFAULTS) das 16 colunas da página — a `_base` da RPC. Loja sem
// linha = tudo null (a RPC exige a chave na base; `null` = "não havia valor").
function colunasCruas(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of COLUNAS_PAGINA) out[k] = row?.[k] ?? null;
  return out;
}

// T4: dois valores de uma coluna "são o mesmo" para o banco se serializam igual no payload da RPC
// (keywords "  " ≡ "" ≡ NULL; ref_config {partes:[]} ≡ NULL; explosao "" ≡ NULL).
function mesmoValorSalvo(k: string, a: unknown, b: unknown): boolean {
  return igual(serializarColuna(k, a), serializarColuna(k, b));
}

// T4 (P-124 A — anel por BLOCO): coluna → bloco da tela (`data-colab-path` do card) que a edita.
const BLOCO_DA_COLUNA: Record<string, string> = {
  timezone: "cfg:timezone",
  status_kanban: "cfg:status_kanban",
  kanban_requisitos: "cfg:status_kanban",
  kanban_requisitos_excecoes: "cfg:status_kanban",
  explosao_envio_status: "cfg:status_kanban",
  ref_exibir_status: "cfg:status_kanban",
  ref_config: "cfg:ref_config",
  revenda_kanban_colunas: "cfg:revenda_kanban_colunas",
  revenda_kanban_requisitos: "cfg:revenda_kanban_colunas",
  revenda_campos: "cfg:revenda_campos",
  leadtime: "cfg:leadtime",
  pcp_etapas: "cfg:pcp_etapas",
  modo_oc_rolo: "cfg:modo_oc_rolo",
  modo_baixa_estoque: "cfg:modo_baixa_estoque",
  markup_analise_faixa: "cfg:markup_analise_faixa",
  keywords: "cfg:keywords",
};

// T4: foco em controle DENTRO de um bloco (diálogo de Requisitos, marcadores Explosão/REF por linha)
// → o anel do outro aparece no BLOCO que o contém (o diálogo é portal, fora da página; os marcadores
// se repetem por linha e reencontrar "o 1º" poria o anel na linha errada).
const BLOCO_DO_FOCO: Record<string, string> = {
  "cfg:kanban_requisitos": "cfg:status_kanban",
  "cfg:explosao_envio_status": "cfg:status_kanban",
  "cfg:ref_exibir_status": "cfg:status_kanban",
  "cfg:revenda_kanban_requisitos": "cfg:revenda_kanban_colunas",
};
function blocoDoFoco(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("nom:")) return "cfg:nomenclaturas"; // T5: nome na janela → anel no card Nomenclaturas
  return BLOCO_DO_FOCO[path] ?? path;
}

// Junta a lista de conflitos pendentes com os novos (um por coluna; o novo substitui o antigo).
function juntarConflitos(atuais: Conflito[], novos: Conflito[]): Conflito[] {
  const mapa = new Map(atuais.map((c) => [c.path, c]));
  for (const c of novos) mapa.set(c.path, c);
  return [...mapa.values()];
}

// Resposta da RPC `salvar_config_loja` (T1): só as colunas gravadas, com o valor pós-gatilhos.
// Leves L3 kanban #21 (P-211 A): + `refs_reveladas` (quantas REFs o Salvar da etapa da REF revelou; ausente no banco velho).
type RetornoSalvarConfig = { gravadas: string[]; valores: Record<string, unknown>; refs_reveladas?: number };

// Leves L3 kanban #3 (P-210 A, dono 01/out): a configuração de EXCEÇÕES de requisito (herdado desligado numa etapa) fica
// OCULTA — o editor não aparece no diálogo de Requisitos (os herdados ficam marcados e travados). Código e coluna
// `kanban_requisitos_excecoes` GUARDADOS ("ocultar primeiro"); exceções já gravadas (0 lojas na cópia) seguem valendo.
const EXCECOES_REQUISITO_OCULTAS = true;

// Fix round 1 (B5, review-fixqa.md): motivo CURTO pro toast de "loja anterior" (I1/L2) — o texto
// completo do `mensagemErro` (uma frase própria, com ponto interno) ficava verboso dentro dos
// parênteses e, fora do caso de rede, podia confundir (ex.: "outra pessoa salvou… confira os
// destaques" quando não há destaque nenhum na loja que está na tela; ou rotular qualquer erro
// desconhecido como "falha de rede"). Mapa fechado de 3 casos — não usa `mensagemErro` aqui.
function motivoCurtoLojaAnterior(e: unknown): string {
  const err = e as { code?: unknown; message?: unknown } | null | undefined;
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  if (code === "P0409") return "outra pessoa salvou antes";
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("networkerror")) return "falha de conexão";
  return "erro ao salvar";
}

function ConfiguracoesLojaPage() {
  const { user, isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  // `isLoading` = `!pronto` (alias da F1/M9): módulos da loja ainda não chegaram.
  const { modules, isStockOnly, isLoading: modulosCarregando, erro: modulosErro, tentarDeNovo: tentarModulosDeNovo } = useTenantModules();
  // [modularidade F2, F9] blocos por módulo (esconder NÃO apaga o que está gravado: o Salvar manda só o que mudou).
  const blocos = blocosConfigVisiveis(modules, isStockOnly);
  const [cfg, setCfg] = useState<ConfigState>(DEFAULTS);
  // Espelha `cfg` p/ o useEffect do eco (fix round 2) ler o valor JÁ na tela sem depender do
  // closure do render que agendou o efeito (evita staleness entre múltiplos setState no meio).
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  // Fix hidratação (P-57 A): último `next` (servidor) aplicado à tela — base do merge 3-vias
  // quando uma re-hidratação chega DEPOIS da 1ª (Realtime/foco/save de outra tela/aba). null
  // até a 1ª carga: aí ainda não há "meu" para proteger, adota o servidor cru como sempre.
  const cfgBaseRef = useRef<ConfigState | null>(null);
  // Fix hidratação — revisão final (achado C3, REGRESSÃO desta branch, PERDA/GRAVAÇÃO CRUZADA de
  // dado comprovada, review-final.md): qual loja o `cfgBaseRef`/o merge 3-vias abaixo pertencem.
  // Sem isso, um super_admin com edição não salva na loja A que troca para a loja B (o
  // `invalidateQueries()` do `TenantSwitcher` refaz esta query, já trazendo a B) fazia o merge
  // 3-vias tratar o campo tocado na A como "meu" e sobreviver por cima do `next` da B — o Salvar
  // então upserta a edição da A na loja ERRADA (B). Antes desta branch a tela era sobrescrita pela
  // B (perdia a edição, mas não gravava na loja errada); o merge novo introduziu essa regressão.
  const cfgBaseTenantRef = useRef<string | null>(null);
  // O que ESTE save mandou (mutationFn) — para o eco do PRÓPRIO save não ser tratado como
  // edição alheia (senão o onSuccess já rebaixaria `cfgBaseRef` para o valor pré-save).
  const cfgEnviadoRef = useRef<ConfigState | null>(null);
  // Config colaborativa (T3, P-28 A): `hydrated` = a 1ª carga JÁ semeou `cfg`/`cfgBaseRef`/
  // `baseRawRef` (P-57 A — sem isso o Salvar podia sair entre a query resolver e o efeito semear).
  const [hydrated, setHydrated] = useState(false);
  // Valor CRU do servidor (as 16 colunas da página, SEM o fallback de DEFAULTS) — vai como `_base`
  // da RPC `salvar_config_loja` (compare-and-set por coluna). Loja sem linha = {} (base null por
  // coluna). Re-baseia a cada eco (`rebasearBaseRaw`), exceto colunas em conflito e o kanban com
  // save em voo; ZERA (adota o cru da loja nova) ao trocar de loja.
  const baseRawRef = useRef<Record<string, unknown>>({});
  // Conflitos pendentes (merge da re-hidratação + P0409 da RPC). T4 desenha o banner/"manter meu ·
  // usar o novo"; aqui só guardamos e travamos o Salvar enquanto houver algum (P-122 A).
  const [conflitosPendentes, setConflitosPendentes] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const definirConflitos = (lista: Conflito[]) => {
    conflitosRef.current = lista;
    setConflitosPendentes(lista);
  };
  // T4: resultado do último merge com mudança alheia (banner). null = nada a avisar.
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  // T4: presença (quem mais está na tela e em qual BLOCO — P-124 A). Canal por loja: trocar de loja
  // troca o canal (a presença da loja anterior some junto).
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  const colabScopeRef = useRef<HTMLDivElement>(null);
  // Colunas EM VOO (as que o save em andamento mandou; vazio = nenhum save em voo). O eco do PRÓPRIO
  // save pode chegar antes da resposta, já normalizado pelo servidor — comparar isso com a tela daria
  // conflito falso. Revisão T3/T4 (M1): SÓ essas colunas deixam de registrar conflito/"atualizado" e de
  // re-basear a base crua no eco; as demais seguem o merge normal (mudança alheia nelas continua visível).
  // Quem garante as colunas em voo é a RPC (compare-and-set) — P0409 vira conflito no onError.
  const emVooRef = useRef<Set<string>>(new Set());
  // Salvar configurações afeta dados de toda a loja (modo OC/Rolo, grade, kanban,
  // acabamento, baixa) — confirma antes de gravar.
  const [confirmSalvar, setConfirmSalvar] = useState(false);

  const { dirty, markClean, reset: resetCfgBaseline } = useDirtySnapshot(cfg);
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  // RP3 (guardião): as 5 colunas de kanban só vão no save quando o usuário as mudou (diff contra `cfg`). `cfg` =
  // como a TELA abriu (base do diff do que o usuário mexeu); `servidor` = valor lido do banco (normalizado), usado
  // pelo aviso antecipado de `prepararSalvar` — a garantia real é o compare-and-set da RPC (T3).
  const [kanbanBase, setKanbanBase] = useState<{ cfg: KanbanColsValor; servidor: KanbanColsValor }>(() => ({
    cfg: pickKanban(DEFAULTS),
    servidor: pickKanban(DEFAULTS), // mesmo espaço normalizado do conflito (re-revisão: loja sem linha)
  }));
  const kanbanBaseRef = useRef(kanbanBase);
  kanbanBaseRef.current = kanbanBase;
  const [preparandoSalvar, setPreparandoSalvar] = useState(false);
  // "Salvar e mover N cards" (chave ligada + requisitos/ordem mudados): prévia calculada no clique de Salvar.
  const [previaSalvar, setPreviaSalvar] = useState<{ previa: PreviaRecalculo; mudancas: string } | null>(null);
  // Leves L3 kanban #21 (P-211 A): prévia "N REFs serão reveladas (não voltam)" quando o Salvar leva a etapa nova da REF.
  // `refEtapaConferidaRef` = a etapa que a prévia conferiu (o `mutationFn` aborta se a que vai no Salvar for outra — mesma
  // garantia D19 do kanban); undefined = nenhuma conferida.
  const [previaRef, setPreviaRef] = useState<PreviaRefRevelar | null>(null);
  const refEtapaConferidaRef = useRef<{ valor: string | null } | undefined>(undefined);
  // Fix round 2 (revisão Opus): PROTEGE o kanban local (na tela) enquanto o save com diff de kanban
  // está EM VOO. (Desde o T3 da Config colaborativa o save é UMA RPC atômica — a antiga falha parcial
  // "geral gravou, kanban não" deixou de existir; qualquer erro = nada gravado e a proteção desliga.)
  // É um REF, não estado: precisa estar TRUE já no início do `mutationFn`, ANTES do await — o eco do
  // Realtime do próprio save chega em ~0,4-0,8s (WAL + debounce 250ms + 2 SELECTs em
  // useRealtimeInvalidation.ts) e a RPC pode demorar MAIS que isso (com a chave ligada,
  // `trg_kanban_config` recalcula a loja inteira na mesma txn) — uma flag de estado perderia a corrida. Lido pelo
  // useEffect do eco FORA das deps (não dispara o efeito de novo sozinho — round 1 tinha essa
  // regressão: a flag nas deps refazia o efeito no sucesso com `data?.cfg` ainda desatualizado e
  // sobrescrevia o `kanbanBase` que o `onSuccess` tinha acabado de setar).
  const kanbanProtegidoRef = useRef(false);
  // Minor 1 (fix round 1, garantia D19): o valor de `kanban_automatico` que `prepararSalvar` leu do
  // servidor ao decidir se mostrava a prévia "Salvar e mover N cards" (ou o AlertDialog de sempre).
  // Vai para a RPC como `_chave_kanban_esperada` (T3): ela confere na mesma transação que grava e
  // recusa com P0409 `chave_kanban_mudou:` se mudou nesse meio-tempo — sem isso, outra aba ligando a
  // chave enquanto o diálogo de confirmação está aberto faria o Salvar mover cards sem prévia nenhuma.
  const chaveEsperadaRef = useRef(false);
  // Médio 1 (revisão final Opus, garantia D19): o diff (canônico) que `prepararSalvar` calculou ao
  // pedir a prévia "Salvar e mover N cards" — a tela segue editável enquanto o `await` da prévia está
  // em voo. O `mutationFn` recalcula o diff de novo (contra o `cfg` JÁ NA TELA) e aborta se ele mudou
  // desde então: sem isso, a prévia mostrada (nº de cards, "de → para") já não bateria com o que seria
  // gravado. Vale tanto para o caminho do `KanbanSalvarDialog` quanto para o AlertDialog comum (D19 —
  // a F1 não confere isso sozinha).
  const diffEsperadoRef = useRef<KanbanColsValor>({});

  const { data, isLoading, isError: cfgLoadErrored, refetch: refetchCfg } = useQuery({
    queryKey: ["tenant-config", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Fix hidratação rodada 1 (achado I1 da revisão): os dois SELECTs engoliam o erro (`const
      // { data } = ...` sem checar) — uma falha de rede virava `cfg: null`, a tela caía nos
      // DEFAULTS, e o Salvar upsertava os DEFAULTS por cima da linha real da loja (fuso, modos,
      // leadtime, etapas PL, fluxo de revenda, ref_config…).
      const { data: u, error: uErr } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      if (uErr) throw uErr;
      const tenantId = u?.tenant_id;
      if (!tenantId) return { tenantId: null, cfg: null };
      const { data: row, error: cfgErr } = await supabase
        .from("tenant_config")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (cfgErr) throw cfgErr;
      return { tenantId, cfg: row };
    },
  });

  useEffect(() => {
    if (!data) return;
    // T3: usuário SEM loja — nada a hidratar; o Salvar fica travado (`!data?.tenantId`) e nenhuma
    // base de outra loja sobrevive para um save futuro.
    if (!data.tenantId) {
      cfgBaseTenantRef.current = null;
      cfgBaseRef.current = null;
      baseRawRef.current = {};
      definirConflitos([]);
      setUltimoMerge(null);
      setHydrated(false);
      return;
    }
    // T3: loja SEM linha de tenant_config (`data.cfg` null) também hidrata — de DEFAULTS, com base
    // crua VAZIA (a RPC recebe `null` como base de cada coluna e cria a linha). Antes o efeito saía
    // cedo e a tela ficava com os DEFAULTS iniciais do useState, sem base nenhuma.
    const next: ConfigState = normalizarConfig(data.cfg as Record<string, unknown> | null);
    // Fix round 2: enquanto PROTEGIDO (save em voo OU falha parcial pendente — `kanbanProtegidoRef`,
    // lido aqui FORA das deps do efeito), este eco — inclusive o do Realtime disparado pelo PRÓPRIO
    // upsert — NÃO pode trocar o kanban da tela pelo do servidor (apagaria a edição do usuário) NEM
    // atualizar `kanbanBase` (senão um retry perderia o conflito real de outra aba que mudou o
    // servidor nesse meio-tempo — round 1 tinha essa regressão). `resolverEcoKanban` (puro, testado)
    // decide as duas coisas de uma vez, a partir do MESMO instante: `cfgRef`/`kanbanBaseRef` espelham
    // o estado JÁ na tela (evitam closure obsoleto entre múltiplos setState no meio).
    // Fix hidratação — revisão final (C3): `mesmaLoja` chaveia AS DUAS proteções (kanban e o merge
    // geral abaixo) pelo tenant que gerou a base. Loja diferente da última aplicada = adota o
    // servidor CRU (sem eco protegido nem merge — não há "meu" que faça sentido proteger contra a
    // loja nova).
    const mesmaLoja = cfgBaseTenantRef.current === (data.tenantId ?? null);
    cfgBaseTenantRef.current = data.tenantId ?? null;
    // Fix hidratação — re-revisão final (achado m-B, review-final-2.md): sem isso, a flag
    // `kanbanProtegidoRef` de uma falha parcial na loja A sobrevivia à troca de loja — o eco
    // seguinte de uma mudança alheia na loja B (outro admin mexendo no kanban) deixava de ser
    // adotado na tela até o próximo save bem-sucedido zerar a flag. Sem perda de dado (o
    // `conflitoKanban` barrava um save nesse intervalo), mas a tela ficava "presa" mostrando um
    // kanban desatualizado da loja nova.
    if (!mesmaLoja) {
      kanbanProtegidoRef.current = false;
      // Revisão T3/T4 (I1): um save da loja anterior ainda em voo não pode "proteger" colunas da loja nova.
      emVooRef.current = new Set();
    }
    const r2 = mesmaLoja
      ? resolverEcoKanban(kanbanProtegidoRef.current, pickKanban(cfgRef.current), pickKanban(next), kanbanBaseRef.current)
      : { cfgKanban: pickKanban(next), kanbanBase: { cfg: pickKanban(next), servidor: pickKanban(next) } };
    // Fix hidratação (P-57 A, §4.1): re-hidratação (2ª+ vez que `data.cfg` muda referência —
    // Realtime, refetch de foco, o próprio diálogo "Nomenclaturas" desta tela, save de outra
    // aba/admin) FUNDE em vez de SOBRESCREVER. `base` = último servidor aplicado; campo onde a
    // tela (cfgRef.current) diverge da base é "meu" (tocado) e sobrevive; o resto adota o
    // servidor novo. 1ª carga (cfgBaseRef ainda null) OU loja diferente não tem "meu" para
    // proteger — adota cru.
    const base = mesmaLoja ? cfgBaseRef.current : null;
    // Fix round pós-QA (L1): "tocado" tem de usar a MESMA régua do banco (`mesmoValorSalvo`,
    // que passa por `serializarColuna` — o btrim de keywords, "" ⇄ null de explosao/ref/ref_config)
    // — não a `igual` crua. Sem isso, digitar "Moda " (espaço no fim) enquanto a base já é "Moda"
    // marcava keywords como tocado por um motivo cosmético que a RPC nem vê (ela grava aparado); o
    // mesmo raciocínio vale pro filtro de conflitos "convergiu" logo abaixo.
    const tocados = new Set(
      base ? (Object.keys(next) as (keyof ConfigState)[]).filter((k) => !mesmoValorSalvo(k, cfgRef.current[k], base[k])) : [],
    );
    const merge = base ? mergeDraft({ base, draft: cfgRef.current, fresh: next, touched: tocados }) : null;
    const valor = merge ? merge.valor : next;
    const tela = { ...valor, ...r2.cfgKanban } as ConfigState;
    // T3 (Config colaborativa): o merge GUARDA os conflitos (antes eram descartados — "o meu vence
    // calado", e o Salvar regravava por cima da mudança alheia). T4 desenha o banner; aqui só a
    // lista (que trava o Salvar, P-122 A). Só as colunas da PÁGINA contam (campos_editaveis/
    // tamanhos_grade/etapas_acabamento têm outros editores). Kanban usa a MESMA régua de "tocada"
    // de `rebasearKanban` (base = `kanbanBase.cfg`, não `cfgBaseRef`): tocada E o servidor mudou
    // desde a base E não convergiu. Colunas EM VOO (`emVooRef`, M1): não registram conflito nem contam
    // como "atualizadas" — o eco pode ser o do PRÓPRIO save, já normalizado pelo servidor.
    let pendentes: Conflito[] = mesmaLoja ? conflitosRef.current : [];
    const emVoo = emVooRef.current;
    // T4: quantas colunas da página chegaram de OUTRA pessoa neste eco (banner "N campos atualizados").
    let nAtualizados = 0;
    let novosConflitos: Conflito[] = [];
    if (merge) {
      const draftAntes = cfgRef.current as Record<string, unknown>;
      const baseAntes = base as Record<string, unknown>;
      const fresh = next as Record<string, unknown>;
      // Só diferença REAL conta — o servidor normaliza (keywords só espaços → NULL, ref_config vazio → NULL);
      // comparar pela serialização do payload evita "conflito"/"atualizado" falso depois do próprio save.
      novosConflitos = merge.conflitos.filter(
        (c) => COLUNAS_GERAIS_PAGINA.has(c.path) && !emVoo.has(c.path) && !mesmoValorSalvo(c.path, draftAntes[c.path], fresh[c.path]),
      );
      nAtualizados = merge.atualizados.filter(
        (k) => COLUNAS_GERAIS_PAGINA.has(k) && !emVoo.has(k) && !mesmoValorSalvo(k, baseAntes[k], fresh[k]),
      ).length;
      const local = pickKanban(cfgRef.current);
      const fresco = pickKanban(next);
      const kb = kanbanBaseRef.current.cfg;
      for (const c of KANBAN_COLS) {
        if (emVoo.has(c) || kanbanProtegidoRef.current) continue; // kanban do save em voo: a RPC decide
        const l = jsonCanonico(local[c]), f = jsonCanonico(fresco[c]), b = jsonCanonico(kb[c] ?? null);
        if (l !== f && l !== b && f !== b) novosConflitos.push({ path: c, meu: local[c], dele: fresco[c] });
        else if (l === b && f !== b) nAtualizados++; // não mexi e o servidor mudou → adotado
      }
      pendentes = juntarConflitos(pendentes, novosConflitos);
    }
    // Atualiza "meu"/"dele" dos pendentes (inclusive os vindos de um P0409, que nascem sem "dele") e
    // solta o que CONVERGIU (a tela já tem o mesmo valor do servidor — nada a resolver). Fix round
    // pós-QA (L1): `mesmoValorSalvo` (não `igual` cru) — "Moda " (meu) e "Moda" (dele) convergem
    // pro banco, senão o conflito de keywords com espaço no fim nunca solta sozinho (banner preso).
    pendentes = pendentes
      .filter((c) => !mesmoValorSalvo(c.path, (tela as Record<string, unknown>)[c.path], (next as Record<string, unknown>)[c.path]))
      .map((c) => ({ path: c.path, meu: (tela as Record<string, unknown>)[c.path], dele: (next as Record<string, unknown>)[c.path] }));
    // Base CRUA da RPC: 1ª carga ou loja nova = o cru inteiro desta loja (zera, não re-baseia);
    // re-hidratação na mesma loja = `rebasearBaseRaw` (coluna em conflito, coluna EM VOO e kanban com save
    // em voo ficam com a base antiga — senão a RPC gravaria por cima da mudança alheia sem P0409).
    const cru = colunasCruas(data.cfg as Record<string, unknown> | null);
    baseRawRef.current = base
      ? rebasearBaseRaw(baseRawRef.current, cru, new Set([...pendentes.map((c) => c.path), ...emVoo]), kanbanProtegidoRef.current)
      : cru;
    cfgBaseRef.current = next;
    setCfg(tela);
    setKanbanBase(r2.kanbanBase);
    resetCfgBaseline(next); // baseline = servidor ⇒ o selo "não salvo" segue aceso só p/ o que é meu
    definirConflitos(pendentes);
    // T4: banner "Alguém salvou agora — N campos atualizados · M em conflito". Loja nova/1ª carga
    // limpa; eco sem mudança alheia mantém o banner que já estava (não pisca).
    if (!base) setUltimoMerge(null);
    else if (nAtualizados > 0 || novosConflitos.length > 0) setUltimoMerge({ atualizados: nAtualizados, conflitos: pendentes });
    else setUltimoMerge((u) => (u ? { ...u, conflitos: pendentes } : u));
    setHydrated(true);
  }, [data?.cfg, data?.tenantId]);

  const save = useMutation({
    mutationFn: async (): Promise<
      | { nada: true }
      | { nada: false; retorno: RetornoSalvarConfig; enviado: ConfigState; kanbanEnviado: KanbanColsValor }
    > => {
      if (!data?.tenantId) throw new Error("Loja não identificada para este usuário.");
      // P-57 A: o botão já trava sem `hydrated`; esta guarda cobre um `mutate()` vindo de um diálogo
      // aberto antes da troca de loja/recarga (nada de base vazia indo para a RPC).
      if (!hydrated || !cfgBaseRef.current) throw new Error("Aguarde a Configuração da Loja terminar de carregar.");
      // Revisão T3/T4 (M2): P-122 A também no handler — com conflito pendente NADA vai (o botão já trava;
      // isto cobre um `mutate()` disparado por um diálogo aberto antes do conflito chegar). Fix round
      // pós-QA (L3 + achado QA (d)): quando essa recusa chega com a prévia do Kanban aberta (A abriu
      // "Salvar e mover N cards", B reordenou/salvou nesse meio-tempo e a guarda cai aqui ANTES da
      // RPC), o dialog tem de FECHAR como as outras recusas de kanban já fazem — `fecharDialogoKanban`
      // no onError. `kanbanEmConflito` decide qual das duas mensagens mostrar lá. Fix round 1 (B3,
      // review-fixqa.md): `tinhaPrevia = !!previaSalvar` — há um caminho SEM prévia (chave desligada,
      // ou a prévia deu `mudam===0 && revelam_ref===0`) que cai no AlertDialog comum em vez do
      // KanbanSalvarDialog; se um conflito de kanban chegar nesse meio-tempo, a mensagem "…depois da
      // prévia… abra a prévia de novo" seria falsa (o usuário nunca viu prévia nenhuma).
      if (conflitosRef.current.length > 0) {
        const kanbanEmConflito = conflitosRef.current.some((c) => (KANBAN_COLS as readonly string[]).includes(c.path));
        throw Object.assign(
          new Error("Resolva os itens em conflito (manter meu ou usar o novo) antes de salvar."),
          { fecharDialogoKanban: true, conflitoEsperado: true, kanbanEmConflito, tinhaPrevia: !!previaSalvar },
        );
      }
      // T3 (Config colaborativa): UMA chamada à RPC `salvar_config_loja` com SÓ as colunas que o
      // usuário mudou nesta tela (`montarMudancas`) + a base CRUA de cada uma (`baseRawRef`) — o
      // servidor compara coluna a coluna e recusa com P0409 se outra pessoa gravou uma delas depois
      // que a tela carregou. Substitui o `upsert` da linha inteira + `update` do kanban em outra
      // transação (e a antiga falha parcial "geral gravou, kanban não"). campos_editaveis (janela
      // Nomenclaturas), tamanhos_grade e etapas_acabamento (Cadastro > Atributos) continuam FORA
      // (não estão em `COLUNAS_PAGINA`). Serialização (""→null, ref_config vazio→null, keywords só
      // espaços→null) = `serializarColuna`, byte a byte a de antes.
      const { mudancas, base } = montarMudancas({
        cfg,
        baseUi: cfgBaseRef.current,
        baseRaw: baseRawRef.current,
        kanbanBaseCfg: kanbanBase.cfg,
      });
      const diff = diffKanban(kanbanBase.cfg, pickKanban(cfg));
      const temKanban = Object.keys(diff).length > 0;
      // Médio 1 (revisão final Opus, garantia D19) + re-revisão: confere ANTES de qualquer gravação e FORA do
      // `if (temKanban)` — um eco do Realtime com a prévia aberta pode zerar o diff (a prévia mostrou N cards e
      // o salvar gravaria 0). Qualquer diferença entre o diff da prévia e o de agora ⇒ falha TOTAL (nada gravado);
      // sem prévia (chave desligada, sem mudança de kanban) os dois são {} e nada aborta.
      if (diffMudouDesdeAPrevia(diffEsperadoRef.current, diff)) {
        throw Object.assign(new Error(MENSAGEM_PREVIA_KANBAN_MUDOU), { fecharDialogoKanban: true });
      }
      if (Object.keys(mudancas).length === 0) return { nada: true };
      // Leves L3 kanban #21 (P-211 A): a etapa da REF que vai neste Salvar tem de ser a que a prévia conferiu.
      // Fix round 1 (M2): etapa da REF + Kanban no mesmo Salvar = recusa (o servidor também recusa: ref_etapa_com_kanban:).
      if (etapaRefComKanban(mudancas, KANBAN_COLS)) {
        throw Object.assign(new Error(TEXTO_REF_ETAPA_COM_KANBAN), { fecharDialogoKanban: true });
      }
      // Fix round 1 (B8): texto certo para "a etapa mudou depois da prévia" × "a prévia nem foi feita".
      const motivoRef = motivoPreviaRef(refEtapaConferidaRef.current, etapaRefNoSalvar(mudancas));
      if (motivoRef) {
        throw Object.assign(new Error(motivoRef), { fecharDialogoKanban: true });
      }
      // Leves L3 kanban #18: Formato da REF sem "Número sequencial" / sigla com número — o servidor recusa; avisa antes.
      if ("ref_config" in mudancas) {
        const problema = problemaFormatoRef(cfg.ref_config);
        if (problema) throw Object.assign(new Error(problema), { fecharDialogoKanban: true });
      }
      // Fix hidratação (P-57 A): guarda o que ESTE save está mandando — o onSuccess usa para
      // re-basear `cfgBaseRef` (o eco do PRÓPRIO save não deve ser tratado como edição alheia).
      cfgEnviadoRef.current = cfg;
      emVooRef.current = new Set(Object.keys(mudancas));
      // Fix round 2 (revisão Opus): PROTEGE o kanban da tela enquanto o save está em voo — o eco do
      // Realtime do próprio save pode chegar antes da resposta (com a chave ligada, `trg_kanban_config`
      // recalcula a loja inteira na MESMA transação da RPC, e isso demora). Liga ANTES do `await`.
      if (temKanban) kanbanProtegidoRef.current = true;
      // A chave do Kanban automático que `prepararSalvar` viu ao decidir prévia × AlertDialog comum
      // (Minor 1, garantia D19): a RPC confere na MESMA transação que grava e recusa com P0409
      // `chave_kanban_mudou:` se outra aba ligou/desligou a chave nesse meio-tempo. Obrigatória
      // quando o payload tem alguma das 5 colunas de kanban (contrato da RPC).
      const args: Record<string, unknown> = { _tenant_id: data.tenantId, _mudancas: mudancas, _base: base };
      if (temKanban) args._chave_kanban_esperada = chaveEsperadaRef.current;
      const { data: retorno, error } = await supabase.rpc("salvar_config_loja" as any, args as any);
      if (error) throw error;
      return {
        nada: false,
        retorno: (retorno ?? { gravadas: [], valores: {} }) as RetornoSalvarConfig,
        enviado: cfgEnviadoRef.current,
        kanbanEnviado: diff,
      };
    },
    // Revisão T3/T4 (I1): a loja em que ESTE save foi disparado — a resposta pode chegar depois de o super
    // admin trocar de loja; aí ela não pode mexer em bases/conflitos/selo da loja que está na tela.
    onMutate: () => ({ tenantId: data?.tenantId ?? null }),
    onSuccess: (r, _v, ctx) => {
      emVooRef.current = new Set();
      kanbanProtegidoRef.current = false;
      setPreviaSalvar(null);
      setPreviaRef(null);
      refEtapaConferidaRef.current = undefined;
      // Leves L3 kanban #21: REFs reveladas pelo Salvar (mesma transação) — os cards precisam reler a REF.
      const nReveladas = !r.nada ? Number(r.retorno.refs_reveladas ?? 0) : 0;
      if (nReveladas > 0) {
        qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
        qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      }
      if (ctx?.tenantId !== cfgBaseTenantRef.current) {
        if (!r.nada) {
          toast.success("Configurações salvas (na loja anterior).");
          qc.invalidateQueries({ predicate: (q) => matchesTable("tenant_config", q.queryKey) });
        }
        return;
      }
      if (r.nada) {
        toast.info("Nenhuma alteração para salvar.");
        markClean();
        return;
      }
      toast.success(toastRefsReveladas(nReveladas) ?? "Configurações salvas");
      markClean();
      setUltimoMerge(null);
      // Fix hidratação (P-57 A): o que este save mandou vira a base do merge — evita "não salvo"
      // falso quando o servidor NORMALIZA um valor (ex.: Keywords só com espaços → NULL,
      // `ref_config` vazio → NULL) e o eco da própria escrita chega como re-hidratação.
      // Revisão T3/T4 (M3): só as colunas GRAVADAS re-baseiam (as outras seguem como estavam — uma
      // edição feita durante o voo continua "minha", e uma base alheia ainda não ecoada não é escondida).
      const gravadas = new Set(r.retorno.gravadas ?? Object.keys(r.retorno.valores ?? {}));
      const enviado = r.enviado as Record<string, unknown>;
      if (cfgBaseRef.current) {
        const nb = { ...cfgBaseRef.current } as Record<string, unknown>;
        for (const k of gravadas) if (k in enviado) nb[k] = enviado[k];
        cfgBaseRef.current = nb as ConfigState;
      }
      // T3: a base CRUA das colunas gravadas vira o valor que o SERVIDOR devolveu (pós-gatilhos) — é
      // contra ele que o próximo save compara. Só as gravadas: re-basear as outras daqui esconderia a
      // mudança de outra pessoa que ainda não chegou pelo eco.
      baseRawRef.current = { ...baseRawRef.current, ...r.retorno.valores };
      // O que gravamos vira a nova base do kanban (o refetch abaixo também a refaz pelo efeito quando o
      // dado muda). A RPC é UMA transação: chegar aqui = tudo gravado (não existe mais falha parcial).
      setKanbanBase((b) => {
        const cfgK = { ...b.cfg } as Record<string, unknown>;
        const envK = pickKanban(r.enviado) as Record<string, unknown>;
        for (const c of KANBAN_COLS) if (gravadas.has(c)) cfgK[c] = envK[c];
        return { cfg: cfgK as KanbanColsValor, servidor: { ...b.servidor, ...r.kanbanEnviado } };
      });
      // Invalida TODA leitura de config para refletir na hora. As leituras usam prefixos
      // divergentes (tenant_config, tenant-config-grade, cad-tenant-config-grade,
      // tenant-status-kanban, ft-tamanhos, confeccao-prioridade…), então casamos por
      // predicate. Fonte única = realtime-invalidation-map (mesmo predicate do hook global
      // useRealtimeInvalidation), p/ o save local e o eco Realtime baterem 1:1.
      qc.invalidateQueries({ predicate: (q) => matchesTable("tenant_config", q.queryKey) });
    },
    onError: (e: any, _v, ctx) => {
      // A RPC é atômica: qualquer erro = NADA gravado (kanban incluído) — sem proteção a manter.
      // Leves L3 (P-211 A): qualquer recusa fecha a prévia da REF (o próximo Salvar confere de novo).
      setPreviaRef(null);
      refEtapaConferidaRef.current = undefined;
      const enviadas = [...emVooRef.current];
      emVooRef.current = new Set();
      kanbanProtegidoRef.current = false;
      const msg = String(e?.message ?? "");
      // Revisão T3/T4 (I1): erro de um save da loja ANTERIOR — só avisa; nada de conflito/refetch aqui.
      // Fix round pós-QA (L2): a redação anterior ("A loja mudou durante o salvamento…") deixava
      // ambíguo QUAL loja falhou e QUAL ficou intacta — no caso mais comum (queda de rede no meio do
      // salvar), o usuário via o erro já na loja B e podia achar que ELA não gravou. Deixa explícito:
      // foi a loja ANTERIOR que não salvou (nada gravado nela) e a loja atual (nesta tela) não foi
      // tocada por este save. Fix round 1 (B5, review-fixqa.md): motivo CURTO (`motivoCurtoLojaAnterior`)
      // em vez da frase inteira do `mensagemErro` — evita rotular todo erro desconhecido como "falha de
      // rede" e evita mandar "confira os destaques" quando não há destaque nenhum na loja atual.
      if (ctx && ctx.tenantId !== cfgBaseTenantRef.current) {
        setPreviaSalvar(null);
        setConfirmSalvar(false);
        const motivo = motivoCurtoLojaAnterior(e);
        toast.error(`Não foi possível salvar a configuração da loja anterior (${motivo}). Nada foi gravado nesta loja.`);
        return;
      }
      if (e?.code === "P0409" && msg.startsWith("conflito_versao: config_loja")) {
        // Outra pessoa gravou uma (ou mais) das colunas que ESTE save mandou, depois que a tela
        // carregou. Nada foi gravado. Marca as colunas como conflito (trava o Salvar até resolver —
        // T4 desenha o banner) e relê o servidor (o efeito preenche o valor "dele").
        // Revisão T3/T4 (M4): DETAIL vazio/ilegível ⇒ trata TODAS as colunas enviadas como em conflito
        // (melhor pedir uma escolha a mais do que regravar por cima de uma mudança alheia).
        const doDetalhe = colunasDoErro(e);
        const cols = doDetalhe.length > 0 ? doDetalhe : enviadas.filter((k) => (COLUNAS_PAGINA as readonly string[]).includes(k));
        const atualServidor = normalizarConfig(data?.cfg as Record<string, unknown> | null) as Record<string, unknown>;
        const tela = cfgRef.current as Record<string, unknown>;
        definirConflitos(juntarConflitos(conflitosRef.current, cols.map((k) => ({ path: k, meu: tela[k], dele: atualServidor[k] }))));
        setPreviaSalvar(null);
        setConfirmSalvar(false);
        const oQue = cols.length ? juntarLista(cols.map(rotuloColuna)) : "a Configuração da Loja";
        toast.error(`Outra pessoa salvou ${oQue} agora há pouco. Confira os itens em destaque e salve de novo.`);
        void refetchCfg();
        return;
      }
      if (e?.code === "P0409" && msg.startsWith("chave_kanban_mudou:")) {
        // Outra aba ligou/desligou o Kanban automático entre a prévia (ou o AlertDialog) e o
        // Salvar — a premissa da confirmação mudou. Nada gravado; fecha o diálogo e relê.
        setPreviaSalvar(null);
        setConfirmSalvar(false);
        toast.error(MENSAGEM_CHAVE_KANBAN_MUDOU);
        void refetchCfg();
        return;
      }
      // Fix round pós-QA (L3 + achado QA (d)): a guarda M2 (conflito pendente já sinalizado ANTES da
      // RPC — ex.: a prévia "Salvar e mover N cards" ficou aberta enquanto outra aba salvou e reordenou
      // as colunas) é uma RECUSA ESPERADA, não uma falha de servidor — trata como as outras recusas de
      // kanban (fecha o diálogo, toast comum, sem stack de erro). Fix round 1 (B3, review-fixqa.md):
      // a mensagem "…depois da prévia… abra a prévia de novo" só faz sentido quando o usuário REALMENTE
      // viu uma prévia (`tinhaPrevia`) — o caminho sem prévia (chave desligada, ou `mudam===0 &&
      // revelam_ref===0`, que cai no AlertDialog comum) usa o texto genérico de "mudou enquanto
      // confirmava". Fora do kanban, mantém o texto de sempre ("Resolva os itens em conflito…", já
      // tratado pela guarda do botão/banner).
      if (e?.conflitoEsperado) {
        setPreviaSalvar(null);
        setConfirmSalvar(false);
        // Não usa `mensagemErro` aqui (loga no console em DEV) — é uma recusa ESPERADA da guarda do
        // cliente, não um erro de servidor; a mensagem do próprio `Error` já é o texto final em PT.
        toast.error(
          e.kanbanEmConflito
            ? e.tinhaPrevia
              ? "A configuração do Kanban mudou depois da prévia. Confira os itens em destaque e abra a prévia de novo."
              : "A configuração do Kanban mudou enquanto você confirmava. Confira os itens em destaque e salve de novo."
            : String(e.message ?? "Resolva os itens em conflito (manter meu ou usar o novo) antes de salvar."),
        );
        return;
      }
      // Baixo 7: a config mudou depois da prévia (D19) — nada gravado. Fecha o diálogo de Salvar
      // (KanbanSalvarDialog ou o AlertDialog comum) para o usuário não ficar preso a uma
      // prévia/confirmação que já não reflete a tela; o toast explica o motivo e ele clica em Salvar de novo.
      // Fix round 1 (B4, review-fixqa.md): esta é OUTRA recusa esperada do mesmo fluxo (a config mudou
      // entre a prévia e o Salvar, sem conflito — `diffMudouDesdeAPrevia`, `MENSAGEM_PREVIA_KANBAN_
      // MUDOU`) — não pode cair no `mensagemErro` do fallback abaixo (loga no console em DEV pra uma
      // recusa que não é erro de servidor, o mesmo motivo do L3 na guarda M2). A mensagem do próprio
      // `Error` já é o texto final em PT.
      if (e?.fecharDialogoKanban) {
        setPreviaSalvar(null);
        setConfirmSalvar(false);
        toast.error(String(e.message));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  // T4 (P-122 A): resolver um conflito pendente. O "novo" é o valor ATUAL do servidor (`data.cfg`,
  // já relido pelo efeito/refetch). "manter meu": a tela fica como está e a base CRUA dessa coluna
  // passa a ser o valor do servidor — o próximo Salvar grava o meu POR CIMA, conscientemente (sem
  // P0409). "usar o novo": a tela e as bases adotam o valor do servidor (a coluna deixa de ir no save).
  // Nos dois casos o conflito sai da lista (e o Salvar destrava quando não sobrar nenhum).
  const resolverConflito = (path: string, escolha: "meu" | "dele") => {
    const cruServidor = colunasCruas(data?.cfg as Record<string, unknown> | null);
    const normServidor = normalizarConfig(data?.cfg as Record<string, unknown> | null) as Record<string, unknown>;
    baseRawRef.current = { ...baseRawRef.current, [path]: cruServidor[path] ?? null };
    if (cfgBaseRef.current) cfgBaseRef.current = { ...cfgBaseRef.current, [path]: normServidor[path] } as ConfigState;
    if ((KANBAN_COLS as readonly string[]).includes(path)) {
      const col = path as KanbanCol;
      const b = kanbanBaseRef.current;
      const nb = { cfg: { ...b.cfg, [col]: normServidor[col] }, servidor: { ...b.servidor, [col]: normServidor[col] } };
      kanbanBaseRef.current = nb;
      setKanbanBase(nb);
    }
    if (escolha === "dele") {
      setCfg((c) => ({ ...c, [path]: normServidor[path] }) as ConfigState);
    }
    const restantes = conflitosRef.current.filter((c) => c.path !== path);
    definirConflitos(restantes);
    setUltimoMerge((u) => {
      if (!u) return u;
      const conflitos = u.conflitos.filter((c) => c.path !== path);
      return conflitos.length === 0 && u.atualizados === 0 ? null : { ...u, conflitos };
    });
  };
  const blocosEmConflito = new Set(conflitosPendentes.map((c) => BLOCO_DA_COLUNA[c.path]).filter(Boolean));
  // Anel âmbar no bloco com conflito pendente (mesmo tom do destaque das outras telas colaborativas).
  const anelConflito = (bloco: string) => (blocosEmConflito.has(bloco) ? "rounded-lg ring-2 ring-amber-500 ring-offset-2" : "");

  // Presença (T4): canal por loja; o foco vai por BLOCO (`closest('[data-colab-path]')`, P-124 A).
  const { presentes } = useColabPresencaPagina({
    canal: data?.tenantId ? `colab:config-loja:${data.tenantId}` : null,
    campoFocado,
  });
  // O anel do outro aparece no bloco que CONTÉM o controle focado (diálogo/marcador por linha → bloco).
  const presentesNoBloco = useMemo(
    () => presentes.map((p) => ({ ...p, campoFocado: blocoDoFoco(p.campoFocado) })),
    [presentes],
  );
  // Trocar de loja: o foco anunciado era da loja anterior — zera (o canal novo nasce limpo).
  useEffect(() => {
    setCampoFocado(null);
  }, [data?.tenantId]);

  // Salvar: com mudança nas colunas de kanban, confere o conflito (RP3) e, com a chave LIGADA no banco, mostra a
  // prévia (`kanban_previa_recalculo` com SÓ o que mudou) antes de confirmar. Sem cards mudando nem REF revelada
  // → o AlertDialog de sempre. A F1 não confere se a prévia foi vista (D19) — a garantia é esta função.
  const prepararSalvar = async () => {
    refEtapaConferidaRef.current = undefined;
    // T4 (decisão do controlador): nada mudou ⇒ avisa JÁ, sem abrir a confirmação "Salvar mesmo
    // assim" (que não teria o que salvar). O `mutationFn` mantém a mesma checagem como defesa.
    let etapaRef: { valor: string | null } | null = null;
    if (cfgBaseRef.current) {
      const { mudancas } = montarMudancas({
        cfg,
        baseUi: cfgBaseRef.current,
        baseRaw: baseRawRef.current,
        kanbanBaseCfg: kanbanBase.cfg,
      });
      if (Object.keys(mudancas).length === 0) {
        toast.info("Nenhuma alteração para salvar.");
        markClean();
        return;
      }
      // Leves L3 kanban #18: Formato da REF fora da regra — o servidor recusaria; avisa antes de qualquer diálogo.
      if ("ref_config" in mudancas) {
        const problema = problemaFormatoRef(cfg.ref_config);
        if (problema) { toast.error(problema); return; }
      }
      // Leves L3 fix round 1 (M2): a etapa da REF e o Kanban vão em dois Salvar (as 2 prévias ficariam com meio estado).
      if (etapaRefComKanban(mudancas, KANBAN_COLS)) { toast.error(TEXTO_REF_ETAPA_COM_KANBAN); return; }
      etapaRef = etapaRefNoSalvar(mudancas);
    }
    // Leves L3 kanban #21 (P-211 A): a etapa de revelar a REF vai neste Salvar → prévia só leitura ANTES de confirmar
    // ("N REFs serão reveladas (não voltam)"). Com N > 0 abre o RefRevelarDialog; o "Salvar e revelar" segue para o
    // resto (kanban) já como confirmado. N = 0: segue direto (sem diálogo extra).
    if (etapaRef && data?.tenantId) {
      setPreparandoSalvar(true);
      try {
        const p = await refPreviaRevelar(data.tenantId, etapaRef.valor);
        refEtapaConferidaRef.current = etapaRef;
        if (p.total > 0) { setPreviaRef(p); return; }
      } catch (e) {
        toast.error(mensagemErro(e, "Erro ao preparar o salvamento"));
        return;
      } finally {
        setPreparandoSalvar(false);
      }
    }
    await continuarSalvar(false);
  };

  // O resto do preparo (kanban). `jaConfirmou` = a pessoa já confirmou na prévia da REF: o caminho que abriria o
  // AlertDialog comum salva direto (não pergunta 2 vezes); a prévia do kanban (cards que mudam) continua aparecendo.
  const continuarSalvar = async (jaConfirmou: boolean) => {
    const confirmar = () => {
      if (jaConfirmou) save.mutate();
      else setConfirmSalvar(true);
    };
    const diff = diffKanban(kanbanBase.cfg, pickKanban(cfg));
    // Médio 1 (garantia D19): guarda o diff que embasa a decisão desta chamada — tanto o caminho sem
    // prévia (AlertDialog comum) quanto o com prévia (KanbanSalvarDialog). O `mutationFn` recalcula o
    // diff na hora de salvar e aborta se divergir deste (a tela seguiu editável durante os `await`s
    // abaixo).
    diffEsperadoRef.current = diff;
    if (!data?.tenantId || Object.keys(diff).length === 0) { confirmar(); return; }
    setPreparandoSalvar(true);
    try {
      const row = await lerConfigServidor(data.tenantId);
      // Baixo 4: mesmo normalizador do `mutationFn` — os dois lados da comparação no mesmo espaço
      // (normalizado), senão `status_kanban` NULL no banco nunca bate contra o DEFAULTS guardado em
      // `kanbanBase.servidor`.
      const conflito = conflitoKanban(kanbanBase.servidor, normalizarKanbanDefaults(pickKanban(row), pickKanban(DEFAULTS)));
      if (conflito.length > 0) { toast.error(mensagemConflitoKanban(conflito)); return; }
      // Guarda a chave que embasou esta decisão (prévia ou AlertDialog comum) — o `mutationFn` relê
      // e aborta se mudou nesse meio-tempo (Minor 1, garantia D19: sem isso, outra aba ligando a
      // chave com o diálogo aberto faria o Salvar mover cards em cascata sem prévia nenhuma).
      chaveEsperadaRef.current = row?.kanban_automatico === true;
      if (row?.kanban_automatico !== true) { confirmar(); return; }
      const previa = await kanbanPreviaRecalculo(diff as Record<string, unknown>);
      if (previa.mudam === 0 && previa.revelam_ref === 0) { confirmar(); return; }
      setPreviaSalvar({ previa, mudancas: descreverMudancasKanban(Object.keys(diff) as KanbanCol[]) });
    } catch (e) {
      toast.error(mensagemErro(e, "Erro ao preparar o salvamento"));
    } finally {
      setPreparandoSalvar(false);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/" />;
  // Fix hidratação rodada 1 (achado I1 da revisão): carga com ERRO nunca deve cair nos DEFAULTS —
  // mostra o aviso + "Tentar de novo" no lugar do formulário. Nenhum hook depois deste ponto
  // (mesma verificação já feita para o `isLoading` abaixo).
  // Fix hidratação rodada 2 (achado N1 da re-revisão — regressão): `&& !data` — uma vez que a 1ª
  // carga teve sucesso, um erro de REFETCH posterior (foco de janela, invalidate de outra tela)
  // NÃO pode trocar a página inteira pelo aviso e esconder o formulário com a edição em curso; o
  // TanStack v5 mantém `data` (o último bom) mesmo quando o refetch falha.
  if (cfgLoadErrored && !data) {
    return (
      <div className="p-6 space-y-3 text-sm">
        <p className="text-destructive font-medium">Não foi possível carregar os dados.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetchCfg()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  // Fix hidratação (P-57 A, §4.1, metade 1): não editar/salvar com DEFAULTS antes da 1ª carga —
  // sem isso, o usuário digita em cima de "" (fuso/kanban/etc. com cara de dado real) e a 1ª
  // resolução da query sobrescreve. Nenhum hook depois deste ponto (verificado).
  // [modularidade F2, m3] a página não está sob RequirePermission: sem esperar `pronto`, os blocos por módulo/perfil piscam com os DEFAULTS.
  // [backend F1] a 1ª carga da loja/módulos falhou: avisa com "Tentar de novo" (senão ficaria em "Carregando…" para sempre).
  if (modulosErro) return <LojaErroAviso onTentarDeNovo={tentarModulosDeNovo} />;
  if (isLoading || modulosCarregando) return <div className="p-6 text-muted-foreground">Carregando…</div>;

  // [modularidade F4, P-254 A] condições do kanban que NÃO SE APLICAM a esta loja (módulo desligado): o servidor já as trata
  // como cumpridas; aqui só esmaecem no diálogo de Requisitos (não dá para adicionar; as já gravadas ganham selo âmbar).
  // Depois do `pronto` (o guard acima): com os DEFAULTS de antes da carga nenhuma condição apareceria como "não se aplica".
  const condsModuloOff = condicoesForaDoModulo(modules);

  // Envio à Explosão: derivado do próprio status_kanban (marcador POR LINHA no bloco do
  // kanban, não mais um card separado — feedback do dono, ago/2026). Espelha a mesma
  // regra "" ⇒ 'aprovado' (histórico) + coluna órfã de `podeEnviarExplosao`/`_explosao_envio_gate`.
  const explosaoKanbanOptions = normalizeKanbanStatuses(cfg.status_kanban);
  const explosaoOptionKeys = new Set(explosaoKanbanOptions.map((o) => o.key));
  const explosaoCfgSet = !!(cfg.explosao_envio_status ?? "").trim();
  const explosaoEffectiveKey = explosaoCfgSet ? (cfg.explosao_envio_status as string).trim() : APROVADO_KEY;
  const explosaoOrphan = !explosaoOptionKeys.has(explosaoEffectiveKey);

  // Exibir REF: 2º marcador POR LINHA no mesmo bloco (mesma régua/fallback do Envio à Explosão).
  const refCfgSet = !!(cfg.ref_exibir_status ?? "").trim();
  const refEffectiveKey = refCfgSet ? (cfg.ref_exibir_status as string).trim() : APROVADO_KEY;
  const refOrphan = !explosaoOptionKeys.has(refEffectiveKey);

  // Etiqueta Entrada/Automática/Manual por coluna (F2) — mesma regra do motor (`colunaManual`): sem requisito
  // PRÓPRIO = manual; Reprovado sempre manual; 1ª coluna = Entrada. Reflete o que está NA TELA (não salvo ainda).
  const kanbanCfgTela = lerKanbanAutoConfig(cfg);
  const boardKeysTela = boardDaLoja(kanbanCfgTela).map((c) => c.key);
  // Kanban #9 — aviso âmbar (não bloqueia) + atalho p/ o card "Fluxo de Revenda".
  const avisoRevenda = revendaSemRequisitos(!!(modules as any).produto_acabado, cfg.revenda_kanban_requisitos);
  const irParaFluxoRevenda = () => {
    setTimeout(() => document.getElementById("fluxo-revenda-card")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const fluxoRevendaTela = fluxoDoModelo("revenda", kanbanCfgTela).map((c) => c.key);
  // Baixo 3 (revisão final Opus): a chave LIGADA no banco (não a edição não-salva da tela) — é o que
  // faz o quadro de Desenvolvimento andar sozinho de verdade. Com a chave DESLIGADA, "Automática: entra
  // sozinho" seria um texto FALSO (nenhuma coluna anda sozinha ainda). Ruling (registrado): ESCONDE as
  // etiquetas por coluna (`ModoColunaBadge`, nas duas telas — Status do Kanban e Fluxo de Revenda) e o
  // Reprovado só fica travado (`bloqueadoMotivo`) com a chave ligada — menos intrusivo que enfiar
  // "(quando ligado)" em CADA linha da lista de colunas. O rodapé (1 linha só, não repetida por coluna)
  // usa texto condicional em vez de sumir, porque é a única explicação geral de "o que é manual" e some
  // junto com o contexto que a explica.
  const kanbanChaveLigada = (data?.cfg as any)?.kanban_automatico === true;

  return (
    <div
      ref={colabScopeRef}
      className="container mx-auto p-3 sm:p-6 space-y-6 pb-24"
      // T4 (P-124 A): presença POR BLOCO — o foco anuncia o `data-colab-path` do bloco que contém o
      // controle (inclui o diálogo de Requisitos, que é portal: o evento sobe pela árvore do React e o
      // `closest` acha o `data-colab-path` do próprio DialogContent).
      onFocusCapture={(e) => {
        const el = (e.target as HTMLElement | null)?.closest?.("[data-colab-path]");
        setCampoFocado(el?.getAttribute("data-colab-path") ?? null);
      }}
      onBlurCapture={() => setCampoFocado(null)}
    >
      {/* Fix round pós-QA (achado #8) + B1 (review-fixqa.md): `abaixoDeModal` — este é o overlay da
          PÁGINA; com o dialog "Nomenclaturas" (ou o AlertDialog de confirmar Salvar/o
          KanbanSalvarDialog) aberto por cima, o anel de quem está num campo da página de TRÁS não
          pode desenhar por cima do backdrop desses modais. O foco `cfg:kanban_requisitos` do
          diálogo de Requisitos é convertido para o bloco da página `cfg:status_kanban` por
          `blocoDoFoco` (abaixo) — o campo resolvido por ESTE overlay para essa marca é sempre um
          elemento da PÁGINA (nunca o `DialogContent` do Requisitos, que é portal fora deste
          `colabScopeRef`), então `dentroDeDialog` nunca é `true` aqui; a checagem por marca em
          `ColabPresenceOverlay` é uma salvaguarda para outra classe de uso (scope dentro de um
          Sheet/Dialog), não o caso do Requisitos. */}
      <ColabPresenceOverlay presentes={presentesNoBloco} scopeRef={colabScopeRef} abaixoDeModal />
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Settings className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight">Configurações da Loja</h1>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
            <p className="text-sm text-muted-foreground">
              Parâmetros usados em todo o fluxo de produção.
            </p>
          </div>
        </div>
      </header>

      {/* T4: quem mais está nesta tela + o que outra pessoa salvou agora + conflitos a resolver
          ("manter meu" · "usar o novo"; o Salvar fica travado até resolver todos — P-122 A). */}
      <ColabBanner
        presentes={presentes}
        ultimoMerge={ultimoMerge}
        conflitos={conflitosPendentes}
        onResolver={resolverConflito}
        rotulo={rotuloColuna}
      />

      {/* Módulos (badges) à esquerda + Fuso à direita — logo abaixo do header, sem card. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Label className="text-xs text-muted-foreground">Módulos da loja</Label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {MODULE_LABELS.map((m) => {
              const on = !!(modules as any)[m.key];
              return (
                <Badge key={m.key} variant={on ? "default" : "secondary"} className={on ? "" : "opacity-60"}>
                  {m.label}: {on ? "Ativo" : "Inativo"}
                </Badge>
              );
            })}
          </div>
        </div>
        {!isStockOnly && (
          <div data-colab-path="cfg:timezone" className={"shrink-0 sm:text-right " + anelConflito("cfg:timezone")}>
            <Label className="text-xs text-muted-foreground">Fuso horário (GMT)</Label>
            <Select value={cfg.timezone} onValueChange={(v) => setCfg({ ...cfg, timezone: v })}>
              <SelectTrigger className="mt-1.5 w-full sm:w-72"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Blocos em grade responsiva de 2 colunas no desktop (distribui alternando as
          colunas), 1 no mobile. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
      {/* Modo só-estoque: só Nomenclaturas + Módulos da loja. O restante (produção,
          fuso, baixa, OC/rolo, ERP) fica escondido. */}
      {!isStockOnly && (<>
      {/* Serviços (categorias), Acabamento e Grade de Tamanhos migraram p/ Cadastro > Atributos.
          A Config NÃO gerencia mais esses campos (ver exclusão no payload do save). */}
      {blocos.statusKanban && (
      <div data-colab-path="cfg:status_kanban" className={anelConflito("cfg:status_kanban")}>
      <SortableListCard
        title="Status do Kanban"
        description="Colunas do painel de Desenvolvimento. Em cada status, defina os Requisitos (o que um card precisa ter preenchido para ENTRAR nele) e marque, se for o caso, a etapa a partir da qual libera o Envio à Explosão e a etapa a partir da qual o campo REF aparece no card."
        items={cfg.status_kanban}
        // Updater FUNCIONAL (não `{ ...cfg, ... }` sobre o `cfg` capturado no closure):
        // `onItemRemoved` (abaixo) já dispara um `setCfg` funcional pra limpar o Envio à
        // Explosão ANTES deste `onChange` rodar, no MESMO handler síncrono de excluir — um
        // `setCfg({ ...cfg, ... })` aqui usaria o `cfg` stale (de antes da limpeza) e
        // sobrescreveria a limpeza (regressão real, pega em QA interativo).
        onChange={(items) => setCfg((c) => ({ ...c, status_kanban: items }))}
        placeholder="Ex: Em Modelagem"
        topo={
          <KanbanAutomaticoBloco
            ligado={(data?.cfg as any)?.kanban_automatico === true}
            disponivel={motorKanbanDisponivel(data?.cfg) && (modules as any).criacao !== false}
            travadoMotivo={dirty ? "Salve ou descarte as alterações desta página antes de ligar ou desligar o Kanban automático." : null}
            cols={boardDaLoja(kanbanCfgTela)}
            timezone={cfg.timezone}
            avisoRevenda={avisoRevenda}
            onIrParaFluxoRevenda={irParaFluxoRevenda}
            onMudou={() => {
              qc.invalidateQueries({ predicate: (q) => matchesTable("tenant_config", q.queryKey) });
              qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
              qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
            }}
          />
        }
        renderItemExtra={(label) => {
          const key = resolveStatusKey(label);
          const checked = !explosaoOrphan && key === explosaoEffectiveKey;
          const ghost = checked && !explosaoCfgSet;
          const refChecked = !refOrphan && key === refEffectiveKey;
          const refGhost = refChecked && !refCfgSet;
          // CASCATA: ordem das colunas (por key) e requisitos herdados desta etapa.
          const ordemColunas = cfg.status_kanban.map(resolveStatusKey);
          const herdados = requisitosHerdados(key, ordemColunas, cfg.kanban_requisitos ?? {});
          const nomeDaEtapa = (sk: string) => cfg.status_kanban.find((l) => resolveStatusKey(l) === sk) ?? sk;
          return (
            <>
              {kanbanChaveLigada && <ModoColunaBadge modo={modoColuna(key, boardKeysTela, cfg.kanban_requisitos ?? {})} />}
              <RequisitosStatusButton
                label={label}
                bloqueadoMotivo={kanbanChaveLigada && key === "reprovado" ? MOTIVO_REPROVADO_MANUAL : undefined}
                requisitos={cfg.kanban_requisitos?.[key] ?? []}
                onChange={(next) =>
                  setCfg((c) => {
                    const map = { ...(c.kanban_requisitos ?? {}) };
                    if (next.length) map[key] = next; else delete map[key];
                    return { ...c, kanban_requisitos: map };
                  })
                }
                herdados={herdados}
                // Leves L3 kanban #3 (P-210 A): editor de exceções OCULTO (código guardado) — sem `onExcecoesChange` os
                // herdados ficam travados no diálogo (uma exceção já gravada só aparece, não muda).
                excecoes={cfg.kanban_requisitos_excecoes?.[key] ?? []}
                onExcecoesChange={EXCECOES_REQUISITO_OCULTAS ? undefined : (next) =>
                  setCfg((c) => {
                    const map = { ...(c.kanban_requisitos_excecoes ?? {}) };
                    if (next.length) map[key] = next; else delete map[key];
                    return { ...c, kanban_requisitos_excecoes: map };
                  })
                }
                nomeEtapa={nomeDaEtapa}
                condsModuloOff={condsModuloOff}
                colabPath="cfg:kanban_requisitos"
              />
              {blocos.envioExplosao && (
              <EnvioExplosaoToggle
                label={label}
                checked={checked}
                ghost={ghost}
                onToggle={(nextOn) =>
                  setCfg((c) => ({
                    ...c,
                    explosao_envio_status: nextOn ? (key === APROVADO_KEY ? "" : key) : "",
                  }))
                }
              />
              )}
              <RefExibirToggle
                label={label}
                checked={refChecked}
                ghost={refGhost}
                onToggle={(nextOn) =>
                  setCfg((c) => ({
                    ...c,
                    ref_exibir_status: nextOn ? (key === APROVADO_KEY ? "" : key) : "",
                  }))
                }
              />
            </>
          );
        }}
        onItemRemoved={(label) => {
          const removedKey = resolveStatusKey(label);
          const explVal = (cfg.explosao_envio_status ?? "").trim();
          if (explVal && removedKey === explVal) {
            setCfg((c) => ({ ...c, explosao_envio_status: "" }));
            toast.warning(
              'Etapa marcada para Envio à Explosão foi excluída — a marcação voltou ao padrão (Aprovado).',
            );
          }
          const refVal = (cfg.ref_exibir_status ?? "").trim();
          if (refVal && removedKey === refVal) {
            setCfg((c) => ({ ...c, ref_exibir_status: "" }));
            toast.warning(
              'Etapa marcada para exibir a REF foi excluída — a marcação voltou ao padrão (Aprovado).',
            );
          }
        }}
        footer={
          <div className="space-y-1.5 border-t pt-3">
            {blocos.envioExplosao && (
            <p className="text-xs text-muted-foreground">
              <Send className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              Modelos podem ser enviados à Explosão a partir da etapa marcada (ou de
              etapas posteriores). Padrão: <span className="font-medium">Aprovado</span>.
            </p>
            )}
            {blocos.envioExplosao && explosaoOrphan && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {explosaoCfgSet
                  ? `A etapa marcada para Envio à Explosão ("${explosaoEffectiveKey.replace(/_/g, " ")}") não existe mais nas colunas do kanban. Enquanto não marcar outra, o envio volta a exigir "Aprovado".`
                  : `Esta loja não tem a coluna "Aprovado" no kanban. Marque a etapa a partir da qual liberar o envio à Explosão.`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              <Tag className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              O campo <span className="font-medium">REF</span> aparece no card a partir da
              etapa marcada (ou de etapas posteriores). Padrão: <span className="font-medium">Aprovado</span>.
            </p>
            {refOrphan && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {refCfgSet
                  ? `A etapa marcada para exibir a REF ("${refEffectiveKey.replace(/_/g, " ")}") não existe mais nas colunas do kanban. Enquanto não marcar outra, a REF volta a aparecer só em "Aprovado".`
                  : `Esta loja não tem a coluna "Aprovado" no kanban. Marque a etapa a partir da qual exibir a REF no card.`}
              </p>
            )}
            {kanbanChaveLigada ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
                <span className="flex items-center gap-1">
                  <LogIn className="h-3.5 w-3.5" /> Entrada
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> Automática
                </span>
                <span className="flex items-center gap-1">
                  <Hand className="h-3.5 w-3.5" /> Manual
                </span>
                <span className="flex items-center gap-1">
                  <Hand className="h-3.5 w-3.5" /><Lock className="h-3 w-3 -ml-1" /> Manual (sempre)
                </span>
                <span className="w-full text-muted-foreground">
                  Coluna sem requisito é manual: o card só entra e sai dela arrastado. Reprovado é sempre manual.
                </span>
              </div>
            ) : (
              <p className="text-xs text-foreground">
                <Hand className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                Com o Kanban automático ligado, coluna sem requisito é manual: o card só entra e sai dela arrastado. Reprovado é sempre manual.
              </p>
            )}
          </div>
        }
      />
      </div>
      )}

      {blocos.formatoRef && (
      <div data-colab-path="cfg:ref_config" className={anelConflito("cfg:ref_config")}>
        <FormatoRefCard
          value={cfg.ref_config}
          onChange={(ref_config) => setCfg((c) => ({ ...c, ref_config }))}
        />
      </div>
      )}
      {/* Formato do SKU grava sozinho (sku_config — fora do Salvar da página): só o anel de presença. */}
      <div data-colab-path="cfg:sku_config">
        <FormatoSkuCard paginaSuja={dirty} />
      </div>

      {blocos.fluxoRevenda && (
        <FluxoRevendaCard
          statusKanban={cfg.status_kanban}
          fluxoKeys={fluxoRevendaTela}
          colunas={cfg.revenda_kanban_colunas}
          requisitos={cfg.revenda_kanban_requisitos}
          campos={cfg.revenda_campos}
          chaveLigada={kanbanChaveLigada}
          condsModuloOff={condsModuloOff}
          onColunasChange={(revenda_kanban_colunas) => setCfg((c) => ({ ...c, revenda_kanban_colunas }))}
          onRequisitosChange={(revenda_kanban_requisitos) => setCfg((c) => ({ ...c, revenda_kanban_requisitos }))}
          onCamposChange={(revenda_campos) => setCfg((c) => ({ ...c, revenda_campos }))}
          anelConflito={anelConflito}
        />
      )}

      <div data-colab-path="cfg:leadtime" className={anelConflito("cfg:leadtime")}>
        <LeadtimeConfigCard
          tenantId={data?.tenantId ?? null}
          statusKanban={cfg.status_kanban}
          value={cfg.leadtime}
          modules={modules}
          onChange={(leadtime) => setCfg((c) => ({ ...c, leadtime }))}
        />
      </div>

      {blocos.etapasPl && (
        <div data-colab-path="cfg:pcp_etapas" className={anelConflito("cfg:pcp_etapas")}>
          <EtapasPLCard
            value={cfg.pcp_etapas}
            onChange={(pcp_etapas) => setCfg((c) => ({ ...c, pcp_etapas }))}
          />
        </div>
      )}

      <Card data-colab-path="cfg:modo_oc_rolo" className={anelConflito("cfg:modo_oc_rolo")}>
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

      <Card data-colab-path="cfg:modo_baixa_estoque" className={anelConflito("cfg:modo_baixa_estoque")}>
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
      </>)}

      <Card data-colab-path="cfg:markup_analise_faixa" className={anelConflito("cfg:markup_analise_faixa")}>
        <CardHeader>
          <CardTitle>Planejamento — análise de markup</CardTitle>
          <CardDescription>
            Mostra, no card do Planejamento, dois blocos por faixa de markup (mín/ideal/máx da Linha):
            o <b>preço que cada faixa pede</b> e a <b>mão de obra que ainda cabe</b>. Desligado por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              id="markup-analise-faixa"
              checked={cfg.markup_analise_faixa}
              onCheckedChange={(v) => setCfg((c) => ({ ...c, markup_analise_faixa: !!v }))}
              aria-label="Análise de markup por faixa"
            />
            <Label htmlFor="markup-analise-faixa" className="cursor-pointer font-normal">
              Análise de markup por faixa (Preço por faixa + M.O. que cabe)
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card data-colab-path="cfg:nomenclaturas">
        <CardHeader>
          <CardTitle>Nomenclaturas</CardTitle>
          <CardDescription>
            Renomeie as abas do menu (módulos e páginas) e os campos de cada módulo.
            Deixe em branco para manter o nome padrão.{" "}
            <strong className="text-foreground">Salvas na própria janela</strong>, separado do botão "Salvar alterações" acima.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NomesDasAbasDialog tenantId={data?.tenantId ?? null} modules={(data?.cfg as any)?.modules ?? {}} presentes={presentes} />
        </CardContent>
      </Card>

      {/* F3.6 (dono 25/set, R39) — Keywords da loja: texto livre, no Salvar do rodapé (mesma guarda de alterações não
          salvas). Visível p/ quem já abre a Config (admin da loja e super admin). Uso: tela FUTURA do super admin, por loja. */}
      <Card data-colab-path="cfg:keywords" className={anelConflito("cfg:keywords")}>
        <CardHeader>
          <CardTitle>Keywords</CardTitle>
          <CardDescription>Palavras-chave da loja, em texto livre. Salvas com o botão "Salvar alterações".</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1">
            <Label htmlFor="cfg-keywords">Keywords</Label>
            <Textarea
              id="cfg-keywords"
              rows={4}
              placeholder="Ex.: moda feminina, vestidos de festa, linho…"
              value={cfg.keywords}
              onChange={(e) => setCfg((c) => ({ ...c, keywords: e.target.value }))}
            />
          </div>
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
            <li>Filtrar <code>cancelado</code>/<code>is_rolo</code>; parcelas a pagar ≠ parcelas de recebimento; "vencido" é derivado.</li>
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
      </div>

      <PageActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        {/* P-57 A (fix "salvar rápido") + T3 da Config colaborativa: NÃO remover nenhuma destas travas.
            `!hydrated` — a query resolveu mas o efeito ainda não semeou `cfg`/`cfgBaseRef`/`baseRawRef`:
            salvar nesse instante mandaria os DEFAULTS da tela (fuso, kanban, leadtime…) contra uma base
            vazia, gravando um estado incompleto por cima da linha real da loja. `!data?.tenantId` — a
            loja ainda não resolveu (ou o usuário está sem loja): não há para onde mandar a RPC.
            `conflitosPendentes.length > 0` (P-122 A) — outra pessoa salvou um item que eu também mexi:
            resolver ("manter meu" / "usar o novo", T4) antes de salvar. */}
        <Button
          className="ml-auto"
          onClick={prepararSalvar}
          disabled={save.isPending || isLoading || preparandoSalvar || !hydrated || !data?.tenantId || conflitosPendentes.length > 0}
        >
          <Save className="h-4 w-4 mr-2" />
          {save.isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </PageActionBar>

      {previaSalvar && (
        <KanbanSalvarDialog
          previa={previaSalvar.previa}
          // Minor 4 (fix round 1): a prévia mostra "De → Para" de uma mudança AINDA NÃO salva — "De"
          // tem que vir do board de ANTES da edição (`kanbanBase.cfg`, o snapshot com que a tela
          // abriu), senão coluna renomeada/excluída aparece com a key crua (o board NOVO não a tem
          // mais). "Para" segue correto com o board novo (é pra onde os cards vão DEPOIS de salvar).
          colsDe={boardDaLoja(lerKanbanAutoConfig(kanbanBase.cfg))}
          colsPara={boardDaLoja(kanbanCfgTela)}
          mudancas={previaSalvar.mudancas}
          avisoRevenda={avisoRevenda}
          onIrParaFluxoRevenda={irParaFluxoRevenda}
          salvando={save.isPending}
          onConfirmar={() => save.mutate()}
          onClose={() => setPreviaSalvar(null)}
        />
      )}

      {previaRef && (
        <RefRevelarDialog
          previa={previaRef}
          cols={boardDaLoja(kanbanCfgTela)}
          salvando={save.isPending || preparandoSalvar}
          onConfirmar={() => {
            setPreviaRef(null);
            void continuarSalvar(true);
          }}
          onClose={() => {
            setPreviaRef(null);
            refEtapaConferidaRef.current = undefined;
          }}
        />
      )}

      {/* Confirmação: salvar config afeta dados de toda a loja. */}
      <AlertDialog open={confirmSalvar} onOpenChange={setConfirmSalvar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar as configurações da loja?</AlertDialogTitle>
            <AlertDialogDescription>
              Estas configurações afetam dados de <strong>toda a loja</strong> — fuso
              horário, status do kanban (e requisitos), modo de baixa de estoque, modo
              OC/Rolo e configuração de leadtime. Alterar algo que já está em uso pode
              deixar registros existentes inconsistentes. Deseja continuar?
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

      <UnsavedChangesGuard
        confirm={confirm}
        message="Há alterações não salvas nas configurações da loja."
      />
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
  // "Explosão" = tempo na etapa de Explosão (entrar no CAD → Enviar para PCP); a tela CAD/corte
  // não existe mais, o `cad_corte` é só a key interna. "Tempo em produção" = fase de serviços.
  { key: "cad_corte", label: "Explosão" },
  { key: "servicos", label: "Tempo em produção" },
  { key: "cq", label: "CQ" },
  { key: "direcionamento", label: "Direcionamento" },
  { key: "lancamento", label: "Lançamento" },
];

type LtTipo = "macro" | "kanban" | "servico";
type LtEtapa = { key: string; tipo: LtTipo; idealDias: number };
type LtConfig = { etapas: LtEtapa[]; slaServico: string | null };
type LtItem = { key: string; tipo?: LtTipo; label?: string; indent?: boolean; caption?: string };

// Envio à Explosão: marcador POR LINHA dentro do bloco "Status do Kanban" (não é mais
// card separado — feedback do dono, ago/2026: "quer a escolha DENTRO do bloco que já
// configura os status do kanban"). Escolha ÚNICA (semântica "a partir DESTA etapa"): marcar
// uma linha desmarca a anterior — ver o `onToggle` armado em `ConfiguracoesLojaPage`, que
// grava a chave (ou "" pra 'aprovado', mantendo o default histórico limpo no payload).
// `ghost` = esta é a linha "Aprovado" servindo de PADRÃO (nenhuma marcação explícita) —
// visualmente distinta de uma marcação real (outline tingido vs. preenchido) e de "off"
// (outline neutro). Espelha `podeEnviarExplosao`/`_explosao_envio_gate` (front+RPC).
function EnvioExplosaoToggle({
  label,
  checked,
  ghost,
  onToggle,
}: {
  label: string;
  checked: boolean;
  ghost: boolean;
  onToggle: (nextOn: boolean) => void;
}) {
  const stateTxt = ghost ? "padrão — Aprovado" : checked ? "marcado" : "desmarcado";
  return (
    <Button
      type="button"
      variant={checked ? (ghost ? "outline" : "default") : "outline"}
      size="sm"
      className={
        "h-8 shrink-0 max-md:h-11 max-md:w-11 max-md:p-0" +
        (ghost ? " border-primary text-primary" : "")
      }
      aria-pressed={checked}
      aria-label={`Envio à Explosão a partir de "${label}" (${stateTxt})`}
      data-colab-path="cfg:explosao_envio_status"
      onClick={() => onToggle(!checked)}
    >
      <Send className="h-4 w-4 sm:mr-1" />
      <span className="max-sm:sr-only">{ghost ? "Padrão" : "Explosão"}</span>
    </Button>
  );
}

// Exibir REF: 2º marcador POR LINHA no bloco "Status do Kanban" — a partir de qual etapa o
// campo REF aparece no card de Desenvolvimento (e a REF automática é revelada). Escolha
// ÚNICA (semântica "a partir DESTA etapa"), mesmo mecânica do EnvioExplosaoToggle, com ícone
// Tag p/ distinguir do Send. Espelha `refCampoVisivel`/`_ref_exibir_gate` (front+trigger).
function RefExibirToggle({
  label,
  checked,
  ghost,
  onToggle,
}: {
  label: string;
  checked: boolean;
  ghost: boolean;
  onToggle: (nextOn: boolean) => void;
}) {
  const stateTxt = ghost ? "padrão — Aprovado" : checked ? "marcado" : "desmarcado";
  return (
    <Button
      type="button"
      variant={checked ? (ghost ? "outline" : "default") : "outline"}
      size="sm"
      className={
        "h-8 shrink-0 max-md:h-11 max-md:w-11 max-md:p-0" +
        (ghost ? " border-primary text-primary" : "")
      }
      aria-pressed={checked}
      aria-label={`Exibir REF a partir de "${label}" (${stateTxt})`}
      data-colab-path="cfg:ref_exibir_status"
      onClick={() => onToggle(!checked)}
    >
      <Tag className="h-4 w-4 sm:mr-1" />
      <span className="max-sm:sr-only">{ghost ? "Padrão" : "REF"}</span>
    </Button>
  );
}

function LeadtimeConfigCard({
  tenantId,
  statusKanban,
  value,
  modules,
  onChange,
}: {
  tenantId: string | null;
  statusKanban: string[];
  value: LtConfig;
  /** Mapa resolvido da loja (só chega aqui depois do `pronto`). Esconde Explosão sem E&S e Serviços/CQ/Direcionamento sem Produção. */
  modules: Partial<Record<ModuleKey, boolean>>;
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

  // Produção em ordem de fluxo; sob "Tempo em produção", as categorias como micro.
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
  // `todas` inclui as etapas de módulo desligado: o `commit` ordena/regrava por ELAS, então esconder não apaga o que já está salvo.
  const todas: { key: string; tipo: LtTipo; label: string }[] = [
    { ...LEADTIME_PLANEJAMENTO, tipo: "macro" as const },
    ...statusKanban.map((label) => ({ key: "kanban:" + resolveStatusKey(label), tipo: "kanban" as const, label })),
    ...producaoItens.filter((it) => !it.caption).map((it) => ({ key: it.key, tipo: it.tipo!, label: it.label! })),
  ];
  const visivel = (key: string) => etapaLeadtimeVisivel(key, modules);
  const disponiveis = todas.filter((d) => visivel(d.key));
  const producaoVisiveis = producaoItens.filter((it) => visivel(it.caption ? "servicos" : it.key));
  const sel = new Map(value.etapas.map((e) => [e.key, e]));

  // Reescreve a seleção sempre na ordem canônica da lista de disponíveis (preserva slaServico).
  function commit(next: Map<string, LtEtapa>) {
    onChange({ ...value, etapas: todas.filter((d) => next.has(d.key)).map((d) => next.get(d.key)!) });
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
          itens={producaoVisiveis}
          sel={sel}
          onToggle={toggle}
          onIdeal={setIdeal}
        />

        {/* Prazo de Serviços vindo do "SLA de Serviços" da Subcategoria 1 do item (varia por
            produto). Opções filtradas aos serviços de confecção (oficina/costura/PL). */}
        {modules.producao !== false && (
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
        )}
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
              {/* Rótulo clicável = alvo de toque grande no mobile (o Switch é pequeno). */}
              <span
                className="flex-1 cursor-pointer select-none truncate text-sm"
                onClick={() => onToggle({ key: d.key, tipo: d.tipo! }, !on)}
              >{d.label}</span>
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
  onItemRemoved,
  footer,
  topo,
}: {
  title: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  renderItemExtra?: (label: string, index: number) => React.ReactNode;
  // Chamado ANTES de remover, com o item que está saindo — p/ limpar config derivada
  // (ex.: Envio à Explosão) que apontava pra essa linha.
  onItemRemoved?: (label: string, index: number) => void;
  // Conteúdo extra abaixo da lista (legenda/avisos do bloco).
  footer?: React.ReactNode;
  // Conteúdo no TOPO do card, antes do campo de adicionar (Status do Kanban: a chave "Kanban automático").
  topo?: React.ReactNode;
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
    onItemRemoved?.(items[index], index);
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {topo}
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
        {footer}
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
  const trashButton = (
    <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Excluir item">
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
  return (
    <li ref={setNodeRef} style={style} className="rounded-md border bg-card p-2">
      {/* `flex-wrap`: o card "Status do Kanban" fica estreito no grid de 2 colunas do desktop
          (~514px) mesmo a 1400px de viewport — o breakpoint `md:` dos botões extras é por
          VIEWPORT, não pelo container, então eles continuam lado a lado com o nome mesmo sem
          espaço. O nome tem prioridade: `flex-1 min-w-[9rem]` no Input garante uma largura
          mínima legível; sem espaço pros extras na mesma linha, eles quebram pra 2ª linha
          (em vez de espremer o nome a poucos px, cortando "Desenho Técnico" → "Dese"). */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground touch-none hover:text-foreground max-md:min-h-11 max-md:min-w-10"
          {...attributes}
          {...listeners}
          aria-label="Arrastar"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 min-w-[9rem] flex-1 border-0 shadow-none focus-visible:ring-1 max-md:h-11"
        />
        {/* Sem ações extras (ex.: outras listas sem `extra`): Excluir fica sempre inline —
            só 1 botão, não precisa de 2ª linha no mobile. Com `extra` (Status do Kanban:
            Requisitos + Explosão + Excluir), a linha fica estreita demais no mobile p/ os
            3 controles de 44px ao lado do rótulo — desce pra 2ª linha (abaixo). */}
        {!extra && trashButton}
        {extra && <div className="hidden shrink-0 items-center gap-2 md:flex">{extra}{trashButton}</div>}
      </div>
      {extra && (
        <div className="mt-2 flex items-center justify-end gap-2 md:hidden">{extra}{trashButton}</div>
      )}
    </li>
  );
}

// Fluxo de Revenda (módulo opt-in produto_acabado): config PRÓPRIA do kanban/campos dos
// modelos `origem==='revenda'` — a Revenda pode ter colunas/requisitos/seções diferentes do
// fluxo manufaturado, destravando peças compradas prontas (sem Tecido/CAD/Data). Grava as 3
// chaves em tenant_config (revenda_kanban_colunas / _requisitos / revenda_campos). A UI mostra
// LABELS, grava KEYS (colunas via resolveStatusKey). Ver invariante #13 + src/lib/revenda-config.ts.

// Rótulos amigáveis das seções do Sheet de Desenvolvimento (REVENDA_SECAO_KEYS).
const REVENDA_SECAO_LABELS: Record<string, string> = {
  s1: "1. Informações Básicas",
  prova: "Ajustes na Prova",
  s2: "Tecidos/Forros/Entretelas",
  "s-cad": "CAD",
  s3: "Aviamentos",
  s3e: "Insumos",
  s4: "Grade",
  s5: "Custos",
  s6: "Anexos",
};

// Rótulos amigáveis dos campos de "1. Informações Básicas" (REVENDA_CAMPO_KEYS).
const REVENDA_CAMPO_LABELS: Record<string, string> = {
  modelista_id: "Modelista",
  piloteiro1_id: "Piloteiro 1",
  piloteiro2_id: "Piloteiro 2",
  piloteiro3_id: "Piloteiro 3",
  data_piloto1: "Data Piloto 1",
  data_piloto2: "Data Piloto 2",
  data_piloto3: "Data Piloto 3",
  data_desenho_tecnico: "Data Desenho Técnico",
  data_aprovacao: "Data de Aprovação",
};

function FluxoRevendaCard({
  statusKanban,
  fluxoKeys,
  colunas,
  requisitos,
  campos,
  chaveLigada,
  condsModuloOff,
  onColunasChange,
  onRequisitosChange,
  onCamposChange,
  anelConflito,
}: {
  statusKanban: string[];
  // Keys do fluxo da revenda (board ∩ colunas; [] = todas) — base da etiqueta Entrada/Automática/Manual.
  fluxoKeys: string[];
  colunas: string[];
  requisitos: Record<string, string[]>;
  campos: Record<string, boolean>;
  // Baixo 3: chave `kanban_automatico` LIGADA no banco — sem ela as etiquetas Entrada/Automática/Manual
  // e o Reprovado travado mentiriam (nenhuma coluna anda sozinha de verdade).
  chaveLigada: boolean;
  // [modularidade F4] condições de módulo desligado (mesmo mapa do bloco interno) — esmaecem no diálogo da revenda também.
  condsModuloOff: Map<string, ModuleKey[]>;
  onColunasChange: (next: string[]) => void;
  onRequisitosChange: (next: Record<string, string[]>) => void;
  onCamposChange: (next: Record<string, boolean>) => void;
  // T4 (Config colaborativa): classe do anel âmbar do sub-bloco com conflito pendente ("" se não há).
  anelConflito?: (bloco: string) => string;
}) {
  const colunasSet = new Set(colunas);
  // [] = TODAS as colunas permitidas (fallback do plano) — refletido no rótulo do bloco.
  const semTrava = colunas.length === 0;

  const toggleColuna = (key: string, on: boolean) => {
    const next = new Set(colunas);
    if (on) next.add(key); else next.delete(key);
    onColunasChange(Array.from(next));
  };

  const setRequisitos = (colKey: string, next: string[]) => {
    const map = { ...requisitos };
    if (next.length) map[colKey] = next; else delete map[colKey];
    onRequisitosChange(map);
  };

  // Campo/seção visível? Default: OFF p/ os 12 de REVENDA_CAMPOS_DEFAULT_OFF, ON p/ o resto.
  // (Espelha revendaCampoVisivel; aqui é a UI de edição, então mostra o valor efetivo.)
  const campoOn = (key: string) => {
    const v = campos[key];
    if (v === undefined) return !REVENDA_CAMPOS_DEFAULT_OFF.includes(key);
    return v !== false;
  };
  const toggleCampo = (key: string, on: boolean) => {
    onCamposChange({ ...campos, [key]: on });
  };

  return (
    <Card id="fluxo-revenda-card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Fluxo de Revenda</CardTitle>
          <Badge variant="secondary" className="font-normal">módulo Produto Acabado</Badge>
        </div>
        <CardDescription>
          Kanban e campos PRÓPRIOS dos produtos de revenda (peça comprada pronta). Escolha por
          quais colunas a revenda passa, os requisitos de cada uma e quais seções/campos do card
          ela usa — sem afetar o fluxo de produção normal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bloco 1 — colunas do kanban permitidas p/ revenda + requisitos de cada. */}
        <div data-colab-path="cfg:revenda_kanban_colunas" className={"space-y-2 " + (anelConflito?.("cfg:revenda_kanban_colunas") ?? "")}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Colunas do kanban
          </p>
          <p className="text-xs text-muted-foreground">
            {semTrava
              ? "Nenhuma marcada = a revenda passa por TODAS as colunas (sem trava)."
              : "A revenda só entra nas colunas marcadas. Defina os Requisitos de cada uma."}
          </p>
          <ul className="space-y-2">
            {statusKanban.map((label, idx) => {
              const key = resolveStatusKey(label);
              const on = colunasSet.has(key);
              // Revisão Opus (fix round 1): a 360/390px, Switch + rótulo + badge + botão Requisitos
              // não cabem numa linha só (o rótulo ia a quase zero). Mesmo padrão 2-linhas do
              // SortableItem (Status do Kanban acima) — badge/texto/botão descem p/ 2ª linha no mobile.
              const extra = (
                <>
                  {chaveLigada && (on || semTrava) && <ModoColunaBadge modo={modoColuna(key, fluxoKeys, requisitos)} />}
                  {!on && !semTrava && <span className="shrink-0 text-xs text-muted-foreground">revenda não passa</span>}
                  {on && (
                    <RequisitosStatusButton
                      label={label}
                      requisitos={requisitos[key] ?? []}
                      onChange={(next) => setRequisitos(key, next)}
                      condsIndisponiveis={REVENDA_COND_NA}
                      condsModuloOff={condsModuloOff}
                      colabPath="cfg:revenda_kanban_requisitos"
                      bloqueadoMotivo={chaveLigada && key === "reprovado" ? MOTIVO_REPROVADO_MANUAL : undefined}
                    />
                  )}
                </>
              );
              return (
                <li key={`${idx}::${key}`} className="rounded-md border bg-card p-2">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={on}
                      onCheckedChange={(v) => toggleColuna(key, v)}
                      aria-label={`Coluna "${label}" na revenda`}
                    />
                    <span
                      className="flex-1 cursor-pointer select-none truncate text-sm"
                      onClick={() => toggleColuna(key, !on)}
                    >
                      {label}
                    </span>
                    <div className="hidden shrink-0 items-center gap-2 md:flex">{extra}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2 md:hidden">{extra}</div>
                </li>
              );
            })}
            {statusKanban.length === 0 && (
              <li className="text-sm text-muted-foreground italic">
                Configure as colunas do kanban acima (bloco "Status do Kanban").
              </li>
            )}
          </ul>
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Com o kanban automático ligado, a revenda anda sozinha só pelas colunas ligadas aqui, também em cascata.
          </p>
        </div>

        {/* Bloco 2 — seções e campos do card de Desenvolvimento visíveis p/ revenda. */}
        <div data-colab-path="cfg:revenda_campos" className={"space-y-2 border-t pt-4 " + (anelConflito?.("cfg:revenda_campos") ?? "")}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Seções e campos do card
          </p>
          <p className="text-xs text-muted-foreground">
            Desligue as seções/campos que não fazem sentido para peça comprada pronta. Desligados
            somem do card de revenda (e não travam o envio). "Nome" é sempre exibido.
          </p>
          <ul className="space-y-2">
            {REVENDA_SECAO_KEYS.map((secKey) => {
              const isS1 = secKey === "s1";
              return (
                <li key={secKey} className="rounded-md border bg-card">
                  <div className="flex items-center gap-3 p-2">
                    <Switch
                      checked={isS1 ? true : campoOn(secKey)}
                      disabled={isS1}
                      onCheckedChange={(v) => toggleCampo(secKey, v)}
                      aria-label={`Seção "${REVENDA_SECAO_LABELS[secKey] ?? secKey}" na revenda`}
                    />
                    <span
                      className={
                        "flex-1 select-none truncate text-sm font-medium" +
                        (isS1 ? "" : " cursor-pointer")
                      }
                      onClick={() => { if (!isS1) toggleCampo(secKey, !campoOn(secKey)); }}
                    >
                      {REVENDA_SECAO_LABELS[secKey] ?? secKey}
                    </span>
                    {isS1 && <span className="shrink-0 text-xs text-muted-foreground">sempre ativa</span>}
                  </div>
                  {/* s1 expande os campos individuais de "Informações Básicas". */}
                  {isS1 && (
                    <ul className="space-y-1.5 border-t px-2 py-2 pl-6">
                      <li className="flex items-center gap-3">
                        <Switch checked disabled aria-label="Campo Nome (sempre exibido)" />
                        <span className="flex-1 select-none truncate text-sm">Nome</span>
                        <span className="shrink-0 text-xs text-muted-foreground">sempre</span>
                      </li>
                      {REVENDA_CAMPO_KEYS.map((campoKey) => {
                        const con = campoOn(campoKey);
                        return (
                          <li key={campoKey} className="flex items-center gap-3">
                            <Switch
                              checked={con}
                              onCheckedChange={(v) => toggleCampo(campoKey, v)}
                              aria-label={`Campo "${REVENDA_CAMPO_LABELS[campoKey] ?? campoKey}" na revenda`}
                            />
                            <span
                              className="flex-1 cursor-pointer select-none truncate text-sm"
                              onClick={() => toggleCampo(campoKey, !con)}
                            >
                              {REVENDA_CAMPO_LABELS[campoKey] ?? campoKey}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// Etapas do PCP (módulo opt-in etapas_pl): as 5 etapas fixas do kanban de PL — renomear
// (label) + ativar/desativar. SEM reordenar/adicionar (ordem e gatilho de transição são
// fixos no motor de regras, ver src/lib/pcp-etapas.ts) — por isso NÃO reusa
// SortableListCard (que é genérico p/ listas livres com drag). `value` vazio (loja nunca
// salvou) exibe ETAPAS_DEFAULT — mas só grava no `cfg` quando o usuário mexe (edit/toggle
// materializa a lista default no estado local antes de escrever).
function EtapasPLCard({
  value,
  onChange,
}: {
  value: EtapaCfg[];
  onChange: (next: EtapaCfg[]) => void;
}) {
  const etapas = value.length ? value : ETAPAS_DEFAULT;

  const update = (index: number, patch: Partial<EtapaCfg>) => {
    const next = etapas.map((e, i) => (i === index ? { ...e, ...patch } : e));
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Etapas do PCP</CardTitle>
        <CardDescription>
          As 5 etapas do kanban de Etapas PL. Renomeie o rótulo exibido ou desative a
          etapa (ela é pulada no fluxo). Ordem fixa — sem arrastar nem adicionar/excluir.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {etapas.map((etapa, idx) => (
            <li key={etapa.key} className="flex items-center gap-2 rounded-md border bg-card p-2">
              <Input
                value={etapa.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                className="h-8 max-md:h-11"
                maxLength={60}
              />
              <div className="flex shrink-0 items-center gap-2 pl-1">
                <Switch
                  checked={etapa.ativa}
                  onCheckedChange={(checked) => update(idx, { ativa: checked })}
                  aria-label={`${etapa.ativa ? "Desativar" : "Ativar"} etapa ${etapa.label}`}
                />
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {etapa.ativa ? "Ativa" : "Inativa"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// Editor das nomenclaturas por módulo: nomes das abas (módulo + páginas) e dos
// campos. O usuário escolhe UM módulo por vez.
function NomesDasAbasDialog({ tenantId, modules, presentes }: {
  tenantId: string | null;
  modules: Record<string, boolean>;
  // T5: presença da página (mesmo canal `colab:config-loja:<loja>`) — o 2º overlay, dentro do diálogo
  // (portal), desenha o anel de quem está no MESMO nome (`nom:tab:<key>` / `nom:campo:<key>`).
  presentes: PresencaColab[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const enabledModules = PAGES_CATALOG.filter((m) => modules[m.module] !== false);
  const [selModule, setSelModule] = useState<string>(enabledModules[0]?.module ?? "");
  // Espelhos p/ o merge (efeito e retentativa do save leem o rascunho JÁ na tela, sem closure velho).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const camposRef = useRef(campos);
  camposRef.current = campos;
  // T5 (Config colaborativa, P-123 A): base CRUA de cada mapa = o que o servidor tinha na última leitura
  // fundida — vai como `_base` da RPC `salvar_config_loja` (compare-and-set do mapa inteiro). null = loja sem linha.
  const baseRef = useRef<Record<ColunaNomenclatura, Record<string, unknown> | null>>({ tab_labels: null, campos_editaveis: null });
  // Conflitos POR NOME (outra pessoa mudou o MESMO nome que eu mexi). Travam o Salvar até "manter meu"/"usar o novo".
  const [conflitos, setConflitos] = useState<ConflitoNome[]>([]);
  const conflitosRef = useRef<ConflitoNome[]>([]);
  const definirConflitos = (l: ConflitoNome[]) => {
    // O efeito abaixo roda a cada render (deps com array novo): lista vazia → vazia não pode setar estado (loop).
    if (l.length === 0 && conflitosRef.current.length === 0) return;
    conflitosRef.current = l;
    setConflitos(l);
  };
  // Loja com a qual a janela hidratou — trocar de loja com a janela aberta RE-SEMEIA (nunca funde A em B).
  const lojaHidratadaRef = useRef<string | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);
  // A última leitura (objeto do cache) já fundida — o efeito roda a cada render; cada leitura entra UMA vez.
  const ultimaLeituraRef = useRef<unknown>(null);

  const { dirty: nomChanged, markClean, reset: resetNomBaseline } = useDirtySnapshot({ tabs, campos });
  const dirty = open && nomChanged;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: () => setOpen(false) });

  // Fix hidratação — revisão final (achado F1, PERDA DE DADO comprovada, review-final.md): +
  // `if (error) throw error` — engolia o erro (`const { data } = ...`), e uma falha (ou o Salvar
  // clicado com a leitura ainda em voo, já que `hydrated` não travava o botão) fazia o upsert
  // gravar `{"tab_labels":{},"campos_editaveis":{}}` por cima das nomenclaturas reais da loja.
  // Fix hidratação — re-revisão final (achado N7, PERDA/GRAVAÇÃO CRUZADA de dado comprovada,
  // review-final-2.md): a key inclui o `tenantId` (cache por loja, sem mistura entre A e B) e o gate
  // de hidratação espera `currentOk && !currentFetching` (só semeia depois que a leitura NOVA assentar).
  // T5: devolve os mapas CRUS (null = loja sem linha) — a base da RPC tem de ser o valor do servidor.
  const { data: current, isSuccess: currentOk, isFetching: currentFetching } = useQuery({
    queryKey: ["tenant_config", "nomenclaturas_edit", tenantId],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("tab_labels, campos_editaveis").eq("tenant_id", tenantId!).maybeSingle();
      if (error) throw error;
      return {
        tab_labels: ((data as any)?.tab_labels ?? null) as Record<string, unknown> | null,
        campos_editaveis: ((data as any)?.campos_editaveis ?? null) as Record<string, unknown> | null,
      };
    },
  });

  // T5: funde uma leitura NOVA do servidor no rascunho, POR NOME (`mesclarNomes`): nome que eu não mexi
  // adota o do servidor; nome que eu mexi fica meu e, se o outro também o mudou (para outro valor), vira
  // conflito. A base de cada mapa que mudou passa a ser o servidor (o próximo Salvar grava o merge sem
  // P0409). Devolve os conflitos NOVOS. Mapa igual à base = nada a fazer (não mexe no que está sendo digitado).
  const aplicarFresh = (fresh: Record<ColunaNomenclatura, Record<string, unknown> | null>): ConflitoNome[] => {
    const novos: ConflitoNome[] = [];
    const cols: [ColunaNomenclatura, string, { current: Record<string, string> }, (v: Record<string, string>) => void][] = [
      ["tab_labels", "nom:tab:", tabsRef, setTabs],
      ["campos_editaveis", "nom:campo:", camposRef, setCampos],
    ];
    const mudou = (col: ColunaNomenclatura) => jsonCanonico(fresh[col] ?? null) !== jsonCanonico(baseRef.current[col] ?? null);
    // Nada novo do servidor: NÃO mexe em estado nenhum (o efeito roda a cada render — sem isto, setState em loop).
    if (!cols.some(([col]) => mudou(col))) return novos;
    for (const [col, prefixo, ref, set] of cols) {
      if (!mudou(col)) continue;
      const r = mesclarNomes(baseRef.current[col], ref.current, fresh[col], prefixo);
      if (r.atualizados.length) {
        const f = limparNomes(fresh[col]);
        const draft = { ...ref.current };
        for (const k of r.atualizados) { if (f[k] !== undefined) draft[k] = f[k]; else delete draft[k]; }
        ref.current = draft;
        set(draft);
      }
      novos.push(...r.conflitos);
      baseRef.current = { ...baseRef.current, [col]: fresh[col] ?? null };
    }
    // Junta com os pendentes (um por nome) e solta o que convergiu (o meu já é igual ao do servidor).
    const mapa = new Map(conflitosRef.current.map((c) => [c.path, c]));
    for (const c of novos) mapa.set(c.path, c);
    const t = limparNomes(tabsRef.current), cp = limparNomes(camposRef.current);
    const ft = limparNomes(baseRef.current.tab_labels), fc = limparNomes(baseRef.current.campos_editaveis);
    definirConflitos([...mapa.values()].filter((c) => {
      const [, tipo, k] = c.path.split(":");
      return tipo === "tab" ? t[k] !== ft[k] : cp[k] !== fc[k];
    }));
    resetNomBaseline({ tabs: (baseRef.current.tab_labels ?? {}) as Record<string, string>, campos: (baseRef.current.campos_editaveis ?? {}) as Record<string, string> });
    return novos;
  };

  useEffect(() => {
    if (!open) {
      setHydrated(false);
      definirConflitos([]);
      lojaHidratadaRef.current = null;
      return;
    }
    // Trocou de loja com a janela aberta: re-semeia quando a leitura da loja nova assentar.
    if (hydrated && lojaHidratadaRef.current !== tenantId) {
      lojaHidratadaRef.current = null; // um save da loja anterior em voo reconhece que a janela mudou
      setHydrated(false);
      definirConflitos([]);
      return;
    }
    if (!current || !currentOk || currentFetching) return;
    if (!hydrated) {
      const t = (current.tab_labels ?? {}) as Record<string, string>;
      const c = (current.campos_editaveis ?? {}) as Record<string, string>;
      baseRef.current = { tab_labels: current.tab_labels, campos_editaveis: current.campos_editaveis };
      tabsRef.current = t;
      camposRef.current = c;
      setTabs(t);
      setCampos(c);
      resetNomBaseline({ tabs: t, campos: c });
      if (!selModule && enabledModules[0]) setSelModule(enabledModules[0].module);
      lojaHidratadaRef.current = tenantId;
      ultimaLeituraRef.current = current;
      setHydrated(true);
      return;
    }
    // Re-hidratação com a janela aberta (Realtime/foco/outra aba): funde POR NOME — cada leitura uma vez só.
    if (current === ultimaLeituraRef.current) return;
    ultimaLeituraRef.current = current;
    aplicarFresh(current);
  }, [open, current, currentOk, currentFetching, hydrated, tenantId, enabledModules, selModule]);

  const mod = PAGES_CATALOG.find((m) => m.module === selModule);
  const fieldKeys = MODULE_FIELD_KEYS[selModule] ?? [];

  const saveMut = useMutation({
    mutationFn: async (): Promise<{ nada: boolean }> => {
      if (!tenantId) throw new Error("Loja não identificada.");
      // T5 (Config colaborativa, P-123 A): UMA chamada à RPC `salvar_config_loja` só com o(s) MAPA(S) que
      // mudou(aram) — cada um inteiro (limpo: em branco = nome padrão) + a base CRUA que a janela leu. Se
      // outra pessoa gravou o mesmo mapa nesse meio-tempo (P0409), relê e funde POR NOME: nomes diferentes
      // → junta os dois e tenta de novo UMA vez sozinho; o MESMO nome → lista de conflitos na janela.
      for (let tentativa = 0; ; tentativa++) {
        const mudancas: Record<string, unknown> = {};
        const base: Record<string, unknown> = {};
        const t = limparNomes(tabsRef.current), c = limparNomes(camposRef.current);
        if (!igual(t, limparNomes(baseRef.current.tab_labels))) { mudancas.tab_labels = t; base.tab_labels = baseRef.current.tab_labels ?? null; }
        if (!igual(c, limparNomes(baseRef.current.campos_editaveis))) { mudancas.campos_editaveis = c; base.campos_editaveis = baseRef.current.campos_editaveis ?? null; }
        if (Object.keys(mudancas).length === 0) return { nada: true };
        const { error } = await supabase.rpc("salvar_config_loja" as any, { _tenant_id: tenantId, _mudancas: mudancas, _base: base } as any);
        if (!error) return { nada: false };
        const conflitoVersao = (error as any).code === "P0409" && String((error as any).message ?? "").startsWith("conflito_versao: config_loja");
        if (!conflitoVersao || tentativa > 0) throw error;
        // `colunasDoErro` com a lista da JANELA (as 2 colunas de nomenclatura) — só p/ confirmar que é deste mapa.
        if (colunasDoErro(error, COLUNAS_NOMENCLATURAS).length === 0) throw error;
        const { data: row, error: errLer } = await supabase
          .from("tenant_config").select("tab_labels, campos_editaveis").eq("tenant_id", tenantId).maybeSingle();
        if (errLer) throw errLer;
        // Revisão T3/T4 (I1, espelhado na janela): trocou de loja durante o voo — não funde a leitura da
        // loja anterior no rascunho da loja nova.
        if (lojaHidratadaRef.current !== tenantId) throw Object.assign(new Error("loja_mudou"), { lojaMudou: true });
        const lido = {
          tab_labels: ((row as any)?.tab_labels ?? null) as Record<string, unknown> | null,
          campos_editaveis: ((row as any)?.campos_editaveis ?? null) as Record<string, unknown> | null,
        };
        aplicarFresh(lido);
        // O cache da janela passa a ser ESTA leitura — senão o efeito "fundiria" de novo a leitura velha do cache
        // (que ficou atrás da base) e ressuscitaria o nome antigo como conflito.
        qc.setQueryData(["tenant_config", "nomenclaturas_edit", tenantId], lido);
        if (conflitosRef.current.length > 0) throw Object.assign(new Error("conflito_nomes"), { conflitoNomes: true });
        // Nomes diferentes: o rascunho agora tem os dois — segue para a 2ª tentativa com a base nova.
      }
    },
    // Revisão T3/T4 (I1): a loja deste save — se a janela já re-semeou com outra loja, a resposta não fecha
    // nem "limpa" a janela da loja nova.
    onMutate: () => ({ tenantId }),
    onSuccess: (r, _v, ctx) => {
      if (ctx?.tenantId !== lojaHidratadaRef.current) {
        if (!r.nada) {
          toast.success("Nomenclaturas salvas (na loja anterior).");
          qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && String(q.queryKey[0]).includes("tenant") });
        }
        return;
      }
      markClean();
      if (r.nada) {
        toast.info("Nenhuma alteração para salvar.");
        setOpen(false);
        return;
      }
      toast.success("Nomenclaturas salvas");
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("tenant") || k.includes("tamanhos"));
        },
      });
      setOpen(false);
    },
    onError: (e: any, _v, ctx) => {
      if (e?.lojaMudou || (ctx && ctx.tenantId !== lojaHidratadaRef.current)) {
        toast.error("A loja mudou durante o salvamento das nomenclaturas; confira e salve de novo.");
        return;
      }
      if (e?.conflitoNomes) {
        toast.error("Outra pessoa mudou o mesmo nome agora há pouco. Escolha em cada item destacado e salve de novo.");
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  // T5: "manter meu" = o meu fica (a base do mapa já é o servidor — o próximo Salvar grava por cima,
  // conscientemente); "usar o novo" = o nome volta ao do servidor (sem valor = nome padrão).
  const resolverNome = (path: string, escolha: "meu" | "dele") => {
    const c = conflitosRef.current.find((x) => x.path === path);
    if (c && escolha === "dele") {
      const [, tipo, k] = path.split(":");
      const set = tipo === "tab" ? setTabs : setCampos;
      const ref = tipo === "tab" ? tabsRef : camposRef;
      const draft = { ...ref.current };
      if (c.dele !== undefined) draft[k] = c.dele; else delete draft[k];
      ref.current = draft;
      set(draft);
    }
    definirConflitos(conflitosRef.current.filter((x) => x.path !== path));
  };
  const conflitoDe = (path: string) => conflitos.some((c) => c.path === path);
  const anelNome = (path: string) => (conflitoDe(path) ? "ring-2 ring-amber-500" : "");
  const rotuloNome = (path: string) => {
    const [, tipo, k] = path.split(":");
    if (tipo === "tab") {
      const nome = PAGES_CATALOG.find((m) => m.module === k)?.label
        ?? PAGES_CATALOG.flatMap((m) => m.pages).find((pg) => pg.key === k)?.label ?? k;
      return `${rotuloColuna("tab_labels")} — ${nome}`;
    }
    return `${rotuloColuna("campos_editaveis")} — ${FIELD_LABEL_DEFAULTS[k] ?? k}`;
  };
  const presentesNaJanela = presentes.filter((p) => p.campoFocado?.startsWith("nom:"));

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : requestClose())}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={!tenantId}>
          <Settings className="h-4 w-4 mr-2" /> Editar nomenclaturas por módulo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!p-4">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Nomenclaturas</DialogTitle>
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </DialogHeader>

        {/* T5: quem mais está editando nomenclaturas + conflitos POR NOME ("manter meu" · "usar o novo"). */}
        <ColabBanner presentes={presentesNaJanela} ultimoMerge={null} conflitos={conflitos} onResolver={resolverNome} rotulo={rotuloNome} />

        <div ref={corpoRef} className="space-y-4">
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
                <Input
                  placeholder={mod.label}
                  data-colab-path={`nom:tab:${mod.module}`}
                  className={anelNome(`nom:tab:${mod.module}`)}
                  value={tabs[mod.module] ?? ""}
                  onChange={(e) => setTabs((t) => ({ ...t, [mod.module]: e.target.value }))}
                />
              </div>
              {mod.pages.map((p) => (
                <div key={p.key} className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2 md:pl-4">
                  <Label className="text-xs text-muted-foreground">{p.label}</Label>
                  <Input
                    className={"h-8 max-md:h-11 " + anelNome(`nom:tab:${p.key}`)}
                    placeholder={p.label}
                    data-colab-path={`nom:tab:${p.key}`}
                    value={tabs[p.key] ?? ""}
                    onChange={(e) => setTabs((t) => ({ ...t, [p.key]: e.target.value }))}
                  />
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
                    <Input
                      className={"h-8 max-md:h-11 " + anelNome(`nom:campo:${k}`)}
                      placeholder={FIELD_LABEL_DEFAULTS[k] ?? k}
                      data-colab-path={`nom:campo:${k}`}
                      value={campos[k] ?? ""}
                      onChange={(e) => setCampos((c) => ({ ...c, [k]: e.target.value }))}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">Em branco = nome padrão.</p>
        </div>
        {/* 2º overlay (o diálogo é portal — o da página não alcança): anel de quem está no MESMO nome. */}
        <ColabPresenceOverlay presentes={presentesNaJanela} scopeRef={corpoRef} />
        <DialogFooter className="max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:border-t max-sm:bg-background max-sm:px-4 max-sm:py-3">
          <Button variant="ghost" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          {/* Fix hidratação — revisão final (F1): + `|| !hydrated` — sem isso, clicar Salvar com a
              leitura do diálogo ainda em voo (ou depois de uma falha, que nunca hidrata) upsertava
              tab_labels/campos_editaveis VAZIOS por cima das nomenclaturas reais da loja. */}
          {/* T5: + conflito por nome pendente trava (P-122 A) — resolver no aviso acima antes de salvar. */}
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !hydrated || conflitos.length > 0}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </DialogFooter>
        <UnsavedChangesGuard
          confirm={confirm}
          message="Há alterações não salvas nas nomenclaturas."
        />
      </DialogContent>
    </Dialog>
  );
}
