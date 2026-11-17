// Esqueleto AUTOMÁTICO do Manual de uso: a árvore Módulo → Tela → Seção, derivada dos
// MESMOS catálogos VIVOS que a sidebar usa (permissions-catalog + nav), filtrada pela loja
// (módulos ligados + perfil full/estoque) e pela PERMISSÃO do usuário. Assim o Manual nunca
// envelhece — ele reusa a visibilidade da sidebar em vez de manter uma lista própria.
//
// Funções PURAS: sem React, sem hooks. Tudo entra por parâmetro (os `modules` já RESOLVIDOS
// da loja — `useTenantModules().modules` / `resolverModulos` — e um `podeVer(pageKey)` que a
// camada de UI monta a partir do `canView` do useAuth). Não reimplementamos a regra de
// visibilidade: reusamos `paginaNoPerfil`/`paginaComModuloDesligado` do permissions-catalog.
import {
  PAGES_CATALOG,
  paginaNoPerfil,
  paginaComModuloDesligado,
  type ModuleDef,
  type PageDef,
} from "@/lib/permissions-catalog";
import { PAGE_URLS } from "@/lib/nav";

/** Uma seção (sub-permissão) de uma tela, copiada do `PageDef.sections` do catálogo. */
export type SecaoEstrutura = { key: string; label: string; hint?: string };

/** Uma TELA do Manual (página do catálogo), já resolvida com URL, módulo e seções. */
export type TelaManual = {
  pageKey: string;
  /** Rótulo do CATÁLOGO (o renomeado pela loja — tab_labels — é aplicado na camada de UI). */
  label: string;
  url?: string;
  moduloKey: string;
  moduloLabel: string;
  descricao?: string;
  seroes: SecaoEstrutura[];
  /** A tela pertence a um módulo desligado na loja? (via `paginaComModuloDesligado`). */
  moduloDesligado: boolean;
};

/** Um MÓDULO do Manual (bloco de topo do catálogo) com as telas visíveis. */
export type ModuloManual = {
  moduleKey: string;
  label: string;
  basePath: string;
  telas: TelaManual[];
};

export type MontarEstruturaArgs = {
  /** Mapa de módulos JÁ RESOLVIDO da loja (padrões + o que a loja gravou). Chave ausente = não ligado. */
  modules: Record<string, boolean>;
  /** Loja em modo só-estoque (só Cadastro + Entrada e Saída). */
  isStockOnly: boolean;
  /** Módulo Criação ligado (regra P-256 A do perfil: OS/Destinos valem enquanto não há Criação). */
  criacaoLigada: boolean;
  /** Permissão do usuário por página (canView). Esconde a tela que o usuário não pode ver. */
  podeVer: (pageKey: string) => boolean;
};

/** Um módulo está ligado na loja? Espelha `isModuleEnabled`/`modulosDesligadosDaPagina`: só
 *  `false` EXPLÍCITO desliga (chave ausente = tratada como ligada, como no `?? true` da sidebar). */
function moduloLigado(modules: Record<string, boolean>, chave: string): boolean {
  return modules[chave] !== false;
}

/** A página passa no gate de módulo (bloco + gate próprio da página)? Espelha app-sidebar.tsx:124/143
 *  `isModuleEnabled(m.gate ?? m.module)` + `(!p.gate || isModuleEnabled(p.gate))`. */
function passaNoGateDeModulo(modules: Record<string, boolean>, m: ModuleDef, p: PageDef): boolean {
  return moduloLigado(modules, m.gate ?? m.module) && (!p.gate || moduloLigado(modules, p.gate));
}

/**
 * Monta a árvore Módulo → Tela → Seção do Manual, filtrada pela loja e pela permissão do usuário.
 *
 * Para cada página de `PAGES_CATALOG`, a tela só entra se (espelha o filtro da sidebar,
 * app-sidebar.tsx:130/136/140-143 e SectionHub.tsx:36-37):
 *   1. NÃO é permissão-só (`p.soEdicao` = sem tela/menu, ex.: aprovar mão de obra);
 *   2. está no perfil da loja (`paginaNoPerfil`, full/estoque + P-256 A);
 *   3. passa no gate de módulo do bloco E no gate próprio da página;
 *   4. o usuário pode ver (`podeVer(p.key)` = o `canView` da sidebar).
 *
 * Módulo sem nenhuma tela visível é omitido (como a sidebar não mostra grupo vazio).
 * PURO e determinístico: mesma entrada ⇒ mesma saída, sem ler estado global.
 */
export function montarEstruturaManual(args: MontarEstruturaArgs): ModuloManual[] {
  const { modules, isStockOnly, criacaoLigada, podeVer } = args;
  const perfil = { isStockOnly, criacaoLigada };

  const resultado: ModuloManual[] = [];

  for (const m of PAGES_CATALOG) {
    const telas: TelaManual[] = [];

    for (const p of m.pages) {
      if (p.soEdicao) continue; // permissão-só, sem tela no Manual
      if (!paginaNoPerfil(p, perfil)) continue; // perfil da loja (full/estoque)
      if (!passaNoGateDeModulo(modules, m, p)) continue; // gate de módulo (bloco + página)
      if (!podeVer(p.key)) continue; // permissão do usuário

      telas.push({
        pageKey: p.key,
        label: p.label,
        url: PAGE_URLS[p.key],
        moduloKey: m.module,
        moduloLabel: m.label,
        descricao: p.description,
        seroes: (p.sections ?? []).map((s) => ({ key: s.key, label: s.label, hint: s.hint })),
        // `paginaComModuloDesligado` usa o mesmo mapa já resolvido da loja. Aqui a tela só chega
        // com os gates ligados, então normalmente é false; fica como marca honesta (ex.: página
        // "sempre editável" como `producao_servico_aprovacao`, que nem entra por ser soEdicao).
        moduloDesligado: paginaComModuloDesligado(p.key, modules),
      });
    }

    if (telas.length > 0) {
      resultado.push({ moduleKey: m.module, label: m.label, basePath: m.basePath, telas });
    }
  }

  return resultado;
}
