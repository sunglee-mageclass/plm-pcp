import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, Search, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";

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
type KanbanStatus = { key: string; label: string; color?: string };

const DEFAULT_STATUSES: KanbanStatus[] = [
  { key: "em_modelagem", label: "Em Modelagem", color: "#3b82f6" },
  { key: "corte_piloto_1", label: "Corte de Piloto I", color: "#6366f1" },
  { key: "corte_piloto_2", label: "Corte de Piloto II", color: "#6366f1" },
  { key: "corte_piloto_3", label: "Corte de Piloto III", color: "#6366f1" },
  { key: "em_pilotagem", label: "Em Pilotagem", color: "#8b5cf6" },
  { key: "prova_roupa_1", label: "Prova de Roupa I", color: "#a855f7" },
  { key: "prova_roupa_2", label: "Prova de Roupa II", color: "#a855f7" },
  { key: "prova_roupa_3", label: "Prova de Roupa III", color: "#a855f7" },
  { key: "prova_roupa_4", label: "Prova de Roupa IV", color: "#a855f7" },
  { key: "prova_roupa_5", label: "Prova de Roupa V", color: "#a855f7" },
  { key: "em_ajuste", label: "Em Ajuste", color: "#f59e0b" },
  { key: "stand_by", label: "Stand By", color: "#64748b" },
  { key: "reprovado", label: "Reprovado", color: "#ef4444" },
  { key: "aprovado", label: "Aprovado", color: "#10b981" },
];

type Modelo = {
  id: string;
  nome: string | null;
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
};

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

function normalizeStatuses(raw: any): KanbanStatus[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STATUSES;
  return raw
    .map((s: any, i: number): KanbanStatus | null => {
      if (typeof s === "string") {
        return { key: s, label: s };
      }
      if (s && typeof s === "object") {
        const key = s.key ?? s.id ?? s.value ?? s.slug ?? `s${i}`;
        const label = s.label ?? s.nome ?? s.name ?? String(key);
        return { key: String(key), label: String(label), color: s.color };
      }
      return null;
    })
    .filter(Boolean) as KanbanStatus[];
}

function DesenvolvimentoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fEstilista, setFEstilista] = useState("all");
  const [fModelista, setFModelista] = useState("all");
  const [fPiloteiro, setFPiloteiro] = useState("all");
  const [fSemana, setFSemana] = useState("");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fColecao, setFColecao] = useState("all");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: estilistas = [] } = useColaboradoresByTipo("estilista");
  const { data: modelistas = [] } = useColaboradoresByTipo("modelista");
  const { data: piloteiros = [] } = useColaboradoresByTipo("piloteiro");
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: categorias = [] } = useOpts("categorias_produto");

  const { data: statusKanban = DEFAULT_STATUSES } = useQuery({
    queryKey: ["tenant-status-kanban"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("status_kanban")
        .maybeSingle();
      if (error) throw error;
      return normalizeStatuses(data?.status_kanban);
    },
  });

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-desenvolvimento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, colecao, semana, mes_id, ano_id, categoria_principal_id, status_desenvolvimento, fotos_modelo")
        .eq("status_planejamento", "planejado")
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

  const filtered = modelos.filter((m) => {
    if (search && !(m.nome ?? "").toLowerCase().includes(search.toLowerCase())) return false;
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

  const byStatus = useMemo(() => {
    const map = new Map<string, Modelo[]>();
    statusKanban.forEach((s) => map.set(s.key, []));
    const firstKey = statusKanban[0]?.key;
    filtered.forEach((m) => {
      const k = m.status_desenvolvimento && map.has(m.status_desenvolvimento)
        ? m.status_desenvolvimento
        : firstKey;
      if (k) map.get(k)!.push(m);
    });
    return map;
  }, [filtered, statusKanban]);

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
      toast.error(e.message ?? "Erro ao atualizar status");
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
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Hammer className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Desenvolvimento</h1>
            <p className="text-sm text-muted-foreground">Kanban dos modelos planejados.</p>
          </div>
        </div>
      </header>

      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Pesquisar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <FilterSelect label="Estilista" value={fEstilista} onChange={setFEstilista} options={[{ id: "all", nome: "Todos" }, ...estilistas]} />
          <FilterSelect label="Modelista" value={fModelista} onChange={setFModelista} options={[{ id: "all", nome: "Todos" }, ...modelistas]} />
          <FilterSelect label="Piloteiro" value={fPiloteiro} onChange={setFPiloteiro} options={[{ id: "all", nome: "Todos" }, ...piloteiros]} />
          <FilterSelect label="Coleção" value={fColecao} onChange={setFColecao} options={[{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))]} />
          <div className="grid gap-1">
            <Label className="text-xs">Semana</Label>
            <Select value={fSemana || "all"} onValueChange={(v) => setFSemana(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <FilterSelect label="Mês" value={fMes} onChange={setFMes} options={[{ id: "all", nome: "Todos" }, ...meses]} />
          <FilterSelect label="Ano" value={fAno} onChange={setFAno} options={[{ id: "all", nome: "Todos" }, ...anos]} />
        </div>
      </Card>

      <div className="flex gap-4 overflow-x-auto pb-4">
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
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <ModeloDetailPanel modeloId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function KanbanCard({ modelo, estilistaNome, categoriaNome, onOpen }: {
  modelo: Modelo; estilistaNome: string | null; categoriaNome: string | null; onOpen: () => void;
}) {
  const photo = modelo.fotos_modelo?.[0] ?? null;
  const url = useSignedUrlBucket(photo);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", modelo.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="bg-card border rounded-md p-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      onClick={onOpen}
    >
      <div className="flex gap-2">
        <div className="h-14 w-14 shrink-0 rounded bg-muted overflow-hidden flex items-center justify-center">
          {url ? <img src={url} alt={modelo.nome ?? ""} className="h-full w-full object-cover" />
               : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{modelo.nome ?? "Sem nome"}</p>
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
