/**
 * Abas do Dashboard × módulos da loja (Modularidade, M7 — função PURA, fonte única do Dashboard e do `DashTabsList`).
 *
 * Cada aba exige que a loja tenha ALGUM dos módulos listados (`algum`), além da permissão `dashboard_<aba>`:
 *  - Desenvolvimento, Comercial & Coleção, Leadtime → Criação (os dados são dos cards);
 *  - Produção & Qualidade → Produção;
 *  - Custo & Financeiro → Criação OU Financeiro (cada bloco da aba some sem o módulo dele — ver `blocosCustoFinanceiro`).
 * O módulo `dashboard` em si é guardado pela rota (`ModuleGuard`) e pelo servidor (`_exige_modulos`).
 */
import type { ModuleKey } from "@/hooks/useTenantModules";

export const DASH_ABA_MODULOS: Record<string, { algum: ModuleKey[] }> = {
  desenvolvimento: { algum: ["criacao"] },
  producao_qualidade: { algum: ["producao"] },
  comercial_colecao: { algum: ["criacao"] },
  custo_financeiro: { algum: ["criacao", "financeiro"] },
  leadtime: { algum: ["criacao"] },
};

/** A loja tem algum dos módulos da aba? (aba desconhecida = sem exigência de módulo.) */
export function abaTemModulo(value: string, isModuleEnabled: (k: string) => boolean): boolean {
  const req = DASH_ABA_MODULOS[value];
  return !req || req.algum.some((m) => isModuleEnabled(m));
}

/** Abas que o usuário pode ver: permissão `dashboard_<aba>` E módulo da aba ligado na loja. Preserva a ordem. */
export function abasVisiveis<T extends { value: string }>(
  tabs: readonly T[],
  canView: (pagina: string) => boolean,
  isModuleEnabled: (k: string) => boolean,
): T[] {
  return tabs.filter((t) => canView(`dashboard_${t.value}`) && abaTemModulo(t.value, isModuleEnabled));
}

/** Blocos da aba Custo & Financeiro e quais queries rodam: Financeiro = parcelas/estoque parado; Criação = custo dos cards. */
export function blocosCustoFinanceiro(isModuleEnabled: (k: string) => boolean): { financeiro: boolean; custos: boolean } {
  return { financeiro: isModuleEnabled("financeiro"), custos: isModuleEnabled("criacao") };
}
