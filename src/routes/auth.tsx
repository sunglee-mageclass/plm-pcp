import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, AlertTriangle, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/hooks/useAuth";
import { useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { friendlyAuthError } from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TecelagemAnimacao } from "@/components/home/TecelagemAnimacao";
import { cn } from "@/lib/utils";

// Destino pós-login preservado (?redirect=/pcp/...) — só paths INTERNOS (começa com "/"
// e não "//", que seria URL externa protocol-relative). Laudo do time, jul/2026.
const redirectSeguro = (v: unknown): string | undefined =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/auth")
    ? v : undefined;

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: redirectSeguro(s.redirect),
  }),
  component: AuthPage,
  head: () => ({
    meta: [
      // Título NEUTRO: a identidade (nome do sistema) é configurável por instalação —
      // um nome fixo no título contradiz a marca exibida na página (ex.: WISH360).
      { title: "Entrar" },
      { name: "description", content: "Acesse sua conta para gerenciar criação, produção, estoque e financeiro da sua confecção." },
      { property: "og:title", content: "Entrar" },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex, follow" },
    ],
    links: [
      { rel: "canonical", href: "https://sistrama.sung-lee.workers.dev/auth" },
    ],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { user, loading } = useAuth();
  const identity = useApplySystemIdentity();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const destino = redirect ?? "/home";

  if (!loading && user) {
    return <Navigate to={destino} replace />;
  }

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Erro INLINE no locus de atenção (o toast ficava no canto oposto e sumia — laudo).
      setBusy(false);
      if (import.meta.env.DEV) console.error(error);
      setErro(friendlyAuthError(error.message));
      return;
    }
    // Sucesso: mantém busy até a navegação (senão o botão reabilita por um instante).
    navigate({ to: destino });
  };

  // Estilo dos inputs do login: preenchido (bg-muted) + borda mais escura — a borda-token
  // padrão dava 1,23:1 sobre o card (laudo UI, WCAG 1.4.11).
  const inputCls = "bg-muted border-[color:var(--auth-input-border)]";

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      {/* Painel de identidade NAVY (Navy Trust v2): gradiente sidebar→primary com a trama em
          FIOS CLAROS por cima (a sonda do canvas lê --color-foreground/--color-primary do pai —
          mesma técnica do hero do Início). No mobile vira o cabeçalho compacto. */}
      <div
        className="relative flex shrink-0 flex-col justify-between overflow-hidden p-6 text-sidebar-foreground md:w-[44%] md:p-9"
        style={{
          background:
            "linear-gradient(160deg, var(--sidebar) 0%, color-mix(in oklab, var(--sidebar) 45%, var(--primary)) 55%, color-mix(in oklab, var(--sidebar) 15%, var(--primary)) 100%)",
          ["--color-foreground" as string]: "var(--sidebar-foreground)",
          ["--color-primary" as string]: "color-mix(in oklab, var(--sidebar-foreground) 70%, var(--primary))",
        } as React.CSSProperties}
      >
        <TecelagemAnimacao className="absolute inset-0 h-full w-full" opacity={0.14} />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(110% 130% at 20% 10%, transparent 35%, color-mix(in oklab, var(--sidebar) 65%, transparent))" }}
        />
        <div className="relative z-10 flex items-center gap-3 md:block">
          <div className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[14px] font-display text-base font-bold md:h-13 md:w-13",
            identity.logoSignedUrl ? "border bg-background p-1" : "border border-white/25 bg-white/15 text-white",
          )}>
            {identity.logoSignedUrl ? (
              <img src={identity.logoSignedUrl} alt={identity.nome_sistema} className="h-full w-full object-contain" />
            ) : (
              (identity.nome_sistema || "SI").slice(0, 2).toUpperCase()
            )}
          </div>
          <div className="md:mt-4">
            <h1 className="font-display text-xl font-bold text-white md:text-2xl">{identity.nome_sistema}</h1>
            {identity.subtitulo && <p className="text-xs opacity-75 md:text-sm">{identity.subtitulo}</p>}
          </div>
        </div>
        <p className="relative z-10 mt-3 hidden max-w-[36ch] text-[13px] leading-relaxed opacity-70 md:block">
          Criação, produção, estoque e financeiro da sua confecção — do fio à peça lançada.
        </p>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 py-6 md:items-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesse sua conta</CardTitle>
            <CardDescription>Entre para continuar. O acesso é criado por convite.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <Input
                  id="login-email" name="email" type="email" required autoFocus autoComplete="email"
                  aria-invalid={!!erro}
                  className={inputCls}
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Senha</Label>
                <div className="relative">
                  <Input
                    id="login-password" name="password" type={verSenha ? "text" : "password"} required
                    autoComplete="current-password"
                    aria-invalid={!!erro}
                    className={cn(inputCls, "pr-10")}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {erro && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><b className="font-semibold">{erro}</b> Confira e tente de novo — a senha diferencia maiúsculas.</span>
                </div>
              )}
              <Button type="submit" className="w-full disabled:opacity-90" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {busy ? "Entrando…" : "Entrar"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Esqueceu a senha ou precisa de acesso?{" "}
                <b className="font-semibold text-foreground">Fale com o administrador da sua loja.</b>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
