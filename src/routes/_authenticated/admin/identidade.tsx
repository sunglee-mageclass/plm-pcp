import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Palette, Upload, Loader2, ArrowLeft } from "lucide-react";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";

export const Route = createFileRoute("/_authenticated/admin/identidade")({
  component: IdentidadePage,
});

function IdentidadePage() {
  const { isSuperAdmin, loading } = useAuth();
  const identity = useSystemIdentity();
  const qc = useQueryClient();

  const [nome, setNome] = useState("");
  const [subtitulo, setSubtitulo] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [faviconPreview, setFaviconPreview] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [faviconPath, setFaviconPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  // Arquivos enviados nesta sessão (p/ apagar os que não forem persistidos → sem órfãos).
  const sessionUploads = useRef<string[]>([]);

  // Guarda de "não salvo": snapshot dos campos PERSISTIDOS (nome/subtítulo + paths de
  // logo/favicon). Previews são só derivados (URLs de exibição), não entram no baseline.
  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot({
    nome, subtitulo, logoPath, faviconPath,
  });
  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });

  // Limites de arquivo (o bucket não impõe; branding não precisa ser grande).
  const MAX = { logo: 1_048_576, favicon: 262_144 } as const; // 1 MB / 256 KB

  useEffect(() => {
    if (!identity.isLoading) {
      setNome(identity.nome_sistema);
      setSubtitulo(identity.subtitulo);
      setLogoPath(identity.logo_url);
      setFaviconPath(identity.favicon_url);
      setLogoPreview(identity.logoSignedUrl);
      setFaviconPreview(identity.faviconSignedUrl);
      // Rebaseia a guarda com os dados carregados (senão o form nasceria "sujo").
      resetBaseline({
        nome: identity.nome_sistema,
        subtitulo: identity.subtitulo,
        logoPath: identity.logo_url,
        faviconPath: identity.favicon_url,
      });
    }
  }, [identity.isLoading, identity.nome_sistema, identity.subtitulo, identity.logo_url, identity.favicon_url, identity.logoSignedUrl, identity.faviconSignedUrl]);

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" replace />;

  async function uploadFile(file: File, kind: "logo" | "favicon") {
    if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
    if (file.size > MAX[kind]) throw new Error(`Arquivo grande demais (máx. ${Math.round(MAX[kind] / 1024)} KB).`);
    // ext sanitizado (só alfanumérico) — sem traversal/extensão estranha no path.
    const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
    const path = `${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("system-identity")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    sessionUploads.current.push(path);
    // Bucket público: URL estável (não expira), também serve de preview imediato.
    const publicUrl = supabase.storage.from("system-identity").getPublicUrl(path).data.publicUrl;
    return { path, signedUrl: publicUrl };
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { path, signedUrl } = await uploadFile(file, "logo");
      setLogoPath(path);
      setLogoPreview(signedUrl);
      toast.success("Logo carregada. Clique em Salvar para aplicar.");
    } catch (err) {
      toast.error("Falha ao enviar logo: " + mensagemErro(err, "erro ao enviar o arquivo."));
    }
  }

  async function handleFaviconChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { path, signedUrl } = await uploadFile(file, "favicon");
      setFaviconPath(path);
      setFaviconPreview(signedUrl);
      toast.success("Favicon carregado. Clique em Salvar para aplicar.");
    } catch (err) {
      toast.error("Falha ao enviar favicon: " + mensagemErro(err, "erro ao enviar o arquivo."));
    }
  }

  async function handleSave() {
    setConfirmSave(false);
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .update({
          nome_sistema: nome.trim() || "WISH360",
          subtitulo: subtitulo.trim(),
          logo_url: logoPath,
          favicon_url: faviconPath,
        })
        .eq("singleton", true)
        .select("id");
      if (error) throw error;
      // 0 linhas = RLS bloqueou (sem erro) → não minta "atualizada".
      if (!data?.length) throw new Error("Sem permissão para salvar a identidade.");
      // Apaga órfãos: os paths antigos persistidos e os uploads desta sessão que não
      // viraram os finais (senão o bucket acumula arquivos p/ sempre).
      const keep = new Set([logoPath, faviconPath].filter(Boolean) as string[]);
      const toRemove = [...new Set(
        [identity.logo_url, identity.favicon_url, ...sessionUploads.current]
          .filter((p): p is string => !!p && !keep.has(p)),
      )];
      if (toRemove.length) await supabase.storage.from("system-identity").remove(toRemove);
      sessionUploads.current = [];
      await qc.invalidateQueries({ queryKey: ["system_identity"] });
      markClean();
      toast.success("Identidade atualizada.");
    } catch (err) {
      toast.error("Falha ao salvar: " + mensagemErro(err, "erro ao salvar a identidade."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 pb-24">
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Palette className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Identidade do Sistema</h1>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
            <p className="text-sm text-muted-foreground">
              Nome, subtítulo, logo e favicon exibidos em <strong>todas as lojas</strong> e na tela de login.
            </p>
          </div>
        </div>
      </header>

      {/* Blocos em grade responsiva de 2 colunas no desktop, 1 no mobile. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-start">
      <Card>
        <CardHeader>
          <CardTitle>Textos</CardTitle>
          <CardDescription>Aparecem na sidebar, na tela de login e na aba do navegador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome do Sistema</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="WISH360" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subtitulo">Subtítulo</Label>
            <Input id="subtitulo" value={subtitulo} onChange={(e) => setSubtitulo(e.target.value)} placeholder="Moda & Confecção" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>PNG ou SVG. Recomendado quadrado, fundo transparente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-md border bg-muted/40 overflow-hidden">
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-muted-foreground">Sem logo</span>
              )}
            </div>
            <input ref={logoInputRef} type="file" accept="image/png,image/svg+xml,image/jpeg" hidden onChange={handleLogoChange} />
            <Button type="button" variant="outline" onClick={() => logoInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Selecionar arquivo
            </Button>
            {logoPath && (
              <Button type="button" variant="ghost" onClick={() => { setLogoPath(null); setLogoPreview(null); toast.info("Logo removida. Clique em Salvar para aplicar."); }}>
                Remover
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Favicon</CardTitle>
          <CardDescription>PNG 32×32 px ideal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/40 overflow-hidden">
              {faviconPreview ? (
                <img src={faviconPreview} alt="Favicon" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-[10px] text-muted-foreground">Sem ícone</span>
              )}
            </div>
            <input ref={faviconInputRef} type="file" accept="image/png,image/x-icon,image/svg+xml" hidden onChange={handleFaviconChange} />
            <Button type="button" variant="outline" onClick={() => faviconInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Selecionar arquivo
            </Button>
            {faviconPath && (
              <Button type="button" variant="ghost" onClick={() => { setFaviconPath(null); setFaviconPreview(null); toast.info("Favicon removido. Clique em Salvar para aplicar."); }}>
                Remover
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </div>

      <PageActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Button className="ml-auto" onClick={() => setConfirmSave(true)} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </PageActionBar>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar a identidade do sistema?</AlertDialogTitle>
            <AlertDialogDescription>
              O nome, subtítulo, logo e favicon mudam para <strong>todas as lojas e usuários</strong>,
              inclusive a tela de login. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleSave(); }} disabled={saving}>Salvar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesGuard
        dirty={dirty}
        confirm={confirm}
        message="Há alterações não salvas na identidade do sistema."
      />
    </div>
  );
}
