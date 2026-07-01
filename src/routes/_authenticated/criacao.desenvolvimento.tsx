import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { DEFAULT_STATUSES, type KanbanStatus, normalizeKanbanStatuses } from "@/lib/kanban-status";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";


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
  versao: number | null;
  estilista_id: string | null;
  modelista_id: string | null;
  piloteiro1_id: string | null;
  piloteiro2_id: string | null;
  piloteiro3_id: string | null;
  colecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  status_desenvolvimento: string | null;
  fotos_modelo: string[] | null;
  enviado_cad: boolean | null;
  created_at: string | null;
};

const SORT_FIELDS = [
  { key: "nome", label: "Nome" },
  { key: "ref", label: "REF" },
  { key: "versao", label: "Versão" },
  { key: "created_at", label: "Data" },
] as const;

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, ${key}`).order(key);
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
  const [fEstilista, setFEstilista] = useState("all");
  const [fModelista, setFModelista] = useState("all");
  const [fPiloteiro, setFPiloteiro] = useState("all");
  const [fSemana, setFSemana] = useState("");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fColecao, setFColecao] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fCad, setFCad] = useState("all");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: estilistas = [] } = useColaboradoresByTipo("estilista");
  const { data: modelistas = [] } = useColaboradoresByTipo("modelista");
  const { data: piloteiros = [] } = useColaboradoresByTipo("piloteiro");
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: categorias = [] } = useOpts("categorias_produto");

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

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-desenvolvimento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, ref, versao, estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, colecao, semana, mes_id, ano_id, categoria_principal_id, status_desenvolvimento, fotos_modelo, enviado_cad, created_at")
        .eq("ordem_criacao_enviada", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Modelo[];
    },
  });

  const colecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.colecao && s.add(m.colecao));
    return Array.from(s).sort();
  }, [modelos]);

  const statusKeySet = useMemo(() => new Set(statusKanban.map((s) => s.key)), [statusKanban]);
  const firstStatusKey = statusKanban[0]?.key;

  const filtered = modelos.filter((m) => {
    if (search && !(m.nome ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (fStatus !== "all") {
      // status efetivo = a coluna onde o card cai (null/desconhecido → primeira)
      const eff = m.status_desenvolvimento && statusKeySet.has(m.status_desenvolvimento)
        ? m.status_desenvolvimento
        : firstStatusKey;
      if (eff !== fStatus) return false;
    }
    if (fCad === "enviado" && !m.enviado_cad) return false;
    if (fCad === "nao" && m.enviado_cad) return false;
    if (fEstilista !== "all" && m.estilista_id !== fEstilista) return false;
    if (fModelista !== "all" && m.modelista_id !== fModelista) return false;
    if (fPiloteiro !== "all" &&
      m.piloteiro1_id !== fPiloteiro &&
      m.piloteiro2_id !== fPiloteiro &&
      m.piloteiro3_id !== fPiloteiro) return false;
    if (fSemana && m.semana !== fSemana) return false;
    if (fMes !== "all" && m.mes_id !== fMes) return false;
    if (fAno !== "all" && m.ano_id !== fAno) return false;
    if (fColecao !== "all" && m.colecao !== fColecao) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));
  const catMap = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));

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
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const cur = modelos.find((m) => m.id === id);
    if (!cur || cur.status_desenvolvimento === statusKey) return;
    updateStatus.mutate({ id, status: statusKey });
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Hammer className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="truncate text-xl sm:text-2xl font-bold">Desenvolvimento</h1>
            <p className="text-sm text-muted-foreground">Kanban dos modelos planejados.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
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
          <SearchToggle value={search} onChange={setSearch} placeholder="Pesquisar por nome…" />
          <FilterButton
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: [{ id: "all", nome: "Todos" }, ...statusKanban.map((s) => ({ id: s.key, nome: s.label }))] },
              { label: "CAD", value: fCad, onChange: setFCad, options: [{ id: "all", nome: "Todos" }, { id: "enviado", nome: "Enviado ao CAD" }, { id: "nao", nome: "Não enviado" }] },
              { label: "Estilista", value: fEstilista, onChange: setFEstilista, options: [{ id: "all", nome: "Todos" }, ...estilistas] },
              { label: "Modelista", value: fModelista, onChange: setFModelista, options: [{ id: "all", nome: "Todos" }, ...modelistas] },
              { label: "Piloteiro", value: fPiloteiro, onChange: setFPiloteiro, options: [{ id: "all", nome: "Todos" }, ...piloteiros] },
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
              { label: "Semana", value: fSemana || "all", onChange: (v) => setFSemana(v === "all" ? "" : v), options: [{ id: "all", nome: "Todas" }, ...["1","2","3","4","5"].map((s) => ({ id: s, nome: s }))] },
              { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
            ]}
          />
        </div>
      </header>

      {/* Desktop: Kanban horizontal com drag-and-drop */}
      <div className="hidden md:flex gap-4 overflow-x-auto pb-4">
        {statusKanban.map((s) => {
          const cards = byStatus.get(s.key) ?? [];
          const isOver = dragOver === s.key;
          return (
            <div
              key={s.key}
              className={`w-72 shrink-0 rounded-lg border bg-muted/30 flex flex-col max-h-[calc(100vh-260px)] ${isOver ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
              onDragLeave={() => setDragOver((cur) => (cur === s.key ? null : cur))}
              onDrop={(e) => handleDrop(s.key, e)}
            >
              <div className="px-3 py-2 flex items-center justify-between border-b">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? "#64748b" }} />
                  <span className="text-sm font-semibold">{s.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{cards.length}</span>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto">
                {cards.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Sem cards</p>
                ) : cards.map((m) => (
                  <KanbanCard
                    key={m.id}
                    modelo={m}
                    estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
                    categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
                    onOpen={() => setOpenId(m.id)}
                    draggable={editable}
                  />
                ))}
              </div>
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
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "#64748b" }} />
                      <span className="truncate text-sm font-semibold">{s.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{cards.length}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  {cards.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Sem cards</p>
                  ) : (
                    <div className="space-y-2">
                      {cards.map((m) => (
                        <MobileCard
                          key={m.id}
                          modelo={m}
                          estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
                          categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
                          onOpen={() => setOpenId(m.id)}
                        />
                      ))}
                    </div>
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

function MobileCard({ modelo, estilistaNome, categoriaNome, onOpen }: {
  modelo: Modelo;
  estilistaNome: string | null;
  categoriaNome: string | null;
  onOpen: () => void;
}) {
  const fl = useFieldLabels();
  const photo = modelo.fotos_modelo?.[0] ?? null;
  const url = useSignedUrlBucket(photo);
  return (
    <div className="bg-card border rounded-md p-2">
      <div className="flex gap-2" onClick={onOpen} role="button">
        <div className="h-14 w-14 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
          {url ? <img src={url} alt={modelo.nome ?? ""} className="h-full w-full object-cover" />
               : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium truncate">{modelo.nome ?? "Sem nome"}</p>
            <VersaoBadge versao={modelo.versao} className="text-[10px]" />
          </div>
          {modelo.ref && <p className="text-xs font-mono text-primary truncate">{fl("ref")} {modelo.ref}</p>}
          <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{categoriaNome ?? "—"}</p>
        </div>
      </div>
    </div>
  );
}


function KanbanCard({ modelo, estilistaNome, categoriaNome, onOpen, draggable: isDraggable }: {
  modelo: Modelo; estilistaNome: string | null; categoriaNome: string | null; onOpen: () => void; draggable: boolean;
}) {
  const fl = useFieldLabels();
  const photo = modelo.fotos_modelo?.[0] ?? null;
  const url = useSignedUrlBucket(photo);
  return (
    <div
      draggable={isDraggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", modelo.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`bg-card border rounded-md p-2 hover:shadow-md transition-shadow ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      onClick={onOpen}
    >
      <div className="flex gap-2">
        <div className="h-14 w-14 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
          {url ? <img src={url} alt={modelo.nome ?? ""} className="h-full w-full object-cover" />
               : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-medium truncate">{modelo.nome ?? "Sem nome"}</p>
            <VersaoBadge versao={modelo.versao} className="text-[10px]" />
          </div>
          {modelo.ref && <p className="text-xs font-mono text-primary truncate">{fl("ref")} {modelo.ref}</p>}
          <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{categoriaNome ?? "—"}</p>
        </div>
      </div>
    </div>
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
