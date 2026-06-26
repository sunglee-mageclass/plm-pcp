import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { friendlyAuthError } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Entrar — sisTrama" },
      { name: "description", content: "Acesse sua conta no sisTrama para gerenciar criação, produção, estoque e financeiro da sua confecção." },
      { property: "og:title", content: "Entrar — sisTrama" },
      { property: "og:description", content: "Acesse o painel sisTrama da sua loja." },
      { property: "og:url", content: "https://sistrama.lovable.app/auth" },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [
      { rel: "canonical", href: "https://sistrama.lovable.app/auth" },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const identity = useApplySystemIdentity();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      if (import.meta.env.DEV) console.error(error);
      toast.error(friendlyAuthError(error.message));
      return;
    }
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/dashboard" });
  };

  const handleGoogle = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setBusy(false);
      toast.error("Não foi possível entrar com Google.");
      return;
    }
    // Browser redireciona para o Google; ao voltar, onAuthStateChange leva ao dashboard.
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold overflow-hidden">
            {identity.logoSignedUrl ? (
              <img src={identity.logoSignedUrl} alt={identity.nome_sistema} className="h-full w-full object-contain" />
            ) : (
              (identity.nome_sistema || "SI").slice(0, 2).toUpperCase()
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{identity.nome_sistema}</h1>
          {identity.subtitulo && (
            <p className="text-sm text-muted-foreground mt-1">{identity.subtitulo}</p>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Acesse sua conta</CardTitle>
            <CardDescription>Entre para continuar. O acesso é criado por convite.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <Input
                  id="login-email" type="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Senha</Label>
                <Input
                  id="login-password" type="password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Entrando…" : "Entrar"}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">ou</span>
              </div>
            </div>

            <Button
              type="button" variant="outline" className="w-full"
              onClick={handleGoogle} disabled={busy}
            >
              Continuar com Google
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
