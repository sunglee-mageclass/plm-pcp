import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Upload,
  Trash2,
  ImageOff,
  History,
  Loader2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl, VARIANT_BUCKET } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/cadastro/tecidos/$artigoId")({
  component: TecidoDetail,
});

type Artigo = {
  id: string;
  nome: string;
  empresa_id: string | null;
  largura_estimada: number | null;
  categoria_tecido_id: string | null;
  composicao: string | null;
  mes_id: string | null;
  ano_id: string | null;
  preco: number | null;
  rendimento: number | null;
  preco_por_metro: number | null;
  unidade_medida: string;
  historico_precos: any;
};

type Variante = {
  id: string;
  artigo_id: string;
  cor_id: string | null;
  nome_variante: string | null;
  codigo_variante: string | null;
  foto_url: string | null;
};

type Cor = { id: string; nome: string };

function TecidoDetail() {
  const { artigoId } = Route.useParams();
  const qc = useQueryClient();

  const { data: artigo, isLoading } = useQuery({
    queryKey: ["artigo", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("*")
        .eq("id", artigoId)
        .single();
      if (error) throw error;
      return data as Artigo;
    },
  });

  const [form, setForm] = useState<Artigo | null>(null);
  const [catIds, setCatIds] = useState<string[]>([]);
  useEffect(() => {
    if (artigo) setForm(artigo);
  }, [artigo]);

  const { data: catLinks = [] } = useQuery({
    queryKey: ["artigo-cats", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigo_categorias_tecido")
        .select("categoria_tecido_id")
        .eq("artigo_id", artigoId);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.categoria_tecido_id as string);
    },
  });
  useEffect(() => {
    setCatIds(catLinks);
  }, [catLinks]);

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options"],
    queryFn: async () => {
      const { data } = await supabase.from("empresas").select("id,nome_fantasia").order("nome_fantasia");
      return (data ?? []) as { id: string; nome_fantasia: string }[];
    },
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["cat-tecido-options"],
    queryFn: async () => {
      const { data } = await supabase.from("categorias_tecido").select("id,nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const { data: meses = [] } = useQuery({
    queryKey: ["meses-options"],
    queryFn: async () => {
      const { data } = await supabase.from("meses").select("id,mes").order("mes");
      return (data ?? []) as { id: string; mes: string }[];
    },
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["anos-options"],
    queryFn: async () => {
      const { data } = await supabase.from("anos").select("id,ano").order("ano");
      return (data ?? []) as { id: string; ano: string }[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const payload: any = {
        nome: form.nome,
        empresa_id: form.empresa_id || null,
        largura_estimada: form.largura_estimada ?? null,
        categoria_tecido_id: catIds[0] || null,
        composicao: form.composicao || null,
        mes_id: form.mes_id || null,
        ano_id: form.ano_id || null,
        preco: form.preco ?? null,
        unidade_medida: form.unidade_medida,
        rendimento: form.unidade_medida === "kg" ? form.rendimento ?? null : null,
      };
      const { error } = await supabase.from("artigos").update(payload).eq("id", artigoId);
      if (error) throw error;

      // Sync junction
      const { error: delErr } = await supabase
        .from("artigo_categorias_tecido")
        .delete()
        .eq("artigo_id", artigoId);
      if (delErr) throw delErr;
      if (catIds.length > 0) {
        const { error: insErr } = await supabase
          .from("artigo_categorias_tecido")
          .insert(catIds.map((cid) => ({ artigo_id: artigoId, categoria_tecido_id: cid })));
        if (insErr) throw insErr;
      }
    },
    onSuccess: () => {
      toast.success("Tecido atualizado.");
      qc.invalidateQueries({ queryKey: ["artigo", artigoId] });
      qc.invalidateQueries({ queryKey: ["artigos"] });
      qc.invalidateQueries({ queryKey: ["artigo-cats", artigoId] });
      qc.invalidateQueries({ queryKey: ["artigo-cats-all"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  if (isLoading || !form) {
    return (
      <div className="p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Carregando…
      </div>
    );
  }

  const isKg = form.unidade_medida === "kg";
  const precoMetro = isKg
    ? form.preco && form.rendimento
      ? Number(form.preco) / Number(form.rendimento)
      : null
    : form.preco;

  const historico: Array<{ preco: number; preco_por_metro?: number; data: string }> = Array.isArray(
    form.historico_precos,
  )
    ? form.historico_precos
    : [];

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/cadastro/tecidos">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{form.nome}</h1>
            <p className="text-sm text-muted-foreground">Detalhes do tecido</p>
          </div>
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="h-4 w-4 mr-1" />
          {saveMut.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Informações</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Nome">
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </Field>

          <Field label="Fornecedor">
            <Select
              value={form.empresa_id ?? ""}
              onValueChange={(v) => setForm({ ...form, empresa_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome_fantasia}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Largura Estimada (cm)">
            <Input
              type="number"
              value={form.largura_estimada ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  largura_estimada: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </Field>

          <Field label="Categoria do Tecido">
            <Select
              value={form.categoria_tecido_id ?? ""}
              onValueChange={(v) => setForm({ ...form, categoria_tecido_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Composição" className="md:col-span-2">
            <Textarea
              rows={2}
              value={form.composicao ?? ""}
              onChange={(e) => setForm({ ...form, composicao: e.target.value })}
              placeholder="Ex: 100% algodão"
            />
          </Field>

          <Field label="Mês (opcional)">
            <Select
              value={form.mes_id ?? ""}
              onValueChange={(v) => setForm({ ...form, mes_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.mes}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Ano (opcional)">
            <Select
              value={form.ano_id ?? ""}
              onValueChange={(v) => setForm({ ...form, ano_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {anos.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.ano}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Unidade de Medida">
            <Select
              value={form.unidade_medida}
              onValueChange={(v) => setForm({ ...form, unidade_medida: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metro">Metro</SelectItem>
                <SelectItem value="kg">Kg</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Preço">
            <Input
              type="number"
              step="0.01"
              value={form.preco ?? ""}
              onChange={(e) =>
                setForm({ ...form, preco: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </Field>

          {isKg && (
            <Field label="Rendimento (m/kg)">
              <Input
                type="number"
                step="0.01"
                value={form.rendimento ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    rendimento: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </Field>
          )}

          <Field label="Preço por Metro">
            <Input
              readOnly
              value={
                precoMetro != null
                  ? new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(Number(precoMetro))
                  : "—"
              }
              className="bg-muted/50"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Histórico de Preços
          </CardTitle>
          <CardDescription>Registros automáticos a cada alteração de preço.</CardDescription>
        </CardHeader>
        <CardContent>
          {historico.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nenhuma alteração registrada.</p>
          ) : (
            <ul className="space-y-2">
              {[...historico].reverse().map((h, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-md border bg-card p-2 text-sm"
                >
                  <span>
                    {new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(Number(h.preco))}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {h.data ? new Date(h.data).toLocaleString("pt-BR") : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <VariantesSection artigoId={artigoId} />
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ============= Variants =============

function VariantesSection({ artigoId }: { artigoId: string }) {
  const qc = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<Variante | null>(null);

  const { data: cores = [] } = useQuery({
    queryKey: ["cores-options"],
    queryFn: async () => {
      const { data } = await supabase.from("cores").select("id,nome").order("nome");
      return (data ?? []) as Cor[];
    },
  });

  const { data: variantes = [] } = useQuery({
    queryKey: ["variantes", artigoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("*")
        .eq("artigo_id", artigoId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Variante[];
    },
  });

  const coresMap = useMemo(() => new Map(cores.map((c) => [c.id, c.nome])), [cores]);
  const selectedCorIds = useMemo(
    () => new Set(variantes.map((v) => v.cor_id).filter(Boolean) as string[]),
    [variantes],
  );

  const addCorMut = useMutation({
    mutationFn: async (corId: string) => {
      const { data: art } = await supabase
        .from("artigos")
        .select("nome")
        .eq("id", artigoId)
        .single();
      const corNome = coresMap.get(corId) ?? "";
      const nomeVariante = `${art?.nome ?? ""} - ${corNome}`.trim();
      const { error } = await supabase
        .from("variantes_tecido")
        .insert({ artigo_id: artigoId, cor_id: corId, nome_variante: nomeVariante });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao adicionar."),
  });

  const removeVarMut = useMutation({
    mutationFn: async (v: Variante) => {
      if (v.foto_url) {
        await supabase.storage.from(VARIANT_BUCKET).remove([v.foto_url]);
      }
      const { error } = await supabase.from("variantes_tecido").delete().eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["variantes", artigoId] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao remover."),
  });

  const toggleCor = (corId: string, checked: boolean) => {
    if (checked) {
      addCorMut.mutate(corId);
    } else {
      const existing = variantes.find((v) => v.cor_id === corId);
      if (existing) setRemoveTarget(existing);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cores e Variantes</CardTitle>
        <CardDescription>
          Marque cores para criar variantes automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              Selecionar cores{" "}
              <Badge variant="secondary" className="ml-2">
                {selectedCorIds.size}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 max-h-72 overflow-auto" align="start">
            <ul className="space-y-1">
              {cores.length === 0 && (
                <li className="text-sm text-muted-foreground italic px-2 py-1">
                  Cadastre cores em Atributos primeiro.
                </li>
              )}
              {cores.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent cursor-pointer"
                  onClick={() => toggleCor(c.id, !selectedCorIds.has(c.id))}
                >
                  <Checkbox
                    checked={selectedCorIds.has(c.id)}
                    onCheckedChange={(v) => toggleCor(c.id, !!v)}
                  />
                  <span className="text-sm">{c.nome}</span>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        {variantes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhuma variante criada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {variantes.map((v) => (
              <VariantRow
                key={v.id}
                variante={v}
                corLabel={v.cor_id ? coresMap.get(v.cor_id) ?? "—" : "—"}
                onRemove={() => setRemoveTarget(v)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Isso irá excluir a variante. Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              A cor{" "}
              <strong>
                {removeTarget?.cor_id ? coresMap.get(removeTarget.cor_id) ?? "—" : "—"}
              </strong>{" "}
              será removida do tecido. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) removeVarMut.mutate(removeTarget);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function VariantRow({
  variante,
  corLabel,
  onRemove,
}: {
  variante: Variante;
  corLabel: string;
  onRemove: () => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [nome, setNome] = useState(variante.nome_variante ?? "");
  const [codigo, setCodigo] = useState(variante.codigo_variante ?? "");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const photoUrl = useSignedUrl(variante.foto_url);

  const saveMut = useMutation({
    mutationFn: async (patch: Partial<Variante>) => {
      const { error } = await supabase.from("variantes_tecido").update(patch).eq("id", variante.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variantes", variante.artigo_id] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${tenant}/${variante.artigo_id}/${variante.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(VARIANT_BUCKET)
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      if (variante.foto_url && variante.foto_url !== path) {
        await supabase.storage.from(VARIANT_BUCKET).remove([variante.foto_url]);
      }
      saveMut.mutate({ foto_url: path });
      toast.success("Foto atualizada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar foto.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <li className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center gap-3 p-2">
        <div className="h-12 w-12 rounded bg-muted overflow-hidden flex items-center justify-center shrink-0">
          {photoUrl ? (
            <img src={photoUrl} alt={corLabel} className="w-full h-full object-cover" />
          ) : (
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{corLabel}</p>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {variante.codigo_variante || variante.nome_variante || "Sem código"}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
      {expanded && (
        <div className="grid gap-3 p-3 border-t md:grid-cols-3 bg-muted/30">
          <div className="space-y-1.5">
            <Label>Nome da variante</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={() =>
                nome !== (variante.nome_variante ?? "") && saveMut.mutate({ nome_variante: nome })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Código</Label>
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onBlur={() =>
                codigo !== (variante.codigo_variante ?? "") &&
                saveMut.mutate({ codigo_variante: codigo })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Foto</Label>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {photoUrl ? "Trocar foto" : "Enviar foto"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
