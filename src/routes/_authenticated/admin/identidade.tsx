import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shield, Upload, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useSystemIdentity } from "@/hooks/useSystemIdentity";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!identity.isLoading) {
      setNome(identity.nome_sistema);
      setSubtitulo(identity.subtitulo);
      setLogoPath(identity.logo_url);
      setFaviconPath(identity.favicon_url);
      setLogoPreview(identity.logoSignedUrl);
      setFaviconPreview(identity.faviconSignedUrl);
    }
  }, [identity.isLoading, identity.nome_sistema, identity.subtitulo, identity.logo_url, identity.favicon_url, identity.logoSignedUrl, identity.faviconSignedUrl]);

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" replace />;

  async function uploadFile(file: File, kind: "logo" | "favicon") {
    const ext = file.name.split(".").pop() ?? "png";
    const path = `${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("system-identity")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data: signed } = await supabase.storage
      .from("system-identity")
      .createSignedUrl(path, 60 * 60);
    return { path, signedUrl: signed?.signedUrl ?? null };
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
      toast.error("Falha ao enviar logo: " + (err as Error).message);
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
      toast.error("Falha ao enviar favicon: " + (err as Error).message);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("system_settings")
        .update({
          nome_sistema: nome.trim() || "sisTrama",
          subtitulo: subtitulo.trim(),
          logo_url: logoPath,
          favicon_url: faviconPath,
        })
        .eq("singleton", true);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["system_identity"] });
      toast.success("Identidade atualizada.");
    } catch (err) {
      toast.error("Falha ao salvar: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-3xl">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Shield className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Identidade do Sistema</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Personalize nome, subtítulo, logo e favicon exibidos em todo o sistema.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Textos</CardTitle>
          <CardDescription>Aparecem na sidebar, na tela de login e na aba do navegador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome do Sistema</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="PLM+PCP" />
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
          <div className="flex items-center gap-4">
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
              <Button type="button" variant="ghost" onClick={() => { setLogoPath(null); setLogoPreview(null); }}>
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
          <div className="flex items-center gap-4">
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
              <Button type="button" variant="ghost" onClick={() => { setFaviconPath(null); setFaviconPreview(null); }}>
                Remover
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
