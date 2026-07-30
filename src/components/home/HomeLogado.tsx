import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, addDays } from "date-fns";
import {
  AlertTriangle, Wallet, Clock, CalendarX,
  BarChart3, ClipboardList, Package, Palette, Factory, DollarSign, Target, Truck,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { Card } from "@/components/ui/card";
import { TecelagemAnimacao } from "./TecelagemAnimacao";

const fmtMoney = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Atalhos dos módulos (ordem amigável p/ landing). Filtrados pelos módulos da loja.
const MODULOS: { key: string; label: string; path: string; icon: typeof BarChart3 }[] = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: BarChart3 },
  { key: "cadastro", label: "Cadastro", path: "/cadastro", icon: ClipboardList },
  { key: "entrada_saida", label: "Entrada e Saída", path: "/entrada-saida", icon: Package },
  { key: "otb", label: "OTB", path: "/otb", icon: Target },
  { key: "criacao", label: "Estilo & Engenharia", path: "/criacao", icon: Palette },
  // PCP e Expedição são 2 níveis mas compartilham a MESMA flag de contratação (producao).
  { key: "producao", label: "PCP", path: "/pcp", icon: Factory },
  { key: "producao", label: "Expedição & Logística", path: "/expedicao", icon: Truck },
  { key: "financeiro", label: "Financeiro", path: "/financeiro", icon: DollarSign },
];

/**
 * Home logado (/home): centro de boas-vindas + "precisa da sua atenção" + atalhos.
 * Mostra só o que a loja tem (módulos) e usa a marca da loja. A tecelagem entra como
 * assinatura sutil no cabeçalho (não tela cheia — é tela de trabalho).
 */
export function HomeLogado() {
  const { user } = useAuth();
  const { modules } = useTenantModules();
  const branding = useTenantBranding();
  const tz = useStoreTimezone();

  const hoje = format(new Date(), "yyyy-MM-dd");
  const em7 = format(addDays(new Date(), 7), "yyyy-MM-dd");
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()),
  );
  const saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  // Só usa o nome real (full_name); sem ele, saúda sem nome (não usa o prefixo do e-mail).
  const nome = (((user?.user_metadata as any)?.full_name as string) || "").trim().split(" ")[0];
  // "quinta-feira, 30 de julho" — no fuso da loja (mesma fonte do `hora`).
  const dataLonga = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long", timeZone: tz,
  }).format(new Date());

  // ── Contadores de atenção (cada um aterrado numa query real, gated por módulo) ──
  const cq = useQuery({
    queryKey: ["home", "cq-pendentes"],
    enabled: !!modules.entrada_saida,
    queryFn: async () => {
      const { count } = await supabase
        .from("ocs_tecido_itens")
        .select("*", { count: "exact", head: true })
        .in("cq_alerta_status", ["alertado", "troca_pendente"]);
      return count ?? 0;
    },
  });

  const ocAtrasada = useQuery({
    queryKey: ["home", "oc-atrasada", hoje],
    enabled: !!modules.entrada_saida,
    queryFn: async () => {
      const { count } = await supabase
        .from("ocs_tecido")
        .select("*", { count: "exact", head: true })
        .eq("status", "encomendado")
        .eq("is_rolo" as never, false as never)
        .lt("data_prevista_entrega", hoje);
      return count ?? 0;
    },
  });

  // A pagar nos PRÓXIMOS 7 dias (sem incluir as já vencidas — essas têm card próprio).
  const pagar = useQuery({
    queryKey: ["home", "pagar7", hoje, em7],
    enabled: !!modules.financeiro,
    queryFn: async () => {
      const { data } = await supabase
        .from("parcelas")
        .select("valor")
        .is("data_pagamento", null)
        .gte("data_vencimento", hoje)
        .lte("data_vencimento", em7);
      const rows = (data ?? []) as { valor: number | null }[];
      return { n: rows.length, total: rows.reduce((s, r) => s + Number(r.valor ?? 0), 0) };
    },
  });

  // Contas a pagar ATRASADAS (vencidas e não pagas).
  const atrasadas = useQuery({
    queryKey: ["home", "atrasadas", hoje],
    enabled: !!modules.financeiro,
    queryFn: async () => {
      const { data } = await supabase
        .from("parcelas")
        .select("valor")
        .is("data_pagamento", null)
        .lt("data_vencimento", hoje);
      const rows = (data ?? []) as { valor: number | null }[];
      return { n: rows.length, total: rows.reduce((s, r) => s + Number(r.valor ?? 0), 0) };
    },
  });

  // Serviços (terceirizados) também são contas a pagar — entram nos MESMOS cards
  // ("Contas atrasadas" e "A pagar 7 dias"). Antes só as parcelas de OC eram contadas.
  const servicos = useQuery({
    queryKey: ["home", "servicos-fin", hoje, em7],
    enabled: !!modules.financeiro,
    queryFn: async () => {
      const { data } = await supabase.rpc("servicos_financeiro" as any);
      const abertos = ((data ?? []) as any[]).filter(
        (r) => !r.data_pagamento && r.status !== "pago" && r.data_vencimento,
      );
      const venc = (r: any) => String(r.data_vencimento).slice(0, 10);
      const soma = (arr: any[]) => arr.reduce((s, r) => s + Number(r.valor_parcela ?? 0), 0);
      const atrasado = abertos.filter((r) => venc(r) < hoje);
      const prox7 = abertos.filter((r) => venc(r) >= hoje && venc(r) <= em7);
      return {
        atrasadasN: atrasado.length, atrasadasTotal: soma(atrasado),
        pagar7N: prox7.length, pagar7Total: soma(prox7),
      };
    },
  });

  // Parcelas de OC + parcelas de serviço somadas (count e valor) p/ os cards financeiros.
  const atrasadasN = (atrasadas.data?.n ?? 0) + (servicos.data?.atrasadasN ?? 0);
  const atrasadasTotal = (atrasadas.data?.total ?? 0) + (servicos.data?.atrasadasTotal ?? 0);
  const pagar7N = (pagar.data?.n ?? 0) + (servicos.data?.pagar7N ?? 0);
  const pagar7Total = (pagar.data?.total ?? 0) + (servicos.data?.pagar7Total ?? 0);

  // Ordem por urgência: vermelhos (crítico) antes dos âmbar (atenção) — varredura mais rápida.
  const atencao = [
    modules.financeiro && {
      key: "atrasadas", to: "/financeiro", icon: CalendarX, tone: "red" as const,
      valor: atrasadasN, label: "Contas atrasadas",
      sub: (atrasadas.data || servicos.data) ? fmtMoney(atrasadasTotal) : "—",
      loading: atrasadas.isLoading || servicos.isLoading,
    },
    modules.entrada_saida && {
      key: "oc", to: "/entrada-saida/oc-tecido", icon: Clock, tone: "red" as const,
      valor: ocAtrasada.data ?? 0, label: "OCs atrasadas", sub: "em aberto",
      loading: ocAtrasada.isLoading,
    },
    modules.financeiro && {
      key: "pagar", to: "/financeiro", icon: Wallet, tone: "amber" as const,
      valor: pagar7N, label: "A pagar em 7 dias",
      sub: (pagar.data || servicos.data) ? fmtMoney(pagar7Total) : "—",
      loading: pagar.isLoading || servicos.isLoading,
    },
    modules.entrada_saida && {
      key: "cq", to: "/entrada-saida/alertas-tecido", icon: AlertTriangle, tone: "amber" as const,
      valor: cq.data ?? 0, label: "Alertas de CQ (tecido)", sub: "pendentes",
      loading: cq.isLoading,
    },
  ].filter(Boolean) as { key: string; to: string; icon: typeof BarChart3; tone: "red" | "amber"; valor: number; label: string; sub: string; loading: boolean }[];

  const atalhos = MODULOS.filter((m) => (modules as Record<string, boolean>)[m.key]);

  return (
    <div className="container mx-auto space-y-6 p-3 sm:p-6 max-sm:pb-24">
      {/* Cabeçalho Navy (A0): gradiente sidebar→primary com a trama por cima, texto claro.
          Tokens locais --color-foreground/--color-primary sobrescritos p/ a TecelagemAnimacao
          sondar FIOS CLAROS (ela lê text-foreground/text-primary computados no pai). */}
      <header
        className="relative overflow-hidden rounded-2xl border text-sidebar-foreground"
        style={{
          background:
            "linear-gradient(115deg, var(--sidebar) 0%, color-mix(in oklab, var(--sidebar) 45%, var(--primary)) 55%, color-mix(in oklab, var(--sidebar) 15%, var(--primary)) 100%)",
          borderColor: "var(--sidebar-accent)",
          ["--color-foreground" as string]: "var(--sidebar-foreground)",
          ["--color-primary" as string]: "color-mix(in oklab, var(--sidebar-foreground) 70%, var(--primary))",
        } as React.CSSProperties}
      >
        <TecelagemAnimacao className="absolute inset-0 h-full w-full" opacity={0.16} />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(90% 130% at 18% 0%, transparent 30%, color-mix(in oklab, var(--sidebar) 72%, transparent))" }}
        />
        <div className="relative z-10 flex items-center gap-4 p-5 sm:p-7">
          {/* Logo da loja: com logo enviada, caixa clara neutra; fallback = iniciais em vidro claro. */}
          <div className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl shadow",
            branding.logoUrl ? "border bg-background p-1" : "border border-white/25 bg-white/15",
          )}>
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.nome ?? "Loja"} className="h-full w-full object-contain" />
            ) : (
              <span className="font-display text-xl font-bold">{(branding.nome ?? "SI").slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            {branding.nome && (
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{branding.nome}</p>
            )}
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {saud}{nome ? `, ${nome}` : ""} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-0.5 text-xs opacity-75">{dataLonga}</p>
          </div>
        </div>
      </header>

      {/* Precisa da sua atenção (A0): chip tintado à esquerda no desktop, número em
          Outfit tabular, hover de elevação. Empilha (chip em cima) no mobile. */}
      {atencao.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[13px] font-semibold text-foreground">Precisa da sua atenção</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {atencao.map((a) => (
              <Link key={a.key} to={a.to as any} className="block h-full">
                <Card className={cn(
                  "flex h-full min-h-[110px] flex-col gap-3 p-4 transition-all hover:-translate-y-px hover:shadow-md sm:flex-row sm:items-start",
                  a.valor > 0 && (a.tone === "red" ? "border-red-500/50" : "border-amber-500/50"),
                )}>
                  <div className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-[10px]",
                    a.valor > 0
                      ? (a.tone === "red" ? "bg-red-500/15 text-red-600" : "bg-amber-500/15 text-amber-600")
                      : "bg-muted text-muted-foreground",
                  )}>
                    <a.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    {a.loading ? (
                      <div className="h-6 w-12 animate-pulse rounded bg-muted" aria-hidden />
                    ) : (
                      <div className="font-display text-2xl font-semibold leading-none tabular-nums">{a.valor}</div>
                    )}
                    <div className="mt-1.5 text-[13px] font-medium leading-snug">{a.label}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{a.sub}</div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Atalhos dos módulos (A0): tile alinhado à esquerda, ícone primary, hover de elevação. */}
      <section className="space-y-2">
        <h2 className="font-display text-[13px] font-semibold text-foreground">Atalhos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {/* key = path (único): PCP e Expedição compartilham a key de módulo "producao" —
              key duplicada fazia o React duplicar o tile de PCP. */}
          {atalhos.map((m) => (
            <Link key={m.path} to={m.path as any} className="block">
              <Card className="flex min-h-[44px] flex-col items-start gap-2 p-4 transition-all hover:-translate-y-px hover:shadow-md">
                <m.icon className="h-5 w-5 text-primary" />
                <span className="text-[13px] font-semibold">{m.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
