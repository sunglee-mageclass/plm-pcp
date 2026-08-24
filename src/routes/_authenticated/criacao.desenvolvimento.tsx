import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, ImageIcon, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Check, X, AlertTriangle } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { DEFAULT_STATUSES, type KanbanStatus, normalizeKanbanStatuses } from "@/lib/kanban-status";
import { requisitosOk } from "@/lib/kanban-condicoes";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";
import { ImagePreview } from "@/components/shared/ImagePreview";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { useCursorTip } from "@/components/shared/CursorTip";
import { useSort } from "@/components/shared/sort";
import { useFilterState } from "@/hooks/useFilterState";


import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/criacao/desenvolvimento")({
  component: () => (
    <RequirePermission page="criacao_desenvolvimento">
      <DesenvolvimentoPage />
    </RequirePermission>
  ),
});

const BUCKET = "modelos";

type Opt = { id: string; nome: string };

type Modelo = {
  id: string;
  nome: string | null;
  ref: string | null;
  ref_auto: string | null;
  versao: number | null;
  estilista_id: string | null;
  modelista_id: string | null;
  piloteiro1_id: string | null;
  piloteiro2_id: string | null;
  piloteiro3_id: string | null;
  colecao: string | null;
  subcolecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  linha_id: string | null;
  status_desenvolvimento: string | null;
  fotos_modelo: string[] | null;
  desenho_tecnico_url: string | null;
  croqui_url: string | null;
  enviado_cad: boolean | null;
  cad: { enviado_corte: boolean | null }[] | null;
  created_at: string | null;
};

const SORT_FIELDS = [
  { key: "nome", label: "Nome" },
  { key: "ref", label: "REF" },
  { key: "versao", label: "Versão" },
  { key: "created_at", label: "Data" },
] as const;

// Agrupamento combinável DENTRO de cada coluna de status (mesmo padrão do Planejamento). Por
// enquanto só "tecido"; adicionar dimensão = +splitter + +item no AgrupamentoButton. Persiste
// os agrupamentos ativos (lista) por usuário.
const GROUPBY_LS = "desenv-groupby";

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, ${key}`).order(table === "meses" ? "ordem" : key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

function useColaboradoresByTipo(tipo: string) {
  return useQuery({
    queryKey: ["colab", tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colaboradores")
        .select("id, nome")
        .eq("tipo", tipo)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
}

function DesenvolvimentoPage() {
  const qc = useQueryClient();
  const { canEdit } = useAuth();
  const tenantId = useActiveTenantId();
  const editable = canEdit("criacao_desenvolvimento");
  const [search, setSearch] = useState("");
  const [fEstilista, setFEstilista] = useFilterState("desenvolvimento", "Estilista", []);
  const [fModelista, setFModelista] = useFilterState("desenvolvimento", "Modelista", []);
  const [fPiloteiro, setFPiloteiro] = useFilterState("desenvolvimento", "Piloteiro", []);
  const [fSemana, setFSemana] = useFilterState("desenvolvimento", "Lançamento nº", []);
  const [fMes, setFMes] = useFilterState("desenvolvimento", "Mês", []);
  const [fAno, setFAno] = useFilterState("desenvolvimento", "Ano", []);
  const [fColecao, setFColecao] = useFilterState("desenvolvimento", "Coleção", []);
  const [fSubcolecao, setFSubcolecao] = useFilterState("desenvolvimento", "Subcoleção", []);
  const [fCat, setFCat] = useFilterState("desenvolvimento", "Categoria", []);
  const [fSub1, setFSub1] = useFilterState("desenvolvimento", "Subcategoria", []);
  const [fStatus, setFStatus] = useFilterState("desenvolvimento", "Status", []);
  const [fCad, setFCad] = useFilterState("desenvolvimento", "Explosão", []);
  const [fGrupo, setFGrupo] = useFilterState("desenvolvimento", "Grupo", []);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Agrupamento combinável (igual Planejamento) DENTRO de cada status. Por ora só Tecido; default ON.
  const [groupByTecido, setGroupByTecido] = useState<boolean>(() => {
    try { return (localStorage.getItem(GROUPBY_LS) ?? "tecido").includes("tecido"); } catch { return true; }
  });
  const toggleTecido = () => setGroupByTecido((v) => {
    const nv = !v;
    try { localStorage.setItem(GROUPBY_LS, nv ? "tecido" : ""); } catch { /* ignore */ }
    return nv;
  });
  // Colapso por grupo — path = "status/grupo[/subgrupo…]" (sessão, igual Planejamento).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // "tocou nos tecidos" = o usuário mexeu num grupo (individual ou pelo botão) → para de auto-recolher.
  const tecidosTocadoRef = useRef(false);
  const toggleGroup = (path: string) => { tecidosTocadoRef.current = true; setCollapsedGroups((prev) => {
    const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n;
  }); };
  const toggleCollapse = (key: string) => setCollapsed((prev) => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: estilistas = [] } = useColaboradoresByTipo("estilista");
  const { data: modelistas = [] } = useColaboradoresByTipo("modelista");
  const { data: piloteiros = [] } = useColaboradoresByTipo("piloteiro");
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: grupos = [] } = useOpts("grupos_produto");
  const { data: categorias = [] } = useQuery({
    queryKey: ["opt", "categorias_produto", "com-grupo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_produto").select("id, nome, grupo_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; grupo_id: string | null }[];
    },
  });
  const { data: sub1Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; categoria_id: string | null }[];
    },
  });

  const { data: statusKanban = DEFAULT_STATUSES } = useQuery({
    queryKey: ["tenant-status-kanban", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("status_kanban")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return normalizeKanbanStatuses(data?.status_kanban);
    },
  });

  // Requisitos de entrada por status (motor de regras) + condições satisfeitas por modelo.
  const { data: kanbanRequisitos = {} } = useQuery({
    queryKey: ["tenant-kanban-requisitos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("kanban_requisitos").eq("tenant_id", tenantId).maybeSingle();
      return ((data as any)?.kanban_requisitos ?? {}) as Record<string, string[]>;
    },
  });

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-desenvolvimento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, ref, ref_auto, versao, estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, colecao, subcolecao, semana, mes_id, ano_id, categoria_principal_id, subcategoria1_id, linha_id, status_desenvolvimento, fotos_modelo, desenho_tecnico_url, croqui_url, enviado_cad, cad(enviado_corte), created_at")
        .eq("ordem_criacao_enviada", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Modelo[];
    },
  });

  // Tecido PRINCIPAL por modelo (1º bloco tipo='tecido', menor numero) — p/ agrupar por tecido.
  const { data: modeloTecidos = [] } = useQuery({
    queryKey: ["desenv-modelo-tecidos", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("modelo_id, numero, artigos:artigo_id(nome)")
        .eq("tipo", "tecido")
        .order("numero");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const tecidoPrincipalMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of modeloTecidos) {
      const nome = Array.isArray(r.artigos) ? r.artigos[0]?.nome : r.artigos?.nome;
      if (nome && !m.has(r.modelo_id)) m.set(r.modelo_id, nome); // ordenado por numero → 1º é o principal
    }
    return m;
  }, [modeloTecidos]);

  const modeloIdsAll = useMemo(() => modelos.map((m) => m.id).sort(), [modelos]);
  const { data: condicoesMap = {} } = useQuery({
    queryKey: ["desenv-condicoes", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, Record<string, boolean>>;
    },
  });
  // Estado da MO por serviço (badge do card) — derivado de `modelo_mo_resumo.estado`
  // (aprovada|pendente|reprovada|sem_servico). O flag cru custo_terceirizados_aprovado virou
  // boolean DERIVADO: false = pendente OU reprovada, então o badge antigo pintava PENDENTE de
  // vermelho ("reprovado"). A RPC mascara p/ quem não vê custos ({} → sem badge).
  const { data: moEstadoMap = {} } = useQuery({
    queryKey: ["desenv-mo-resumo", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      const src = (data ?? {}) as Record<string, { estado: string }>;
      const m: Record<string, string> = {};
      for (const [id, v] of Object.entries(src)) if (v?.estado) m[id] = v.estado;
      return m;
    },
  });
  // Um card pode ENTRAR no status? (requisitos do status ⊆ condições satisfeitas do modelo)
  const podeEntrar = (modeloId: string, statusKey: string) =>
    requisitosOk((kanbanRequisitos as any)[statusKey], (condicoesMap as any)[modeloId] ?? {});

  const colecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.colecao && s.add(m.colecao));
    return Array.from(s).sort();
  }, [modelos]);

  const subcolecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.subcolecao && s.add(m.subcolecao));
    return Array.from(s).sort();
  }, [modelos]);

  const statusKeySet = useMemo(() => new Set(statusKanban.map((s) => s.key)), [statusKanban]);
  const firstStatusKey = statusKanban[0]?.key;

  const catGrupoMap = Object.fromEntries(categorias.map((c) => [c.id, c.grupo_id]));
  // CASCATA Grupo→Categoria (idêntica ao padrão do Planejamento): opções de Categoria = união
  // dos grupos marcados (nenhum grupo marcado = todas). A poda de fCat mora no useEffect abaixo.
  const categoriasFiltradasPorGrupo = useMemo(
    () => (fGrupo.length ? categorias.filter((c) => c.grupo_id && fGrupo.includes(c.grupo_id)) : categorias),
    [categorias, fGrupo]
  );
  useEffect(() => {
    const validos = new Set(categoriasFiltradasPorGrupo.map((c) => c.id));
    const podado = fCat.filter((id) => validos.has(id));
    if (podado.length !== fCat.length) setFCat(podado); // guarda: só grava/re-renderiza se podou algo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriasFiltradasPorGrupo]);

  const filtered = modelos.filter((m) => {
    // Lupa casa por nome OU REF (ref/ref_auto — mesma normalização do nome, sem accent-fold).
    if (search) {
      const q = search.toLowerCase();
      const okNome = (m.nome ?? "").toLowerCase().includes(q);
      const okRef = (m.ref ?? "").toLowerCase().includes(q);
      const okRefAuto = (m.ref_auto ?? "").toLowerCase().includes(q);
      if (!okNome && !okRef && !okRefAuto) return false;
    }
    if (fGrupo.length && !fGrupo.includes(m.categoria_principal_id ? catGrupoMap[m.categoria_principal_id] ?? "" : "")) return false;
    if (fCat.length && !fCat.includes(m.categoria_principal_id ?? "")) return false;
    if (fSubcolecao.length && !fSubcolecao.includes(m.subcolecao ?? "")) return false;
    if (fSub1.length && !fSub1.includes(m.subcategoria1_id ?? "")) return false;
    if (fStatus.length) {
      // status efetivo = a coluna onde o card cai (null/desconhecido → primeira)
      const eff = m.status_desenvolvimento && statusKeySet.has(m.status_desenvolvimento)
        ? m.status_desenvolvimento
        : firstStatusKey;
      if (!fStatus.includes(eff ?? "")) return false;
    }
    const naExplosao = !!m.enviado_cad && !m.cad?.[0]?.enviado_corte;
    if (fCad.length) {
      const cadKey = naExplosao ? "enviado" : "nao";
      if (!fCad.includes(cadKey)) return false;
    }
    if (fEstilista.length && !fEstilista.includes(m.estilista_id ?? "")) return false;
    if (fModelista.length && !fModelista.includes(m.modelista_id ?? "")) return false;
    // Piloteiro casa em piloteiro1/2/3_id — OR sobre os 3 campos. Multi = "nenhum dos 3 está entre os selecionados".
    if (fPiloteiro.length &&
      ![m.piloteiro1_id, m.piloteiro2_id, m.piloteiro3_id].some((id) => id && fPiloteiro.includes(id))) return false;
    if (fSemana.length && !fSemana.includes(m.semana ?? "")) return false;
    if (fMes.length && !fMes.includes(m.mes_id ?? "")) return false;
    if (fAno.length && !fAno.includes(m.ano_id ?? "")) return false;
    if (fColecao.length && !fColecao.includes(m.colecao ?? "")) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));
  const catMap = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));

  // Agrupamento aninhado (mesmo padrão do Planejamento). Splitters ativos aninham nesta ordem.
  type Split = { key: string; nome: string; items: Modelo[] };
  const byTecido = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    for (const m of items) {
      const nome = tecidoPrincipalMap.get(m.id) ?? "Sem tecido";
      const arr = map.get(nome); if (arr) arr.push(m); else map.set(nome, [m]);
    }
    return Array.from(map.entries())
      .map(([nome, its]) => ({ key: nome, nome, items: its }))
      .sort((a, b) => (a.nome === "Sem tecido" ? 1 : b.nome === "Sem tecido" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
  };
  const splitters: ((items: Modelo[]) => Split[])[] = [
    groupByTecido ? byTecido : null,
  ].filter(Boolean) as ((items: Modelo[]) => Split[])[];
  type Grupo = { key: string; nome: string; items?: Modelo[]; subgroups?: Grupo[] };
  const buildGroups = (items: Modelo[], depth: number): Grupo[] =>
    splitters[depth](items).map((g) => {
      const node: Grupo = { key: g.key, nome: g.nome };
      if (depth + 1 < splitters.length) node.subgroups = buildGroups(g.items, depth + 1);
      else node.items = g.items;
      return node;
    });
  const countLeaves = (g: Grupo): number =>
    g.items ? g.items.length : (g.subgroups ?? []).reduce((s, sg) => s + countLeaves(sg), 0);

  const renderDesktopCard = (m: Modelo) => (
    <KanbanCard
      key={m.id}
      modelo={m}
      moEstado={moEstadoMap[m.id]}
      estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
      categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
      onOpen={() => setOpenId(m.id)}
      draggable={editable}
      dragging={draggingId === m.id}
      onDragStartCard={() => setDraggingId(m.id)}
      onDragEndCard={() => setDraggingId(null)}
    />
  );
  const renderMobileCard = (m: Modelo) => {
    // "Mover para…" no mobile = o equivalente ao arraste do desktop. Já anota o que falta
    // em cada destino bloqueado (mesma regra) e o onMove reusa o gate + toast do handleDrop.
    // Coluna EFETIVA = mesma lógica do byStatus (status inválido/null cai na 1ª coluna) — assim
    // a coluna onde o card aparece nunca entra no "Mover para…".
    const effStatus = m.status_desenvolvimento && statusKeySet.has(m.status_desenvolvimento) ? m.status_desenvolvimento : firstStatusKey;
    const moverOpts = editable
      ? statusKanban
          .filter((s) => s.key !== effStatus)
          .map((s) => { const { ok, faltando } = podeEntrar(m.id, s.key); return { key: s.key, label: s.label, faltando: ok ? [] : faltando.map((c) => c.label) }; })
      : undefined;
    return (
      <MobileCard
        key={m.id}
        modelo={m}
        moEstado={moEstadoMap[m.id]}
        estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
        categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
        onOpen={() => setOpenId(m.id)}
        moverOpts={moverOpts}
        onMove={(statusKey) => {
          if (statusKey === effStatus) return;
          const { ok, faltando } = podeEntrar(m.id, statusKey);
          if (!ok) { toast.error(`Não pode entrar aqui. Faltam: ${faltando.map((c) => c.label).join(", ")}`); return; }
          updateStatus.mutate({ id: m.id, status: statusKey });
        }}
      />
    );
  };
  // Render recursivo dos grupos COLAPSÁVEIS dentro de uma coluna (renderCard difere desktop/mobile).
  const renderGroups = (nodes: Grupo[], path: string, renderCard: (m: Modelo) => React.ReactNode): React.ReactNode =>
    nodes.map((g) => {
      const p = `${path}/${g.key}`;
      const collapsed = collapsedGroups.has(p);
      return (
        <div key={g.key} className="space-y-2">
          <button
            type="button"
            onClick={() => toggleGroup(p)}
            className="flex w-full items-center gap-1.5 px-1 pt-1 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{g.nome}</span>
            <span className="ml-auto shrink-0">{countLeaves(g)}</span>
          </button>
          {!collapsed && (g.subgroups
            ? <div className="space-y-2 border-l pl-2">{renderGroups(g.subgroups, p, renderCard)}</div>
            : <div className="space-y-2">{g.items!.map(renderCard)}</div>)}
        </div>
      );
    });

  // Ordena os cards DENTRO de cada coluna pelo campo escolhido (valor cru).
  const s = useSort(filtered, { key: "created_at", dir: "desc" });

  const byStatus = useMemo(() => {
    const map = new Map<string, Modelo[]>();
    statusKanban.forEach((s) => map.set(s.key, []));
    const firstKey = statusKanban[0]?.key;
    s.sorted.forEach((m) => {
      const k = m.status_desenvolvimento && map.has(m.status_desenvolvimento)
        ? m.status_desenvolvimento
        : firstKey;
      if (k) map.get(k)!.push(m);
    });
    return map;
  }, [s.sorted, statusKanban]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("modelos")
        .update({ status_desenvolvimento: status })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["modelos-desenvolvimento"] });
      const prev = qc.getQueryData<Modelo[]>(["modelos-desenvolvimento"]);
      qc.setQueryData<Modelo[]>(["modelos-desenvolvimento"], (old) =>
        (old ?? []).map((m) => m.id === id ? { ...m, status_desenvolvimento: status } : m)
      );
      return { prev };
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["modelos-desenvolvimento"], ctx.prev);
      toast.error(mensagemErro(e, "Erro ao atualizar status"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] }),
  });

  const handleDrop = (statusKey: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    setDraggingId(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const cur = modelos.find((m) => m.id === id);
    if (!cur || cur.status_desenvolvimento === statusKey) return;
    // Motor de regras: só entra no status se os requisitos estiverem satisfeitos.
    const { ok, faltando } = podeEntrar(id, statusKey);
    if (!ok) {
      toast.error(`Não pode entrar aqui. Faltam: ${faltando.map((c) => c.label).join(", ")}`);
      return;
    }
    updateStatus.mutate({ id, status: statusKey });
  };

  const allCollapsed = statusKanban.length > 0 && statusKanban.every((s) => collapsed.has(s.key));
  const toggleAll = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(statusKanban.map((s) => s.key)));

  // TECIDOS (grupos dentro das colunas): recolher/expandir TODOS, e DEFAULT recolhido (dono, jul/2026).
  // Todos os caminhos de grupo (formato do render: `${status}/${grupo}[/${sub}…]`).
  const allGroupPaths: string[] = [];
  if (splitters.length > 0) {
    const walk = (nodes: Grupo[], path: string) => {
      for (const g of nodes) { const p = `${path}/${g.key}`; allGroupPaths.push(p); if (g.subgroups) walk(g.subgroups, p); }
    };
    for (const st of statusKanban) { const cards = byStatus.get(st.key) ?? []; if (cards.length) walk(buildGroups(cards, 0), st.key); }
  }
  const allTecidosRecolhidos = allGroupPaths.length > 0 && allGroupPaths.every((p) => collapsedGroups.has(p));
  // ⚠️ Ref compartilhado com toggleGroup (declarado no topo): quando o usuário mexe num grupo OU
  // usa este botão, para de auto-recolher. Aqui só marca + alterna.
  const toggleTecidos = () => {
    tecidosTocadoRef.current = true;
    setCollapsedGroups(allTecidosRecolhidos ? new Set() : new Set(allGroupPaths));
  };
  // DEFAULT: todos os tecidos recolhidos. Re-recolhe enquanto os grupos MUDAM (o tecido por modelo
  // carrega depois — no 1º instante tudo é "Sem tecido"; sem re-semear, os grupos reais nasceriam
  // abertos) — até o usuário mexer (tecidosTocadoRef). Chaveado pelo conteúdo dos paths.
  const groupPathsKey = allGroupPaths.join("|");
  useEffect(() => {
    if (tecidosTocadoRef.current || splitters.length === 0 || allGroupPaths.length === 0) return;
    setCollapsedGroups(new Set(allGroupPaths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupPathsKey, splitters.length]);

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Hammer className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight">Desenvolvimento</h1>
            <p className="text-sm text-muted-foreground">Kanban dos modelos planejados.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* ordem: lupa · recolher (desktop) · ordenar · filtros */}
          <SearchToggle value={search} onChange={setSearch} placeholder="Pesquisar por nome ou REF…" />
          {/* Dois níveis (dono): "Tecidos" = grupos dentro das colunas; "Colunas" = as colunas. */}
          {splitters.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex h-9"
              onClick={toggleTecidos}
              disabled={allGroupPaths.length === 0}
              title={allTecidosRecolhidos ? "Expandir todos os tecidos" : "Recolher todos os tecidos"}
            >
              {allTecidosRecolhidos ? <ChevronsUpDown className="h-4 w-4 sm:mr-1" /> : <ChevronsDownUp className="h-4 w-4 sm:mr-1" />}
              <span className="max-lg:sr-only">{allTecidosRecolhidos ? "Expandir tecidos" : "Recolher tecidos"}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="hidden md:inline-flex h-9"
            onClick={toggleAll}
            title={allCollapsed ? "Expandir todas as colunas" : "Recolher todas as colunas"}
          >
            {allCollapsed ? <ChevronsUpDown className="h-4 w-4 sm:mr-1" /> : <ChevronsDownUp className="h-4 w-4 sm:mr-1" />}
            <span className="max-lg:sr-only">{allCollapsed ? "Expandir colunas" : "Recolher colunas"}</span>
          </Button>
          <AgrupamentoButton
            groups={[
              { label: "Tecido", active: groupByTecido, onToggle: toggleTecido },
            ]}
          />
          <Select value={s.sortKey ?? ""} onValueChange={(v) => s.toggle(v)}>
            <SelectTrigger className="h-9 w-auto gap-1 text-xs sm:text-sm">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              {SORT_FIELDS.map((f) => (
                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FilterButton
            screen="desenvolvimento"
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: statusKanban.map((s) => ({ id: s.key, nome: s.label })) },
              { label: "Explosão", value: fCad, onChange: setFCad, options: [{ id: "enviado", nome: "Enviado à Explosão" }, { id: "nao", nome: "Não enviado" }] },
              { label: "Estilista", value: fEstilista, onChange: setFEstilista, options: estilistas },
              { label: "Modelista", value: fModelista, onChange: setFModelista, options: modelistas },
              { label: "Piloteiro", value: fPiloteiro, onChange: setFPiloteiro, options: piloteiros },
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: colecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: subcolecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Grupo", value: fGrupo, onChange: setFGrupo, options: grupos },
              { label: "Categoria", value: fCat, onChange: setFCat, options: categoriasFiltradasPorGrupo },
              { label: "Subcategoria", value: fSub1, onChange: setFSub1, options: sub1Opts.map((s) => ({ id: s.id, nome: s.nome })) },
              { label: "Lançamento nº", value: fSemana, onChange: setFSemana, options: ["1","2","3","4","5"].map((s) => ({ id: s, nome: s })) },
              { label: "Mês", value: fMes, onChange: setFMes, options: meses },
              { label: "Ano", value: fAno, onChange: setFAno, options: anos },
            ]}
          />
        </div>
      </header>

      {/* Desktop: Kanban — coluna EXPANDIDA tem título HORIZONTAL no topo (era vertical, ~2× mais
          lento de ler — laudo das 3 lentes); coluna RECOLHIDA vira trilho estreito com título
          vertical (só cabe vertical). items-stretch = colunas na altura da mais alta. */}
      <div className="hidden md:flex gap-4 overflow-x-auto pb-4 items-stretch">
        {statusKanban.map((s) => {
          const cards = byStatus.get(s.key) ?? [];
          const isOver = dragOver === s.key;
          const isCollapsed = collapsed.has(s.key);
          // Feedback de arraste (laudo das 3 lentes): ao arrastar, TODO destino válido acende
          // (não só quando há regra bloqueando); a coluna de ORIGEM fica neutra; o destino
          // bloqueado esmaece + diz o que falta. Usa o status EFETIVO (status null cai na 1ª coluna).
          const dragModel = draggingId ? modelos.find((m) => m.id === draggingId) : null;
          const dragEff = dragModel ? (dragModel.status_desenvolvimento && statusKeySet.has(dragModel.status_desenvolvimento) ? dragModel.status_desenvolvimento : firstStatusKey) : null;
          const isSelf = !!draggingId && dragEff === s.key;
          const bloqueio = !!draggingId && !isSelf ? podeEntrar(draggingId!, s.key).faltando : [];
          const blocked = bloqueio.length > 0;
          const canDrop = !!draggingId && !isSelf && !blocked;
          return (
            <div
              key={s.key}
              className={`shrink-0 rounded-lg flex flex-col max-h-[calc(100vh-260px)] transition-colors ${isCollapsed ? "" : "w-80"} ${
                blocked ? "border border-dashed border-destructive/50 bg-destructive/5 pointer-events-none"
                : canDrop ? "border-2 border-dashed border-primary/60 bg-primary/10"
                : "border bg-muted/30"
              } ${isOver && !isSelf ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
              onDragLeave={() => setDragOver((cur) => (cur === s.key ? null : cur))}
              onDrop={(e) => handleDrop(s.key, e)}
            >
              {isCollapsed ? (
                /* Recolhida: trilho vertical estreito (clica p/ expandir) */
                <button
                  type="button"
                  onClick={() => toggleCollapse(s.key)}
                  title={s.label}
                  className="flex-1 w-9 flex flex-col items-center gap-2 py-3 hover:bg-muted/50"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} />
                  <span className="text-sm font-semibold whitespace-nowrap [writing-mode:vertical-rl] rotate-180">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </button>
              ) : (
                <>
                  {/* Título horizontal no topo (clica p/ recolher) */}
                  <button
                    type="button"
                    onClick={() => toggleCollapse(s.key)}
                    title="Recolher coluna"
                    className="flex items-center gap-2 px-3 py-2.5 border-b hover:bg-muted/50 text-left"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} />
                    <span className="text-sm font-semibold truncate">{s.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 rotate-90" />
                  </button>
                  {/* Bloqueio no arraste: diz O QUE falta (não fica só apagado) */}
                  {blocked && (
                    <div className="px-3 py-1.5 border-b border-dashed border-destructive/40 text-[11px] leading-snug text-destructive">
                      <span className="font-semibold">Não pode entrar aqui.</span> Faltam: {bloqueio.map((c) => c.label).join(" · ")}
                    </div>
                  )}
                  {/* Destino válido em foco: convite positivo (espelho da faixa de bloqueio). */}
                  {canDrop && isOver && (
                    <div className="px-3 py-1.5 border-b border-dashed border-primary/40 text-[11px] leading-snug text-primary">
                      Solte aqui para mover
                    </div>
                  )}
                  {/* Cards empilhados */}
                  <div className={`flex-1 min-w-0 p-2 space-y-2 overflow-y-auto transition-opacity ${blocked ? "opacity-40" : ""}`}>
                    {cards.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Sem cards</p>
                    ) : splitters.length === 0 ? (
                      cards.map(renderDesktopCard)
                    ) : (
                      renderGroups(buildGroups(cards, 0), s.key, renderDesktopCard)
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: lista agrupada por status com seletor para mover */}
      <div className="md:hidden">
        <Accordion type="multiple" defaultValue={firstStatusKey ? [firstStatusKey] : []} className="space-y-2">
          {statusKanban.map((s) => {
            const cards = byStatus.get(s.key) ?? [];
            return (
              <AccordionItem key={s.key} value={s.key} className="rounded-lg border bg-muted/30 px-3">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <div className="flex flex-1 items-center justify-between gap-2 pr-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} />
                      <span className="truncate text-sm font-semibold">{s.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{cards.length}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  {cards.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Sem cards</p>
                  ) : splitters.length === 0 ? (
                    <div className="space-y-2">{cards.map(renderMobileCard)}</div>
                  ) : (
                    <div className="space-y-3">{renderGroups(buildGroups(cards, 0), s.key, renderMobileCard)}</div>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      <ModeloDetailPanel modeloId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

// Capa do card. Foto (imagem) é clicável e abre o lightbox (ImagePreview faz
// stopPropagation, então NÃO abre o painel de detalhe junto). PDF/vazio seguem inertes
// (clique cai no card = abre o detalhe).
function CardCover({ url, isPdf, nome }: { url: string | null; isPdf: boolean; nome: string | null }) {
  const box = "h-14 w-14 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center";
  if (!url) return <div className={box}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
  if (isPdf) return <div className={box}><iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="" className="h-full w-full pointer-events-none" /></div>;
  return (
    <ImagePreview src={url} alt={nome ?? ""} className={box}>
      <img src={url} alt={nome ?? ""} draggable={false} className="h-full w-full object-cover" />
    </ImagePreview>
  );
}

// Badge da MO por serviço no card. `estado` derivado de `modelo_mo_resumo`:
// aprovada=verde, reprovada=vermelho, pendente=âmbar; sem_servico ou undefined
// (sem custo/mascarado pela RPC) = sem badge.
function MaoObraBadge({ estado }: { estado?: string }) {
  if (estado === "aprovada")
    return <StatusBadge tone="success" className="mt-0.5 gap-1 normal-case tracking-normal"><Check className="h-3 w-3" />Custo aprovado</StatusBadge>;
  if (estado === "reprovada")
    return <StatusBadge tone="danger" className="mt-0.5 gap-1 normal-case tracking-normal"><X className="h-3 w-3" />Custo reprovado</StatusBadge>;
  if (estado === "pendente")
    return <StatusBadge tone="warning" className="mt-0.5 gap-1 normal-case tracking-normal"><AlertTriangle className="h-3 w-3" />Custo pendente</StatusBadge>;
  return null;
}

function MobileCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, moverOpts, onMove }: {
  modelo: Modelo;
  moEstado?: string;
  estilistaNome: string | null;
  categoriaNome: string | null;
  onOpen: () => void;
  moverOpts?: { key: string; label: string; faltando: string[] }[];
  onMove?: (statusKey: string) => void;
}) {
  const fl = useFieldLabels();
  // Hierarquia da capa: Foto do Modelo -> Desenho Técnico -> Croqui -> vazio.
  const cover = modelo.fotos_modelo?.[0] || modelo.desenho_tecnico_url || modelo.croqui_url || null;
  const url = useSignedUrlBucket(cover);
  const coverIsPdf = /\.pdf$/i.test(cover ?? "");
  const naExplosao = !!modelo.enviado_cad && !modelo.cad?.[0]?.enviado_corte;
  return (
    <div className="relative bg-card border rounded-md p-2 space-y-2">
      {naExplosao && (
        <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-sky-600 ring-2 ring-card" aria-label="Enviado à Explosão" />
      )}
      <div className="flex gap-2" onClick={onOpen} role="button">
        <CardCover url={url} isPdf={coverIsPdf} nome={modelo.nome} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium truncate">{modelo.nome ?? "Sem nome"}</p>
            <VersaoBadge versao={modelo.versao} className="text-[10px]" />
          </div>
          {modelo.ref && <p className="text-xs font-mono text-primary truncate">{fl("ref")} {modelo.ref}</p>}
          <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{categoriaNome ?? "—"}</p>
          <MaoObraBadge estado={moEstado} />
        </div>
      </div>
      {/* "Mover para…" = arraste do desktop, no toque. key por status reseta o placeholder ao mover. */}
      {moverOpts && moverOpts.length > 0 && onMove && (
        <Select key={modelo.status_desenvolvimento} onValueChange={onMove}>
          <SelectTrigger className="h-9 text-xs" onClick={(e) => e.stopPropagation()}>
            <SelectValue placeholder="Mover para…" />
          </SelectTrigger>
          <SelectContent>
            {moverOpts.map((o) => (
              <SelectItem key={o.key} value={o.key} className={o.faltando.length ? "text-muted-foreground" : ""}>
                {o.label}
                {o.faltando.length > 0 && <span className="text-xs opacity-70"> · falta {o.faltando.join(", ")}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}


function KanbanCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, draggable: isDraggable, dragging, onDragStartCard, onDragEndCard }: {
  modelo: Modelo; moEstado?: string; estilistaNome: string | null; categoriaNome: string | null; onOpen: () => void; draggable: boolean;
  dragging?: boolean; onDragStartCard?: () => void; onDragEndCard?: () => void;
}) {
  const fl = useFieldLabels();
  // Hierarquia da capa: Foto do Modelo -> Desenho Técnico -> Croqui -> vazio.
  const cover = modelo.fotos_modelo?.[0] || modelo.desenho_tecnico_url || modelo.croqui_url || null;
  const url = useSignedUrlBucket(cover);
  const coverIsPdf = /\.pdf$/i.test(cover ?? "");
  const naExplosao = !!modelo.enviado_cad && !modelo.cad?.[0]?.enviado_corte;
  const { handlers, node } = useCursorTip(naExplosao ? "Enviado à Explosão" : null);
  return (
    <>
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", modelo.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStartCard?.();
      }}
      onDragEnd={() => onDragEndCard?.()}
      className={`relative bg-card border rounded-md p-2 hover:shadow-md transition-shadow ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging ? "opacity-50 ring-2 ring-primary" : ""}`}
      onClick={onOpen}
      {...handlers}
    >
      {naExplosao && (
        <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-sky-600 ring-2 ring-card" aria-label="Enviado à Explosão" />
      )}
      <div className="flex gap-2">
        <CardCover url={url} isPdf={coverIsPdf} nome={modelo.nome} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium truncate">{modelo.nome ?? "Sem nome"}</p>
            <VersaoBadge versao={modelo.versao} className="text-[10px]" />
          </div>
          {modelo.ref && <p className="text-xs font-mono text-primary truncate">{fl("ref")} {modelo.ref}</p>}
          <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{categoriaNome ?? "—"}</p>
          <MaoObraBadge estado={moEstado} />
        </div>
      </div>
    </div>
    {node}
    </>
  );
}

/* Signed URL hook scoped to modelos bucket */
const _cache = new Map<string, { url: string; exp: number }>();
function useSignedUrlBucket(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    const key = `${BUCKET}:${path}`;
    const cached = _cache.get(key);
    const now = Date.now();
    if (cached && cached.exp > now + 60_000) { setUrl(cached.url); return; }
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      _cache.set(key, { url: data.signedUrl, exp: now + 3600_000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}
