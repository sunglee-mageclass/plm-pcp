import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, addDays, parseISO } from "date-fns";
import {
  AlertTriangle, Wallet, Clock, CalendarX, Rocket, CheckCircle2,
  BarChart3, ClipboardList, Package, Palette, Factory, DollarSign, Target, Truck,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarBadges } from "@/hooks/useSidebarBadges";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { todayISOInStoreTZ } from "@/lib/timezone";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { Card } from "@/components/ui/card";
import { TecelagemAnimacao } from "./TecelagemAnimacao";

// Atalhos de MÓDULO — só no MOBILE (sidebar recolhida = navegação primária). No desktop os
// tiles de módulo duplicavam 1:1 a sidebar visível ao lado (laudo do time, jul/2026).
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

// Atalhos de PÁGINA (caminho quente) — DESKTOP. Gate: módulo da loja + permissão da página
// (mesma regra da sidebar). `key: null` = só gate de módulo (dashboard tem permissão por aba).
const PAGINAS: { key: string | null; mod: string; label: string; path: string; search?: Record<string, string>; icon: typeof BarChart3 }[] = [
  { key: "criacao_planejamento", mod: "criacao", label: "Plan. Produto", path: "/criacao/planejamento", icon: Palette },
  { key: "criacao_desenvolvimento", mod: "criacao", label: "Desenvolvimento", path: "/criacao/desenvolvimento", icon: ClipboardList },
  { key: "entrada_oc_tecido", mod: "entrada_saida", label: "OC Tecido", path: "/entrada-saida/oc-tecido", icon: Package },
  { key: "producao_terceirizados", mod: "producao", label: "Serviços", path: "/pcp", icon: Factory },
  { key: "producao_cq", mod: "producao", label: "Controle de Qualidade", path: "/expedicao/cq", icon: CheckCircle2 },
  { key: "producao_lancamentos", mod: "producao", label: "Lançamentos", path: "/expedicao/lancamentos", icon: Rocket },
  { key: "financeiro_parcelas", mod: "financeiro", label: "Financeiro · vencidas", path: "/financeiro", search: { tab: "lista", status: "vencido" }, icon: DollarSign },
  { key: null, mod: "dashboard", label: "Dashboard", path: "/dashboard", icon: BarChart3 },
];

type Tone = "red" | "amber" | "blue";
type CardAtencao = {
  key: string; to: string; search?: Record<string, string>; icon: typeof BarChart3; tone: Tone;
  valor: number; label: string; sub?: string; loading: boolean; error: boolean;
};

/**
 * Home logado (/home): boas-vindas + "precisa da sua atenção" + fila de produção + atalhos.
 * Laudo do time de lentes (jul/2026): contagem CANÔNICA via sidebar_badges (OCs = tecido +
 * aviamento + insumo), clique pousa no estado da promessa (abas endereçáveis), gate por
 * PERMISSÃO (não só módulo), datas no fuso da LOJA e erro de query nunca vira "0".
 */
export function HomeLogado() {
  const { user, canView, isAdmin, isSuperAdmin, isTenantAdmin } = useAuth();
  const { modules } = useTenantModules();
  const branding = useTenantBranding();
  const tz = useStoreTimezone();
  // Mesma regra de visibilidade da sidebar (admins furam; senão canView da página).
  const podeVer = (k: string) => isAdmin || isSuperAdmin || isTenantAdmin || canView(k);

  // Datas no FUSO DA LOJA (padrão do sistema — financeiro.tsx e sidebar_badges fazem igual);
  // no fuso do device os números da Home divergiam dos destinos perto da virada do dia.
  const hoje = todayISOInStoreTZ(tz);
  const em7 = format(addDays(parseISO(hoje), 7), "yyyy-MM-dd");
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

  // ── Contadores canônicos (mesma RPC/fonte das bolinhas da sidebar) ──
  const badges = useSidebarBadges();
  const b = (k: string) => Number(badges.data?.[k] ?? 0);
  const ocTec = b("oc_tecido_atrasada");
  const ocAvi = b("oc_aviamento_atrasada");
  const ocIns = b("oc_etiqueta_atrasada");
  const errCq = b("erro_cq");
  const errDir = b("erro_direcionamento");
  const errTer = b("erro_terceirizados");

  // Permissão de ver os cards financeiros = mesma das páginas de destino.
  const podeVerFin = modules.financeiro && (podeVer("financeiro_parcelas") || podeVer("financeiro_calendario"));

  // A pagar nos PRÓXIMOS 7 dias (sem incluir as já vencidas — essas têm card próprio).
  const pagar = useQuery({
    queryKey: ["home", "pagar7", hoje, em7],
    enabled: !!podeVerFin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcelas")
        .select("valor")
        .is("data_pagamento", null)
        .gte("data_vencimento", hoje)
        .lte("data_vencimento", em7);
      if (error) throw error;
      const rows = (data ?? []) as { valor: number | null }[];
      return { n: rows.length, total: rows.reduce((s, r) => s + Number(r.valor ?? 0), 0) };
    },
  });

  // Contas a pagar ATRASADAS (vencidas e não pagas).
  const atrasadas = useQuery({
    queryKey: ["home", "atrasadas", hoje],
    enabled: !!podeVerFin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcelas")
        .select("valor")
        .is("data_pagamento", null)
        .lt("data_vencimento", hoje);
      if (error) throw error;
      const rows = (data ?? []) as { valor: number | null }[];
      return { n: rows.length, total: rows.reduce((s, r) => s + Number(r.valor ?? 0), 0) };
    },
  });

  // Serviços (terceirizados) também são contas a pagar — entram nos MESMOS cards.
  const servicos = useQuery({
    queryKey: ["home", "servicos-fin", hoje, em7],
    enabled: !!podeVerFin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("servicos_financeiro" as any);
      if (error) throw error;
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

  // Mão de obra a aprovar: modelos com ≥1 linha de MO PENDENTE (modelo_servico_mo.aprovado IS NULL).
  // O flag modelos.custo_terceirizados_aprovado virou BOOLEAN DERIVADO (nunca NULL) — contar `.is(null)`
  // dava sempre 0. A pendência mora nas linhas; a tabela é RLS zero-policy, então a contagem vem por
  // RPC DEFINER (gate = _pode_ver_custos() OR producao_servico_aprovacao; 0 fora disso).
  const maoObra = useQuery({
    queryKey: ["home", "mo-a-aprovar-count"],
    enabled: !!modules.producao && podeVer("producao_servico_aprovacao"),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelos_mo_a_aprovar_count" as any);
      if (error) throw error;
      return Number(data ?? 0);
    },
  });

  // Parcelas de OC + parcelas de serviço somadas (count e valor) p/ os cards financeiros.
  const atrasadasN = (atrasadas.data?.n ?? 0) + (servicos.data?.atrasadasN ?? 0);
  const atrasadasTotal = (atrasadas.data?.total ?? 0) + (servicos.data?.atrasadasTotal ?? 0);
  const pagar7N = (pagar.data?.n ?? 0) + (servicos.data?.pagar7N ?? 0);
  const pagar7Total = (pagar.data?.total ?? 0) + (servicos.data?.pagar7Total ?? 0);

  // Sub do card de OCs: só DADO (breakdown por tipo), nunca texto de enchimento.
  const ocPartes = [
    ocTec > 0 && `${ocTec} tecido`,
    ocAvi > 0 && `${ocAvi} aviamento`,
    ocIns > 0 && `${ocIns} insumo`,
  ].filter(Boolean).join(" · ");

  // Ordem por urgência: vermelhos (crítico) antes dos âmbar (atenção) — varredura mais rápida.
  const atencao = [
    podeVerFin && {
      key: "atrasadas", to: "/financeiro", search: { tab: "lista", status: "vencido" },
      icon: CalendarX, tone: "red" as Tone,
      valor: atrasadasN, label: "Contas atrasadas",
      sub: (atrasadas.data || servicos.data) ? brl(atrasadasTotal) : undefined,
      loading: atrasadas.isLoading || servicos.isLoading,
      error: atrasadas.isError && servicos.isError,
    },
    modules.entrada_saida && podeVer("entrada_oc_tecido") && {
      key: "oc", to: "/entrada-saida/oc-tecido", search: { tab: "encomendado" },
      icon: Clock, tone: "red" as Tone,
      valor: ocTec + ocAvi + ocIns, label: "OCs atrasadas",
      sub: ocPartes || undefined,
      loading: badges.isLoading, error: badges.isError,
    },
    podeVerFin && {
      key: "pagar", to: "/financeiro", icon: Wallet, tone: "amber" as Tone,
      valor: pagar7N, label: "A pagar em 7 dias",
      sub: (pagar.data || servicos.data) ? brl(pagar7Total) : undefined,
      loading: pagar.isLoading || servicos.isLoading,
      error: pagar.isError && servicos.isError,
    },
    modules.entrada_saida && podeVer("entrada_alertas_tecido") && {
      key: "cq", to: "/entrada-saida/alertas-tecido", icon: AlertTriangle, tone: "amber" as Tone,
      valor: b("alertas_tecido"), label: "Alertas de CQ (tecido)",
      loading: badges.isLoading, error: badges.isError,
    },
  ].filter(Boolean) as CardAtencao[];

  // ── Fila de produção: a landing mostra a fila de trabalho, não só alarme financeiro ──
  const podeVerErros = podeVer("producao_cq") || podeVer("producao_direcionamento") || podeVer("producao_terceirizados");
  const erroPartes = [errCq > 0 && "CQ", errDir > 0 && "direcionamento", errTer > 0 && "serviços"]
    .filter(Boolean).join(" · ");
  const fila = [
    modules.criacao && podeVer("criacao_planejamento") && {
      key: "prontos", to: "/criacao/planejamento", icon: Rocket, tone: "blue" as Tone,
      valor: b("prontos_lancar"), label: "Prontos p/ lançar",
      sub: b("prontos_lancar") > 0 ? "CQ + custo aprovados" : undefined,
      loading: badges.isLoading, error: badges.isError,
    },
    modules.producao && podeVerErros && {
      key: "erros",
      // pousa onde o erro está (CQ > Direcionamento > Serviços).
      to: errCq > 0 ? "/expedicao/cq" : errDir > 0 ? "/expedicao/direcionamento" : "/pcp",
      icon: AlertTriangle, tone: "red" as Tone,
      valor: errCq + errDir + errTer, label: "Erros de produção",
      sub: erroPartes || undefined,
      loading: badges.isLoading, error: badges.isError,
    },
    modules.producao && podeVer("producao_servico_aprovacao") && {
      key: "mao-obra", to: "/criacao/planejamento", icon: ClipboardList, tone: "amber" as Tone,
      valor: maoObra.data ?? 0, label: "Mão de obra a aprovar",
      sub: (maoObra.data ?? 0) > 0 ? "modelos aguardando" : undefined,
      loading: maoObra.isLoading, error: maoObra.isError,
    },
  ].filter(Boolean) as CardAtencao[];

  // Tile de módulo só se o usuário PODE VER alguma página real dele (mesmo filtro do hub —
  // senão o toque pousa em "Nenhuma tela disponível…"; laudo do hub, jul/2026).
  const atalhosMobile = MODULOS.filter((m) => (modules as Record<string, boolean>)[m.key]).filter((m) => {
    const mod = PAGES_CATALOG.find((x) => x.basePath === m.path);
    return !mod || mod.pages.some((p) => !p.soEdicao && podeVer(p.key));
  });
  const atalhosDesktop = PAGINAS.filter(
    (p) => (modules as Record<string, boolean>)[p.mod] && (p.key === null || podeVer(p.key)),
  );

  const CardKpi = ({ a }: { a: CardAtencao }) => (
    <Link key={a.key} to={a.to as any} search={(a.search ?? {}) as any} className="block h-full">
      <Card className={cn(
        "flex h-full min-h-[110px] flex-col gap-3 p-4 transition-all hover:-translate-y-px hover:shadow-md sm:flex-row sm:items-start",
        !a.error && a.valor > 0 && (
          a.tone === "red" ? "border-red-500/50" : a.tone === "amber" ? "border-amber-500/50" : "border-blue-500/50"
        ),
      )}>
        <div className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-[10px]",
          a.error || a.valor === 0
            ? "bg-muted text-muted-foreground"
            : a.tone === "red" ? "bg-red-500/15 text-red-600"
            : a.tone === "amber" ? "bg-amber-500/15 text-amber-700 dark:text-amber-600"
            : "bg-blue-500/15 text-blue-600",
        )}>
          <a.icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          {a.loading ? (
            <div className="h-6 w-12 animate-pulse rounded bg-muted" aria-hidden />
          ) : (
            <div className={cn("font-display text-2xl font-semibold leading-none tabular-nums", a.error && "text-muted-foreground")}>
              {a.error ? "—" : a.valor}
            </div>
          )}
          <div className="mt-1.5 text-[13px] font-medium leading-snug">{a.label}</div>
          {/* Erro NUNCA vira "0": mostra que não carregou (o pior modo de falha de uma
              tela de status é o falso "tudo em dia"). */}
          {a.error ? (
            <div className="mt-0.5 text-xs text-muted-foreground">não carregou · tentar de novo</div>
          ) : a.sub ? (
            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{a.sub}</div>
          ) : null}
        </div>
      </Card>
    </Link>
  );

  return (
    <div className="container mx-auto space-y-6 p-3 sm:p-6">
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
            <h1 className="font-display text-xl font-semibold tracking-tight">
              {saud}{nome ? `, ${nome}` : ""} <span aria-hidden>👋</span>
            </h1>
            <p className="mt-0.5 text-xs opacity-75">{dataLonga}</p>
          </div>
        </div>
      </header>

      {/* Precisa da sua atenção */}
      {atencao.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[13px] font-semibold text-foreground">Precisa da sua atenção</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {atencao.map((a) => <CardKpi key={a.key} a={a} />)}
          </div>
        </section>
      )}

      {/* Fila de produção */}
      {fila.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-[13px] font-semibold text-foreground">Fila de produção</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {fila.map((a) => <CardKpi key={a.key} a={a} />)}
          </div>
        </section>
      )}

      {/* Atalhos: PÁGINA no desktop (caminho quente), MÓDULO no mobile (sidebar recolhida). */}
      <section className="space-y-2">
        <h2 className="font-display text-[13px] font-semibold text-foreground">Atalhos</h2>
        <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-4">
          {atalhosDesktop.map((m) => (
            <Link key={m.path + m.label} to={m.path as any} search={(m.search ?? {}) as any} className="block h-full">
              <Card className="flex h-full min-h-[44px] flex-col items-start gap-2 p-4 transition-all hover:-translate-y-px hover:shadow-md">
                <m.icon className="h-5 w-5 text-primary" />
                <span className="text-[13px] font-semibold">{m.label}</span>
              </Card>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:hidden">
          {atalhosMobile.map((m) => (
            <Link key={m.path} to={m.path as any} className="block h-full">
              <Card className="flex h-full min-h-[44px] flex-col items-start gap-2 p-4 transition-all hover:-translate-y-px hover:shadow-md">
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
