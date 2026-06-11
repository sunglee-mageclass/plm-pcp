import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/lojas")({
  component: LojasPage,
});

type Tenant = {
  id: string;
  nome: string;
  cnpj: string | null;
  logo_url: string | null;
  contato: string | null;
  ativo: boolean;
};

function LojasPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id,nome,cnpj,logo_url,contato,ativo")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tenant[];
    },
    enabled: isSuperAdmin,
  });

  const filtered = useMemo(
    () => tenants.filter((t) => t.nome.toLowerCase().includes(search.toLowerCase())),
    [tenants, search],
  );

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("tenants").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      toast.success("Loja atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Gerenciar Lojas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastre e administre todas as lojas (tenants) do sistema.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Nova Loja
            </Button>
          </DialogTrigger>
          <NovaLojaModal onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Pesquisar por nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Logo</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ativar/Desativar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhuma loja encontrada.</TableCell></TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.logo_url ? (
                      <img src={t.logo_url} alt={t.nome} className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <div className="h-8 w-8 rounded bg-muted" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{t.nome}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.cnpj ?? "—"}</TableCell>
                  <TableCell>
                    {t.ativo ? (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600">Ativa</Badge>
                    ) : (
                      <Badge variant="destructive">Inativa</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={t.ativo}
                      onCheckedChange={(checked) => toggleAtivo.mutate({ id: t.id, ativo: checked })}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function NovaLojaModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [contato, setContato] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    setSubmitting(true);
    try {
      let logo_url: string | null = null;
      if (logoFile) {
        const path = `${crypto.randomUUID()}-${logoFile.name}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-logos")
          .upload(path, logoFile, { upsert: false });
        if (upErr) throw upErr;
        const { data: signed } = await supabase.storage
          .from("tenant-logos")
          .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
        logo_url = signed?.signedUrl ?? null;
      }
      const { error } = await supabase
        .from("tenants")
        .insert({ nome: nome.trim(), cnpj: cnpj || null, contato: contato || null, logo_url, ativo: true });
      if (error) throw error;
      toast.success("Loja criada");
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Nova Loja</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} maxLength={18} />
          </div>
          <div>
            <Label htmlFor="contato">Contato</Label>
            <Input id="contato" value={contato} onChange={(e) => setContato(e.target.value)} maxLength={500} />
          </div>
          <div>
            <Label htmlFor="logo">Logo</Label>
            <div className="flex items-center gap-2">
              <Input
                id="logo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
