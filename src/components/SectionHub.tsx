import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useSidebarBadges } from "@/hooks/useSidebarBadges";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTabLabels } from "@/hooks/useTabLabels";
import { PAGES_CATALOG, pageInProfile } from "@/lib/permissions-catalog";
import { PAGE_URLS, PAGE_ICONS, MODULE_META, BADGE_CLS, pageBadgeCounts, badgeViva } from "@/lib/nav";
import { NavBadge } from "@/components/shared/NavBadge";

/**
 * HUB de setor (página basePath, ex.: /criacao) — blocos DERIVADOS do catálogo de permissões
 * (permissions-catalog + nav.ts), filtrados por perfil da loja e permissão do usuário; as
 * DESCRIÇÕES agora vêm do catálogo (SSOT — antes duplicadas por rota, driftavam).
 * v2 (laudo do time, jul/2026): o hub deixou de ser "mudo de estado" — cada card mostra o
 * BADGE de pendência + uma linha viva ("3 prontos p/ lançar"), da MESMA RPC da sidebar; é a
 * navegação primária no mobile e com a sidebar recolhida, onde esse sinal mais faltava.
 */
export function SectionHub({ module, subtitle }: { module: string; subtitle?: string }) {
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView } = useAuth();
  const { isStockOnly, isModuleEnabled, isLoading } = useTenantModules();
  const profile = isStockOnly ? "stock" : "full";
  const tabLabels = useTabLabels();
  const badges = useSidebarBadges();
  const counts = pageBadgeCounts(badges.data);
  const mod = PAGES_CATALOG.find((m) => m.module === module);
  const meta = MODULE_META[module];
  const Header = meta?.icon;

  // Módulo desligado pra loja: não montar o hub (mesma gate da sidebar) — evita mostrar blocos de um
  // setor não contratado quando alguém abre o basePath direto.
  const moduleOff = !!mod && !isModuleEnabled(mod.gate ?? mod.module);

  const blocks = moduleOff ? [] : (mod?.pages ?? [])
    .filter((p) => !p.soEdicao && PAGE_URLS[p.key])                        // páginas com tela de verdade
    .filter((p) => pageInProfile(p, profile))                             // perfil da loja (full/estoque)
    .filter((p) => isAdmin || isSuperAdmin || isTenantAdmin || canView(p.key)) // permissão do usuário
    .map((p) => ({
      key: p.key,
      label: tabLabels[p.key] || p.label,
      description: p.description,
      url: PAGE_URLS[p.key],
      Icon: PAGE_ICONS[p.key] ?? meta?.icon,
      n: counts[p.key] ?? 0,
    }));

  // Evita o flash "blocos → módulo desligado" enquanto tenant_config carrega (o default é true).
  if (isLoading) return null;

  return (
    <div className="container mx-auto space-y-6 p-3 sm:p-6">
      <header className="flex items-start gap-3">
        {Header && <Header className="mt-0.5 h-7 w-7 shrink-0 text-primary" />}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meta?.title ?? mod?.label ?? "Setor"}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{moduleOff ? "Este módulo não está habilitado para a sua loja." : "Nenhuma tela disponível neste setor para o seu acesso."}</p>
      ) : (
        // SEM items-start de propósito: o stretch do grid iguala as ALTURAS por fileira (gate de UI).
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blocks.map((b) => {
            const viva = badgeViva(b.key, b.n);
            return (
              <Link key={b.key} to={b.url} className="block h-full">
                <Card className="h-full p-4 transition-all hover:-translate-y-px hover:shadow-md">
                  <div className="flex items-start gap-3">
                    {b.Icon && (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/15 text-primary">
                        <b.Icon className="h-5 w-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="font-semibold">{b.label}</h2>
                        {b.n > 0 && <NavBadge n={b.n} className={`ml-auto shrink-0 ${BADGE_CLS[b.key] ?? "bg-muted text-muted-foreground"}`} />}
                      </div>
                      {b.description && <p className="line-clamp-2 text-sm text-muted-foreground">{b.description}</p>}
                      {viva && (
                        <p className={`mt-1.5 text-xs font-semibold ${
                          (BADGE_CLS[b.key] ?? "").includes("bg-red") ? "text-red-700 dark:text-red-400"
                          : (BADGE_CLS[b.key] ?? "").includes("bg-amber") ? "text-amber-700 dark:text-amber-500"
                          : "text-primary"
                        }`}>{viva}</p>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
