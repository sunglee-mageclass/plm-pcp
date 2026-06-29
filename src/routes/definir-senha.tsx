import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TecelagemAnimacao } from "@/components/home/TecelagemAnimacao";

/**
 * Página onde o usuário CONVIDADO define a própria senha. O link do convite (Supabase)
 * redireciona pra cá com o token no hash; o client (detectSessionInUrl) estabelece a
 * sessão, e aqui chamamos auth.updateUser({ password }). Também serve p/ recuperação de senha.
 */
export const Route = createFileRoute("/definir-senha")({
  component: DefinirSenhaPage,
  head: () => ({
    meta: [
      { title: "Definir senha — sisTrama" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<"validando" | "ok" | "sem-sessao">("validando");
  const [senha, setSenha] = useState("");
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // O hash do link é processado pelo client de forma assíncrona — esperamos a sessão
    // aparecer (evento) ou checamos após um tempo. Sem sessão = link inválido/expirado.
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        setEstado(ok ? "ok" : "sem-sessao");
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) finish(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) finish(true);
    });
    const t = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => finish(!!session));
    }, 2500);
    return () => {
      subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error("A senha deve ter ao menos 6 caracteres.");
      return;
    }
    if (senha !== conf) {
      toast.error("As senhas não conferem.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setBusy(false);
    if (error) {
      toast.error(mensagemErro(error, "Erro ao definir a senha."));
      return;
    }
    toast.success("Senha definida! Bem-vindo.");
    navigate({ to: "/home" });
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background px-4">
      <TecelagemAnimacao className="absolute inset-0 h-full w-full" opacity={0.5} />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--background) 0%, color-mix(in oklab, var(--background) 70%, transparent) 55%, color-mix(in oklab, var(--background) 40%, transparent) 100%)",
        }}
      />
      <div className="relative z-10 w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Definir senha</CardTitle>
            <CardDescription>Crie sua senha para acessar o sisTrama.</CardDescription>
          </CardHeader>
          <CardContent>
            {estado === "validando" && (
              <p className="text-sm text-muted-foreground">Validando o convite…</p>
            )}
            {estado === "sem-sessao" && (
              <p className="text-sm text-destructive">
                Link inválido ou expirado. Peça um novo convite ao administrador da sua loja.
              </p>
            )}
            {estado === "ok" && (
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="nova">Nova senha</Label>
                  <Input id="nova" type="password" autoComplete="new-password" required minLength={6}
                    value={senha} onChange={(e) => setSenha(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conf">Confirmar senha</Label>
                  <Input id="conf" type="password" autoComplete="new-password" required minLength={6}
                    value={conf} onChange={(e) => setConf(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar e entrar"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
