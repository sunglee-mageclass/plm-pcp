import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/etiquetas")({
  component: () => (
    <RequirePermission page="cadastro_etiquetas">
      <EtiquetasPage />
    </RequirePermission>
  ),
});

type Etiqueta = { id: string; nome: string; tamanho: string | null };

// "38|P" -> "P · 38"
const fmtTamanho = (t: string) => {
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
};

function EtiquetasPage() {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [tamanho, setTamanho] = useState("");

  const { data: etiquetas = [], isLoading } = useQuery({
    queryKey: ["etiquetas-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase.from("etiquetas" as any).select("id, nome, tamanho").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Etiqueta[];
    },
  });

  const { data: tamanhos = [] } = useQuery({
    queryKey: ["tenant-tamanhos-grade"],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle();
      const raw = (data as any)?.tamanhos_grade;
      return (Array.isArray(raw) ? raw : []).map((x: any) => (typeof x === "string" ? x : String(x))) as string[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["etiquetas-cadastro"] });
    qc.invalidateQueries({ queryKey: ["etiquetas-opts"] }); // select do CAD
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const v = nome.trim();
      if (!v) throw new Error("Informe o nome da etiqueta.");
      const { error } = await supabase.from("etiquetas" as any).insert({ nome: v, tamanho: tamanho || null });
      if (error) throw error;
    },
    onSuccess: () => { setNome(""); setTamanho(""); invalidate(); },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Etiqueta já existe." : e.message ?? "Erro ao adicionar."),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Etiqueta> }) => {
      const { error } = await supabase.from("etiquetas" as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Etiqueta já existe." : e.message ?? "Erro ao salvar."),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("etiquetas" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(e?.code === "23503" ? "Etiqueta em uso em algum CAD. Remova de lá antes." : e.message ?? "Erro ao excluir."),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Tag className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">TAG/Etiquetas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de tags / etiquetas. Atrele um tamanho para calcular a quantidade pela grade no CAD.
          </p>
        </div>
      </header>

      <div className="rounded-lg border bg-card p-4 space-y-4 max-w-3xl">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1 flex-1 min-w-[180px]">
            <Label className="text-xs">Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Etiqueta de composição"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMut.mutate(); } }}
            />
          </div>
          <div className="grid gap-1 w-48">
            <Label className="text-xs">Tamanho (opcional)</Label>
            <Select value={tamanho || "none"} onValueChange={(v) => setTamanho(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Sem tamanho" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem tamanho</SelectItem>
                {tamanhos.map((t) => <SelectItem key={t} value={t}>{fmtTamanho(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={() => addMut.mutate()} disabled={addMut.isPending}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : etiquetas.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhuma etiqueta ainda.</p>
        ) : (
          <ul className="space-y-2">
            {etiquetas.map((et) => (
              <EtiquetaRowItem
                key={et.id}
                etiqueta={et}
                tamanhos={tamanhos}
                onRename={(n) => updateMut.mutate({ id: et.id, patch: { nome: n } })}
                onTamanho={(t) => updateMut.mutate({ id: et.id, patch: { tamanho: t } })}
                onRemove={() => delMut.mutate(et.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EtiquetaRowItem({
  etiqueta, tamanhos, onRename, onTamanho, onRemove,
}: {
  etiqueta: Etiqueta;
  tamanhos: string[];
  onRename: (nome: string) => void;
  onTamanho: (tamanho: string | null) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(etiqueta.nome);
  useEffect(() => setValue(etiqueta.nome), [etiqueta.nome]);
  const commit = () => {
    const v = value.trim();
    if (!v) { setValue(etiqueta.nome); return; }
    if (v !== etiqueta.nome) onRename(v);
  };
  return (
    <li className="flex items-center gap-2 rounded-md border bg-card p-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        className="h-8 flex-1 border-0 shadow-none focus-visible:ring-1"
      />
      <Select value={etiqueta.tamanho || "none"} onValueChange={(v) => onTamanho(v === "none" ? null : v)}>
        <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Sem tamanho" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem tamanho</SelectItem>
          {tamanhos.map((t) => <SelectItem key={t} value={t}>{fmtTamanho(t)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}
