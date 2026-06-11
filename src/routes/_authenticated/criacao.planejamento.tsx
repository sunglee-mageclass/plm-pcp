import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Plus, Search, Upload, Trash2, Copy, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";

export const Route = createFileRoute("/_authenticated/criacao/planejamento")({
  component: PlanejamentoPage,
});

const BUCKET = "modelos";

type Opt = { id: string; nome: string };
type Modelo = {
  id: string;
  nome: string | null;
  estilista_id: string | null;
  colecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  categoria_secundaria_id: string | null;
  status_planejamento: string | null;
  fotos_modelo: string[] | null;
  fotos_referencia: string[] | null;
  observacoes_gerais: string | null;
};

const STATUS_OPTS = [
  { value: "em_planejamento", label: "Em Planejamento", color: "bg-amber-500" },
  { value: "reprovado", label: "Reprovado", color: "bg-red-500" },
  { value: "planejado", label: "Planejado", color: "bg-emerald-500" },
];
const statusMeta = (s: string | null) => STATUS_OPTS.find((o) => o.value === s) ?? STATUS_OPTS[0];

async function uploadFile(file: File, prefix: string) {
  const path = `${prefix}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

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

function PlanejamentoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fEstilista, setFEstilista] = useState("all");
  const [fSemana, setFSemana] = useState("");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fColecao, setFColecao] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const { data: meses = [] } = useOpts("meses");
  const { data: anos = [] } = useOpts("anos");
  const { data: categorias = [] } = useOpts("categorias_produto");

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, estilista_id, colecao, semana, mes_id, ano_id, categoria_principal_id, categoria_secundaria_id, status_planejamento, fotos_modelo, fotos_referencia, observacoes_gerais")
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
    if (fStatus !== "all" && m.status_planejamento !== fStatus) return false;
    if (fEstilista !== "all" && m.estilista_id !== fEstilista) return false;
    if (fSemana && m.semana !== fSemana) return false;
    if (fMes !== "all" && m.mes_id !== fMes) return false;
    if (fAno !== "all" && m.ano_id !== fAno) return false;
    if (fCat !== "all" && m.categoria_principal_id !== fCat) return false;
    if (fColecao !== "all" && m.colecao !== fColecao) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Palette className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Planejamento</h1>
            <p className="text-sm text-muted-foreground">Cards de modelos em planejamento.</p>
          </div>
        </div>
        <Button onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Novo Modelo</Button>
      </header>

      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Pesquisar por nome…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={[{ id: "all", nome: "Todos" }, ...STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label }))]} />
          <FilterSelect label="Estilista" value={fEstilista} onChange={setFEstilista} options={[{ id: "all", nome: "Todos" }, ...estilistas]} />
          <div className="grid gap-1">
            <Label className="text-xs">Semana</Label>
            <Input value={fSemana} onChange={(e) => setFSemana(e.target.value)} placeholder="Ex: 1" />
          </div>
          <FilterSelect label="Mês" value={fMes} onChange={setFMes} options={[{ id: "all", nome: "Todos" }, ...meses]} />
          <FilterSelect label="Ano" value={fAno} onChange={setFAno} options={[{ id: "all", nome: "Todos" }, ...anos]} />
          <FilterSelect label="Categoria" value={fCat} onChange={setFCat} options={[{ id: "all", nome: "Todas" }, ...categorias]} />
          <FilterSelect label="Coleção" value={fColecao} onChange={setFColecao} options={[{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))]} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">Nenhum modelo encontrado.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((m) => (
            <ModeloCard key={m.id} modelo={m} estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null} onOpen={() => setOpenId(m.id)} />
          ))}
        </div>
      )}

      {(openNew || openId) && (
        <ModeloDialog
          modeloId={openId}
          estilistas={estilistas}
          meses={meses}
          anos={anos}
          categorias={categorias}
          onClose={() => { setOpenNew(false); setOpenId(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["modelos-planejamento"] })}
        />
      )}
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

function ModeloCard({ modelo, estilistaNome, onOpen }: {
  modelo: Modelo; estilistaNome: string | null; onOpen: () => void;
}) {
  const photo = modelo.fotos_modelo?.[0] ?? null;
  const url = useSignedUrlBucket(photo);
  const meta = statusMeta(modelo.status_planejamento);
  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={onOpen}>
      <div className="aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden">
        {url ? <img src={url} alt={modelo.nome ?? ""} className="w-full h-full object-cover" />
             : <ImageIcon className="h-10 w-10 text-muted-foreground" />}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight truncate">{modelo.nome ?? "Sem nome"}</h3>
          <Badge className={`${meta.color} text-white shrink-0`}>{meta.label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
        <p className="text-xs text-muted-foreground truncate">{modelo.colecao ?? "Sem coleção"}</p>
      </div>
    </Card>
  );
}

/* Signed URL hook scoped to modelos bucket — reusing useSignedUrl with prefix won't work since it's tied
   to a different bucket. Inline a small helper here. */
function useSignedUrlBucket(path: string | null | undefined) {
  // Reuse the global hook is bound to tecido-variantes; build a tiny ad-hoc one.
  return useSignedFromBucket(path, BUCKET);
}
// dedicated cache per bucket
const _cache = new Map<string, { url: string; exp: number }>();
function useSignedFromBucket(path: string | null | undefined, bucket: string) {
  const [u, set] = useStateLazy(path);
  return u;
  function useStateLazy(p: string | null | undefined) {
    // minimal state hook wrap
    const [state, setState] = useStateInner<string | null>(null);
    useEffectInner(() => {
      let alive = true;
      if (!p) { setState(null); return; }
      const cached = _cache.get(`${bucket}:${p}`);
      const now = Date.now();
      if (cached && cached.exp > now + 60_000) { setState(cached.url); return; }
      supabase.storage.from(bucket).createSignedUrl(p, 3600).then(({ data }) => {
        if (!alive || !data?.signedUrl) return;
        _cache.set(`${bucket}:${p}`, { url: data.signedUrl, exp: now + 3600_000 });
        setState(data.signedUrl);
      });
      return () => { alive = false; };
    }, [p]);
    return [state, setState] as const;
  }
}
// re-export react hooks under aliases so the nested defs above work
import { useState as useStateInner, useEffect as useEffectInner } from "react";
void useSignedUrl;

/* ============ DIALOG ============ */

type Draft = {
  nome: string;
  estilista_id: string | null;
  colecao: string;
  semana: string;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  categoria_secundaria_id: string | null;
  status_planejamento: string;
  fotos_modelo: string[];
  fotos_referencia: string[];
  observacoes_gerais: string;
};
const emptyDraft = (): Draft => ({
  nome: "", estilista_id: null, colecao: "", semana: "", mes_id: null, ano_id: null,
  categoria_principal_id: null, categoria_secundaria_id: null,
  status_planejamento: "em_planejamento", fotos_modelo: [], fotos_referencia: [],
  observacoes_gerais: "",
});

function ModeloDialog({
  modeloId, estilistas, meses, anos, categorias, onClose, onSaved,
}: {
  modeloId: string | null; estilistas: Opt[]; meses: Opt[]; anos: Opt[]; categorias: Opt[];
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!modeloId;
  const qc = useQueryClient();
  const [draft, setDraft] = useStateInner<Draft>(emptyDraft());
  const [tecidoText, setTecidoText] = useStateInner("");
  const [confirmDel, setConfirmDel] = useStateInner(false);

  useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      if (data) {
        setDraft({
          nome: data.nome ?? "",
          estilista_id: data.estilista_id,
          colecao: data.colecao ?? "",
          semana: data.semana ?? "",
          mes_id: data.mes_id,
          ano_id: data.ano_id,
          categoria_principal_id: data.categoria_principal_id,
          categoria_secundaria_id: data.categoria_secundaria_id,
          status_planejamento: data.status_planejamento ?? "em_planejamento",
          fotos_modelo: data.fotos_modelo ?? [],
          fotos_referencia: data.fotos_referencia ?? [],
          observacoes_gerais: data.observacoes_gerais ?? "",
        });
      }
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, key }: { file: File; key: "fotos_modelo" | "fotos_referencia" }) => {
      const path = await uploadFile(file, key);
      return { path, key };
    },
    onSuccess: ({ path, key }) => setDraft((d) => ({ ...d, [key]: [...d[key], path] })),
    onError: (e: any) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = { ...draft };
      if (isEdit && modeloId) {
        const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("modelos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Modelo salvo"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      const payload: any = { ...draft, nome: `${draft.nome} (cópia)`, status_planejamento: "em_planejamento" };
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Card duplicado"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.from("modelos").delete().eq("id", modeloId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Modelo excluído"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? draft.nome || "Modelo" : "Novo Modelo"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <FieldText label="Nome do Modelo" value={draft.nome} onChange={(v) => setDraft((d) => ({ ...d, nome: v }))} />
            <FieldSelect label="Estilista" value={draft.estilista_id} onChange={(v) => setDraft((d) => ({ ...d, estilista_id: v }))} options={estilistas} />
            <FieldText label="Coleção" value={draft.colecao} onChange={(v) => setDraft((d) => ({ ...d, colecao: v }))} />
            <FieldText label="Semana" value={draft.semana} onChange={(v) => setDraft((d) => ({ ...d, semana: v }))} />
            <FieldSelect label="Mês" value={draft.mes_id} onChange={(v) => setDraft((d) => ({ ...d, mes_id: v }))} options={meses} />
            <FieldSelect label="Ano" value={draft.ano_id} onChange={(v) => setDraft((d) => ({ ...d, ano_id: v }))} options={anos} />
            <FieldSelect label="Categoria Principal" value={draft.categoria_principal_id} onChange={(v) => setDraft((d) => ({ ...d, categoria_principal_id: v }))} options={categorias} />
            <FieldSelect label="Categoria Secundária" value={draft.categoria_secundaria_id} onChange={(v) => setDraft((d) => ({ ...d, categoria_secundaria_id: v }))} options={categorias} />
            <FieldText label="Tecido Planejado" value={tecidoText} onChange={setTecidoText} />
            <div className="grid gap-1">
              <Label>Status</Label>
              <Select value={draft.status_planejamento} onValueChange={(v) => setDraft((d) => ({ ...d, status_planejamento: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
              onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
              onRemove={(i) => setDraft((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
            <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
              onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
              onRemove={(i) => setDraft((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {isEdit && (
            <>
              <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
                <Copy className="h-4 w-4 mr-1" /> Duplicar
              </Button>
              <Button variant="destructive" onClick={() => setConfirmDel(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>

        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function FieldSelect({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
function PhotoList({ label, paths, onAdd, onRemove }: {
  label: string; paths: string[]; onAdd: (f: File) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {paths.map((p, i) => (
          <PhotoThumb key={i} path={p} onRemove={() => onRemove(i)} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Adicionar
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onAdd(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
function PhotoThumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  const url = useSignedUrlBucket(path);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      {url ? <img src={url} className="h-full w-full object-cover" alt="" /> : <ImageIcon className="m-auto h-8 w-8 text-muted-foreground" />}
      <button onClick={onRemove} className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
