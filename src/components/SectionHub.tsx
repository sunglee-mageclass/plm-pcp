import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { useTabLabels } from "@/hooks/useTabLabels";
import { PAGES_CATALOG, pageInProfile } from "@/lib/permissions-catalog";
import { PAGE_URLS, PAGE_ICONS, MODULE_META } from "@/lib/nav";

/**
 * HUB de setor (página basePath, ex.: /criacao) — os "bloquinhos" são DERIVADOS do mesmo catálogo
 * de permissões que alimenta a sidebar (permissions-catalog + nav.ts), filtrados por perfil da loja
 * e permissão do usuário. Assim NUNCA ficam desatualizados (antes cada hub tinha uma lista fixa que
 * esquecia de páginas novas — ex.: Plan. Tecido faltando). `descriptions` é best-effort por key.
 */
export function SectionHub({ module, subtitle, descriptions }: { module: string; subtitle?: string; descriptions?: Record<string, string> }) {
  const { isAdmin, isSuperAdmin, isTenantAdmin, canView } = useAuth();
  const { isStockOnly, isModuleEnabled } = useTenantModules();
  const profile = isStockOnly ? "stock" : "full";
  const tabLabels = useTabLabels();
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
    .map((p) => ({ key: p.key, label: tabLabels[p.key] || p.label, url: PAGE_URLS[p.key], Icon: PAGE_ICONS[p.key] ?? meta?.icon }));

  return (
    <div className="container mx-auto space-y-6 p-3 sm:p-6">
      <header className="flex items-start gap-3">
        {Header && <Header className="mt-0.5 h-7 w-7 shrink-0 text-primary" />}
        <div>
          <h1 className="text-2xl font-bold">{meta?.title ?? mod?.label ?? "Setor"}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </header>
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{moduleOff ? "Este módulo não está habilitado para a sua loja." : "Nenhuma tela disponível neste setor para o seu acesso."}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blocks.map((b) => (
            <Link key={b.key} to={b.url}>
              <Card className="h-full p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3">
                  {b.Icon && <b.Icon className="mt-0.5 h-5 w-5 text-primary" />}
                  <div>
                    <h3 className="font-semibold">{b.label}</h3>
                    {descriptions?.[b.key] && <p className="text-sm text-muted-foreground">{descriptions[b.key]}</p>}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
