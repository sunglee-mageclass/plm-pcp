import { createContext, useContext, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenantModules } from "@/hooks/useTenantModules";
import { PAGES_CATALOG, modulosExigidosDaPagina, paginaNoPerfil } from "@/lib/permissions-catalog";
import { ModuloDesligadoAviso } from "@/components/shared/ModuloDesligadoAviso";

interface Props {
  page?: string;
  anyOf?: string[];
  /** Páginas que TAMBÉM dão edição nesta tela (o OU que o servidor aceita; ex.: Alertas de Tecido = Alertas OU OC Tecido).
   *  Não abrem a tela (ver continua exigindo `page`/`anyOf`) — só evitam o selo "somente leitura" para quem edita pelo OU. */
  editarCom?: readonly string[];
  children: ReactNode;
}

// Lookup achatado das páginas por chave (p/ o gate de perfil full/só-estoque).
const PAGE_BY_KEY = new Map(
  PAGES_CATALOG.flatMap((m) => m.pages.map((p) => [p.key, p] as const)),
);

// Propagates "read only" mode through the React tree so portaled content
// (Dialog/Sheet, which render outside the page's DOM subtree) can also
// disable their own form controls. Pages don't read this directly.
const ReadOnlyContext = createContext(false);
export function useReadOnly() {
  return useContext(ReadOnlyContext);
}

/** Define o "somente leitura" de um trecho da árvore (ex.: o Sheet do Planejamento decide pelas próprias permissões,
 *  sem herdar a trava da PÁGINA onde foi aberto). */
export function ReadOnlyScope({ value, children }: { value: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

export function RequirePermission({ page, anyOf, editarCom, children }: Props) {
  const { canView, canEdit, loading } = useAuth();
  // `isLoading` = `!pronto` (loja e config chegaram): a decisão por módulo/perfil NUNCA roda sobre os DEFAULTS.
  const { isStockOnly, isModuleEnabled, firstActiveModulePath, isLoading: modulesLoading } = useTenantModules();
  if (loading || modulesLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  // Gate de PERFIL (modo da loja): página com modes incompatíveis com o perfil
  // atual (full × só-estoque) não é acessível nem por URL direta → redireciona.
  // P-256 A: a página só-estoque (OS Tecido/OS Aviamento/Destinos) vale enquanto a loja não tem Criação.
  if (page) {
    const def = PAGE_BY_KEY.get(page);
    if (def && !paginaNoPerfil(def, { isStockOnly, criacaoLigada: isModuleEnabled("criacao") })) {
      return <Navigate to={firstActiveModulePath as any} replace />;
    }
    // Rota guardada pelo módulo da PRÓPRIA página (PageDef.gate: Plan. Tecido → otb, Explosão → criacao, PA/PI, Etapas PL):
    // a tela não renderiza (nem pisca) e explica, em vez de redirecionar sem dizer por quê. (P-253 A)
    if (def?.gate && !isModuleEnabled(def.gate)) {
      return <ModuloDesligadoAviso modulos={[def.gate]} exige={modulosExigidosDaPagina(page)} />;
    }
  }
  const allowed =
    (page ? canView(page) : false) ||
    (anyOf ? anyOf.some((p) => canView(p)) : false);
  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center px-4">
        <h1 className="text-xl font-semibold text-foreground">Acesso negado</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          Você não tem permissão para acessar esta página. Entre em contato com o administrador da sua loja.
        </p>
      </div>
    );
  }

  const editable =
    (page ? canEdit(page) : false) ||
    (anyOf ? anyOf.some((p) => canEdit(p)) : false) ||
    (editarCom ? editarCom.some((p) => canEdit(p)) : false);
  if (editable) return <>{children}</>;

  return (
    <ReadOnlyContext.Provider value={true}>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <Lock className="h-4 w-4 shrink-0" />
        Modo somente leitura — você não tem permissão de edição nesta área.
      </div>
      {children}
    </ReadOnlyContext.Provider>
  );
}
